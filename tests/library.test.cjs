const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFile} = require('node:fs/promises');
const {browserSuite,seedState} = require('./browser-helper.cjs');

const app = browserSuite({engine:process.env.RACKED_TEST_BROWSER || 'chromium'});
const bench = {id:'exercise:bench',name:'Bench Press'};
const incline = {id:'exercise:incline',name:'Incline Bench Press'};
const blank = ()=>({version:2,exercises:[],workouts:[],sessions:[],measurements:[],activeSession:null});
const card = (id='card',weight=50,reps=8)=>({id,catalogId:bench.id,name:bench.name,weight,reps,notes:'Template cue'});
const workout = (id='w',exercise=card())=>({id,name:'Workout '+id,exercises:[exercise]});
function session({id='s',kind,finished=true,weight=60}={}){
  return {id,...(kind ? {kind} : {}),workoutId:'w',workoutName:'Workout w',date:'2026-10-24T12:00:00Z',
    exercises:[{exerciseId:'card',catalogId:bench.id,name:bench.name,notes:'Original note',
      weight,reps:9,startWeight:50,startReps:8,finished,
      sets:[{weight,reps:9,time:'2026-10-24T12:05:00Z',custom:{preserve:true}}]}]};
}
async function open(t,state=blank()){
  const context=await app.context(t);
  await seedState(context,state);
  const page=await context.newPage();
  page.on('dialog',dialog=>dialog.type()==='confirm' ? dialog.accept() : dialog.dismiss());
  await page.goto(app.origin);
  return page;
}
async function saved(page){return page.evaluate(()=>JSON.parse(localStorage.getItem('racked_state_v1')));}
async function failNextWrite(page){
  await page.evaluate(()=>{
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(...args){
      Storage.prototype.setItem=original;
      throw new DOMException('Quota exceeded','QuotaExceededError');
    };
  });
}
async function addDirect(page,name){
  await page.locator('#ex-add').click();
  assert.equal(await page.getByRole('dialog',{name:'Add Exercise',exact:true}).count(),1);
  await page.locator('#exercise-name').fill(name);
  await page.locator('#exercise-save').click();
}
function libraryCard(page,id=bench.id){return page.locator(`.exercise-library-card[data-catalog-id="${id}"]`);}
async function importFile(page,id,value){
  await page.locator(id).setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
  await page.waitForFunction(selector=>{
    const input=document.querySelector(selector);
    return !input || input.value==='';
  },id);
}

test('direct creation and renaming share trimmed case-insensitive duplicate validation',async t=>{
  const page=await open(t);
  await page.locator('#t-exercises').click();
  await addDirect(page,'  Bench Press  ');
  const first=(await saved(page)).exercises[0];
  assert.equal(first.name,'Bench Press');
  assert(first.id);
  assert.equal(await page.locator('.exercise-library-card').count(),1);
  await page.locator('#ex-add').click();
  await page.locator('#exercise-name').fill(' bench PRESS ');
  await page.locator('#exercise-save').click();
  assert.deepEqual((await saved(page)).exercises,[first]);
  assert.equal(await page.locator('#exercise-name').isVisible(),true);
  await page.locator('#exercise-name').fill('   ');
  await page.locator('#exercise-save').click();
  assert.deepEqual((await saved(page)).exercises,[first]);
  await page.locator('#exercise-cancel').click();
  await addDirect(page,'Incline Bench Press');
  const before=await saved(page);
  await page.locator(`[data-rename-id="${first.id}"]`).click();
  await page.locator('#exercise-name').fill(' incline bench press ');
  await page.locator('#exercise-save').click();
  assert.deepEqual(await saved(page),before);
  await page.locator('#exercise-cancel').click();
  await page.reload();
  await page.locator('#t-exercises').click();
  assert.equal(await page.locator('.exercise-library-card').count(),2);
});

test('workout-created exercises are staged until save and existing selection keeps workout defaults',async t=>{
  const page=await open(t,{...blank(),exercises:[bench],sessions:[session()]});
  await page.locator('#t-create').click();
  await page.locator('#cw-name').fill('Discard this draft');
  await page.locator('#cw-exname').fill('Cable Row');
  await page.locator('#cw-addex').click();
  assert.deepEqual((await saved(page)).exercises,[bench]);
  await page.goBack();
  await page.locator('#t-create').click();
  await page.locator('#cw-name').fill('Shared library');
  await page.locator('#cw-exweight').fill('35');
  await page.locator('#cw-exreps').fill('6');
  await page.locator('#cw-exname').fill('Bench');
  await page.locator('.suggest-item[data-catalog-id="exercise:bench"]').click();
  assert.equal(await page.locator('#cw-exweight').inputValue(),'35');
  assert.equal(await page.locator('#cw-exreps').inputValue(),'6');
  await page.locator('#cw-addex').click();
  await page.locator('#cw-exname').fill('Cable Row');
  await page.locator('#cw-addex').click();
  await page.locator('#cw-exname').fill(' cable ROW ');
  await page.locator('#cw-addex').click();
  assert.deepEqual((await saved(page)).exercises,[bench]);
  await page.locator('#cw-save').click();
  const next=await saved(page);
  assert.equal(next.exercises.length,2);
  assert.equal(next.workouts.length,1);
  assert.equal(next.workouts[0].exercises[0].catalogId,bench.id);
  assert.equal(next.workouts[0].exercises[0].weight,35);
  assert.equal(next.workouts[0].exercises[0].reps,6);
  assert.equal(next.workouts[0].exercises[1].catalogId,next.workouts[0].exercises[2].catalogId);
  assert.equal(next.exercises.filter(ex=>ex.name.toLowerCase()==='cable row').length,1);
});

test('rename changes current labels while preserving history, templates and active numeric drafts',async t=>{
  const historical=session();
  const template=workout();
  const active=session({id:'active',kind:'exercise',finished:false,weight:62});
  active.exercises[0].draftInputs={weight:'62,',reps:''};
  const initial={...blank(),exercises:[bench],workouts:[template],sessions:[historical],activeSession:active};
  const page=await open(t,initial);
  await page.locator('#t-resume-exercise').click();
  await page.locator('#ex-rename').click();
  await page.locator('#exercise-name').fill('Flat Bench Press');
  await page.locator('#exercise-save').click();
  const next=await saved(page);
  assert.deepEqual(next.exercises,[{...bench,name:'Flat Bench Press'}]);
  assert.deepEqual(next.sessions,initial.sessions);
  assert.deepEqual(next.workouts,initial.workouts);
  assert.deepEqual(next.activeSession,initial.activeSession);
  assert.equal(await page.locator('.ex-name').textContent(),'Flat Bench Press');
  await page.reload();
  await page.locator('#t-resume-exercise').click();
  assert.equal(await page.locator('[data-role="weight"]').inputValue(),'62,');
  assert.equal(await page.locator('[data-role="reps"]').inputValue(),'');
  await page.locator('[data-role="reps"]').fill('10');
  await page.locator('[data-act="logset"]').click();
  await page.locator('[data-act="finishex"]').click();
  await page.reload();
  await page.locator('#t-progress').click();
  assert.equal(await page.locator('.cc-title').textContent(),'Flat Bench Press');
  assert.match(await page.locator('.cc-sub').innerText(),/2 data points/);
});

test('one library identity shares progression while each workout retains its starting values',async t=>{
  const initial={...blank(),exercises:[bench],workouts:[workout('one',card('first',50,8)),workout('two',card('second',35,12))]};
  const page=await open(t,initial);
  await page.locator('#t-workouts').click();
  await page.locator('.workout-start').first().click();
  await page.locator('[data-role="weight"]').fill('55');
  await page.locator('[data-role="reps"]').fill('9');
  await page.locator('[data-act="logset"]').click();
  await page.locator('[data-act="finishex"]').click();
  await page.locator('#sessFinishBottom').click();
  assert.equal((await saved(page)).workouts[0].exercises[0].weight,55);
  assert.equal((await saved(page)).workouts[1].exercises[0].weight,35);
  assert.equal((await saved(page)).workouts[1].exercises[0].reps,12);
  await page.locator('.workout-start').last().click();
  assert.equal(await page.locator('[data-role="weight"]').inputValue(),'35');
  assert.equal(await page.locator('[data-role="reps"]').inputValue(),'12');
  assert.match(await page.locator('.ex-card').innerText(),/Last time: 55kg × 9/);
  await page.locator('[data-act="logset"]').click();
  await page.locator('[data-act="finishex"]').click();
  await page.locator('#sessFinishBottom').click();
  await page.reload();
  await page.locator('#t-progress').click();
  assert.equal(await page.locator('.chart-card').count(),1);
  assert.match(await page.locator('.cc-sub').innerText(),/2 data points/);
});

test('template deletion retains unused library entries and protects an active workout',async t=>{
  const initial={...blank(),exercises:[bench,incline],workouts:[workout()]};
  const page=await open(t,initial);
  await page.locator('#t-workouts').click();
  await page.locator('[data-del="w"]').click();
  assert.equal((await saved(page)).workouts.length,0);
  assert.deepEqual((await saved(page)).exercises,initial.exercises);
  await page.reload();
  await page.locator('#t-exercises').click();
  assert.equal(await page.locator('.exercise-library-card').count(),2);
  await libraryCard(page).click();
  assert.equal((await saved(page)).activeSession.exercises[0].catalogId,bench.id);

  const active=session({id:'active-workout',finished:false});
  const second=await open(t,{...initial,activeSession:active});
  await second.locator('#t-workouts').click();
  const before=await saved(second);
  await second.locator('[data-del="w"]').click();
  assert.deepEqual(await saved(second),before);
  await second.locator('.workout-start').click();
  assert.equal(await second.locator('.set-chip').count(),1);
});

test('full backups retain library-only exercises and restore them without a workout',async t=>{
  const initial={...blank(),exercises:[bench,incline],custom:{keep:true}};
  const page=await open(t,initial);
  await page.locator('#t-backup').click();
  const event=page.waitForEvent('download');
  await page.locator('#bk-export-full').click();
  const download=await event;
  const exported=JSON.parse(await readFile(await download.path(),'utf8'));
  assert.deepEqual(exported,initial);
  await importFile(page,'#bk-file-full',exported);
  assert.deepEqual(await saved(page),initial);
  await page.locator('#t-exercises').click();
  assert.equal(await page.locator('.exercise-library-card').count(),2);
  await libraryCard(page,incline.id).click();
  assert.equal(await page.locator('.ex-name').textContent(),incline.name);
});

test('category imports add definitions without damaging library-only entries or active references',async t=>{
  const active=session({id:'active',kind:'exercise',finished:false});
  active.exercises[0].draftInputs={weight:'63,',reps:'10'};
  const initial={...blank(),exercises:[bench,incline],workouts:[workout()],sessions:[session()],activeSession:active};
  const page=await open(t,initial);
  await page.locator('#t-backup').click();
  for(const [button,category] of [['#bk-export-workouts','workouts'],['#bk-export-sessions','sessions']]){
    const event=page.waitForEvent('download');
    await page.locator(button).click();
    const download=await event;
    const exported=JSON.parse(await readFile(await download.path(),'utf8'));
    assert.equal(exported.version,2);
    assert.deepEqual(exported.exercises,[bench]);
    assert.deepEqual(exported[category],initial[category]);
  }
  const row={id:'exercise:row',name:'Cable Row'};
  const imported={version:2,exercises:[row],workouts:[workout('imported',{id:'row-card',catalogId:row.id,name:row.name,weight:25,reps:10,notes:''})]};
  await importFile(page,'#bk-file-workouts',imported);
  const next=await saved(page);
  assert.deepEqual(next.exercises,[bench,incline,row]);
  assert.deepEqual(next.activeSession,active);
  assert.deepEqual(next.sessions,initial.sessions);
  assert.deepEqual(next.workouts,imported.workouts);
  const conflict={...imported,exercises:[{...row,name:'Bench Press'}]};
  await importFile(page,'#bk-file-workouts',conflict);
  assert.deepEqual(await saved(page),next);
  await page.reload();
  await page.locator('#t-resume-exercise').click();
  assert.equal(await page.locator('[data-role="weight"]').inputValue(),'63,');
  assert.equal(await page.locator('.set-chip').count(),1);
});

test('an imported template cannot overwrite a different active exercise through a reused card ID',async t=>{
  const active=session({id:'active-workout',finished:false});
  const page=await open(t,{...blank(),exercises:[bench],workouts:[workout()],activeSession:active});
  await page.locator('#t-backup').click();
  const row={id:'exercise:row',name:'Cable Row'};
  const imported={version:2,exercises:[row],workouts:[workout('w',{
    id:'card',catalogId:row.id,name:row.name,weight:25,reps:10,notes:''
  })]};
  await importFile(page,'#bk-file-workouts',imported);
  assert.deepEqual((await saved(page)).activeSession,active);
  await page.reload();
  await page.locator('#t-resume-session').click();
  assert.equal(await page.locator('.ex-name').textContent(),bench.name);
  await page.locator('[data-role="weight"]').fill('65');
  await page.locator('[data-act="logset"]').click();
  await page.locator('[data-act="finishex"]').click();
  assert.deepEqual((await saved(page)).workouts,imported.workouts);
  await page.locator('#sessFinishBottom').click();
  const next=await saved(page);
  assert.equal(next.sessions.length,1);
  assert.equal(next.sessions[0].exercises[0].catalogId,bench.id);
  assert.equal(next.sessions[0].exercises[0].sets.length,2);
  assert.equal(next.activeSession,null);
});

test('failed library create, rename and workout save leave no phantom entries and can retry',async t=>{
  const page=await open(t,{...blank(),exercises:[bench]});
  await page.locator('#t-exercises').click();
  await page.locator('#ex-add').click();
  await page.locator('#exercise-name').fill('Cable Row');
  const before=await saved(page);
  await failNextWrite(page);
  await page.locator('#exercise-save').click();
  assert.deepEqual(await saved(page),before);
  await page.locator('#exercise-save').click();
  assert.equal((await saved(page)).exercises.length,2);
  await page.locator('[data-rename-id="exercise:bench"]').click();
  await page.locator('#exercise-name').fill('Flat Bench Press');
  const beforeRename=await saved(page);
  await failNextWrite(page);
  await page.locator('#exercise-save').click();
  assert.deepEqual(await saved(page),beforeRename);
  await page.locator('#exercise-save').click();
  assert.equal((await saved(page)).exercises[0].name,'Flat Bench Press');
  await page.reload();
  await page.locator('#t-create').click();
  await page.locator('#cw-name').fill('Atomic draft');
  await page.locator('#cw-exname').fill('New Curl');
  await page.locator('#cw-addex').click();
  const beforeWorkout=await saved(page);
  await failNextWrite(page);
  await page.locator('#cw-save').click();
  assert.deepEqual(await saved(page),beforeWorkout);
  await page.locator('#cw-save').click();
  const next=await saved(page);
  assert.equal(next.workouts.length,1);
  assert.equal(next.exercises.length,3);
  assert.equal(next.exercises.filter(ex=>ex.name==='New Curl').length,1);
});
