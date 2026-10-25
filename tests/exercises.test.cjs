const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFile} = require('node:fs/promises');
const {browserSuite,seedState} = require('./browser-helper.cjs');

const app = browserSuite({engine:process.env.RACKED_TEST_BROWSER || 'chromium'});
const blank = ()=>({version:1,workouts:[],sessions:[],measurements:[],activeSession:null});
const bench = {id:'bench-card',catalogId:'exercise:bench',name:'Bench Press',weight:50,reps:8,notes:''};
const incline = {id:'incline-card',catalogId:'exercise:incline',name:'Incline Bench Press',weight:40,reps:10,notes:''};
const deck = (id='w',exercises=[bench,incline])=>({id,name:`Workout ${id}`,exercises});
function session(id,exercise,{workoutId='w',date='2026-10-24T12:00:00Z',sets=[{weight:60,reps:8,time:'2026-10-24T12:01:00Z'}]}={}){
  return {id,workoutId,workoutName:`Workout ${workoutId}`,date,exercises:[{
    exerciseId:exercise.id,...(exercise.catalogId ? {catalogId:exercise.catalogId} : {}),
    name:exercise.name,notes:'Historical note',weight:60,reps:8,startWeight:50,startReps:8,
    sets,finished:true
  }]};
}
async function open(t,state=blank(),dialogs=[]){
  const context = await app.context(t);
  await seedState(context,state);
  const page = await context.newPage();
  page.on('dialog',dialog=>{dialogs.push(dialog.message()); return dialog.type()==='confirm' ? dialog.accept() : dialog.dismiss();});
  await page.goto(app.origin);
  return page;
}
async function saved(page){return page.evaluate(()=>JSON.parse(localStorage.getItem('racked_state_v1')));}
function libraryCard(page,id){return page.locator(`.exercise-library-card[data-catalog-id="${id}"]`);}
async function library(page){await page.locator('#t-exercises').click();}
async function importFile(page,id,value){
  await page.locator(id).setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
  await page.waitForFunction(selector=>{
    const input=document.querySelector(selector);
    return !input || input.value==='';
  },id);
}
async function failNextWrite(page){
  await page.evaluate(()=>{
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(...args){
      Storage.prototype.setItem=original;
      throw new DOMException('Quota exceeded','QuotaExceededError');
    };
  });
}

test('exercise selection uses a two-column library and the last logged set, not the best set',async t=>{
  const older=session('older',bench,{date:'2026-10-20T12:00:00Z',sets:[{weight:100,reps:3,time:'2026-10-20T12:01:00Z'}]});
  const recent=session('recent',bench,{sets:[{weight:90,reps:3,time:'2026-10-24T12:01:00Z'},{weight:60,reps:8,time:'2026-10-24T12:02:00Z'}]});
  const state={...blank(),workouts:[deck()],sessions:[older,recent]};
  const page=await open(t,state);
  assert.equal(await page.locator('#t-create + #t-exercises').count(),1);
  await library(page);
  assert.equal(await page.locator('.exercise-library-card').count(),2);
  assert.equal(await page.locator('.exercise-library').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),2);
  assert.match(await libraryCard(page,bench.catalogId).innerText(),/60\s*kg\s*×\s*8\s*reps/i);
  assert.match(await libraryCard(page,incline.catalogId).innerText(),/no logged sets/i);
  await libraryCard(page,bench.catalogId).click();
  assert.equal(await page.locator('.ex-name').textContent(),'Bench Press');
  assert.equal(await page.locator('[data-role="weight"]').inputValue(),'60');
  assert.equal(await page.locator('[data-role="reps"]').inputValue(),'8');
  assert.match(await page.locator('.ex-card').innerText(),/Last time: 60kg × 8/);
  const next=await saved(page);
  assert.equal(next.activeSession.kind,'exercise');
  assert.equal(next.activeSession.exercises[0].catalogId,bench.catalogId);
  assert.deepEqual(next.workouts,state.workouts);
});

test('last performance follows logged set time when an older session is resumed later',async t=>{
  const resumed=session('older-start',bench,{date:'2026-10-20T12:00:00Z',sets:[
    {weight:80,reps:4,time:'2026-10-20T12:01:00Z'},
    {weight:62.5,reps:9,time:'2026-10-25T12:01:00Z'}
  ]});
  const newerStart=session('newer-start',bench,{date:'2026-10-24T12:00:00Z',sets:[
    {weight:60,reps:8,time:'2026-10-24T12:01:00Z'}
  ]});
  const missingTime=session('older-missing-time',bench,{date:'2026-10-21T12:00:00Z',sets:[{weight:20,reps:12}]});
  const page=await open(t,{...blank(),workouts:[deck()],sessions:[resumed,newerStart,missingTime]});
  await library(page);
  assert.match(await libraryCard(page,bench.catalogId).innerText(),/62\.5\s*kg\s*×\s*9\s*reps/i);
  await libraryCard(page,bench.catalogId).click();
  assert.equal(await page.locator('[data-role="weight"]').inputValue(),'62.5');
  assert.equal(await page.locator('[data-role="reps"]').inputValue(),'9');
});

test('individual sets can be logged, edited and deleted, then Finish saves progression without a template',async t=>{
  const state={...blank(),workouts:[deck()]};
  const page=await open(t,state);
  await library(page);
  await libraryCard(page,incline.catalogId).click();
  await page.locator('[data-role="weight"]').fill('42,5');
  await page.locator('[data-role="reps"]').fill('11');
  await page.locator('[data-act="logset"]').click();
  await page.locator('[data-act="wup"]').click();
  await page.locator('[data-act="logset"]').click();
  assert.equal(await page.locator('.set-chip').count(),2);
  await page.locator('.set-chip').first().click();
  await page.locator('#modal-set-weight').fill('44');
  await page.locator('#modal-set-reps').fill('12');
  await page.locator('#modal-set-save').click();
  await page.locator('.set-chip').last().click();
  await page.locator('#modal-set-delete').click();
  assert.equal(await page.locator('.set-chip').count(),1);
  await page.locator('[data-act="finishex"]').click();
  const next=await saved(page);
  assert.equal(next.activeSession,null);
  assert.equal(next.sessions.length,1);
  assert.equal(next.sessions[0].kind,'exercise');
  assert.equal(next.sessions[0].exercises[0].catalogId,incline.catalogId);
  assert.deepEqual(next.sessions[0].exercises[0].sets.map(({weight,reps})=>({weight,reps})),[{weight:44,reps:12}]);
  assert.deepEqual(next.workouts,state.workouts);
  assert.equal(await page.locator('#view-exercises').evaluate(el=>el.classList.contains('active')),true);
  assert.match(await libraryCard(page,incline.catalogId).innerText(),/44\s*kg\s*×\s*12\s*reps/i);
  await page.reload();
  await page.locator('#t-progress').click();
  assert.equal(await page.locator('.cc-title').textContent(),'Incline Bench Press');
  assert.match(await page.locator('.cc-sub').innerText(),/1 data point/);
});

test('unfinished individual sets, notes and controls survive reload without blurring inputs',async t=>{
  const page=await open(t,{...blank(),workouts:[deck()]});
  await library(page);
  await libraryCard(page,bench.catalogId).click();
  await page.locator('[data-act="logset"]').click();
  await page.locator('[data-role="notes"]').fill('Keep elbows tucked');
  await page.locator('[data-role="weight"]').fill('65,5');
  await page.reload();
  await page.locator('#t-resume-exercise').click();
  assert.equal(await page.locator('[data-role="weight"]').inputValue(),'65,5');
  assert.equal((await saved(page)).activeSession.exercises[0].weight,65.5);
  assert.equal(await page.locator('[data-role="notes"]').inputValue(),'Keep elbows tucked');
  assert.equal(await page.locator('.set-chip').count(),1);
  await page.locator('[data-role="reps"]').fill('11');
  await page.reload();
  await library(page);
  await libraryCard(page,bench.catalogId).click();
  assert.equal(await page.locator('[data-role="reps"]').inputValue(),'11');
  assert.equal((await saved(page)).sessions.length,0);
  await page.locator('[data-act="logset"]').click();
  assert.equal((await saved(page)).activeSession.exercises[0].sets.length,2);
});

test('failed individual finish keeps the active exercise and retries without duplicating history',async t=>{
  const page=await open(t,{...blank(),workouts:[deck()]});
  await library(page);
  await libraryCard(page,bench.catalogId).click();
  await page.locator('[data-act="logset"]').click();
  const before=await saved(page);
  await failNextWrite(page);
  await page.locator('[data-act="finishex"]').click();
  assert.deepEqual(await saved(page),before);
  assert.equal(await page.locator('[data-act="finishex"]').isVisible(),true);
  await page.locator('[data-act="finishex"]').click();
  assert.equal((await saved(page)).sessions.length,1);
  assert.equal((await saved(page)).activeSession,null);
  await page.reload();
  assert.equal((await saved(page)).sessions.length,1);
});

test('partial invalid drafts survive reopening and cannot log stale values or finish silently',async t=>{
  const page=await open(t,{...blank(),workouts:[deck()]});
  await library(page);
  await libraryCard(page,bench.catalogId).click();
  await page.locator('[data-act="logset"]').click();
  await page.locator('[data-role="weight"]').fill('22,.');
  await page.reload();
  await page.locator('#t-resume-exercise').click();
  assert.equal(await page.locator('[data-role="weight"]').inputValue(),'22,.');
  await page.locator('[data-act="logset"]').click();
  await page.locator('[data-act="finishex"]').click();
  assert.equal((await saved(page)).activeSession.exercises[0].sets.length,1);
  assert.equal((await saved(page)).sessions.length,0);
  await page.locator('[data-role="weight"]').fill('22,5');
  await page.locator('[data-role="reps"]').fill('');
  await page.reload();
  await page.locator('#t-resume-exercise').click();
  assert.equal(await page.locator('[data-role="reps"]').inputValue(),'');
  await page.locator('[data-act="logset"]').click();
  assert.equal((await saved(page)).activeSession.exercises[0].sets.length,1);
  await page.locator('[data-role="reps"]').fill('9');
  await page.locator('[data-act="logset"]').click();
  assert.deepEqual((await saved(page)).activeSession.exercises[0].sets.map(({weight,reps})=>({weight,reps})),[
    {weight:20,reps:8},{weight:22.5,reps:9}
  ]);
});

test('an unfinished set edit resumes after reload and applies to exactly one existing set',async t=>{
  const page=await open(t,{...blank(),workouts:[deck()]});
  await library(page);
  await libraryCard(page,bench.catalogId).click();
  await page.locator('[data-act="logset"]').click();
  await page.locator('.set-chip').click();
  await page.locator('#modal-set-weight').fill('67,5');
  await page.locator('#modal-set-reps').fill('10');
  await page.keyboard.press('Escape');
  await page.locator('[data-act="finishex"]').click();
  assert.equal((await saved(page)).sessions.length,0);
  assert.equal(await page.locator('#modal-set-weight').isVisible(),true);
  assert.equal(await page.locator('#modal-set-weight').inputValue(),'67,5');
  await page.reload();
  await page.locator('#t-resume-exercise').click();
  assert.equal(await page.locator('#modal-set-weight').inputValue(),'67,5');
  assert.equal(await page.locator('#modal-set-reps').inputValue(),'10');
  assert.equal((await saved(page)).activeSession.exercises[0].sets[0].weight,20);
  await page.locator('#modal-set-save').click();
  const sets=(await saved(page)).activeSession.exercises[0].sets;
  assert.equal(sets.length,1);
  assert.equal(sets[0].weight,67.5);
  assert.equal(sets[0].reps,10);
  await page.locator('.set-chip').click();
  await page.locator('#modal-set-weight').fill('99');
  await page.locator('#modal-set-cancel').click();
  await page.reload();
  await page.locator('#t-resume-exercise').click();
  assert.equal(await page.locator('#modalOverlay').evaluate(el=>el.classList.contains('show')),false);
  await page.locator('.set-chip').click();
  assert.equal(await page.locator('#modal-set-weight').inputValue(),'67.5');
});

test('imported valid input drafts determine the logged values instead of stale numeric controls',async t=>{
  const active={...session('active',bench,{sets:[]}),kind:'exercise'};
  active.exercises[0].finished=false;
  active.exercises[0].draftInputs={weight:'77,5',reps:'12'};
  const page=await open(t,{...blank(),workouts:[deck()],activeSession:active});
  await page.locator('#t-resume-exercise').click();
  assert.equal(await page.locator('[data-role="weight"]').inputValue(),'77,5');
  await page.locator('[data-act="logset"]').click();
  const next=(await saved(page)).activeSession.exercises[0];
  assert.equal(next.sets.length,1);
  assert.equal(next.sets[0].weight,77.5);
  assert.equal(next.sets[0].reps,12);
});

test('cancelling a switch to another exercise or workout keeps the unfinished exercise intact',async t=>{
  const page=await open(t,{...blank(),workouts:[deck()]});
  await library(page);
  await libraryCard(page,bench.catalogId).click();
  await page.locator('[data-act="logset"]').click();
  const before=await saved(page);
  page.removeAllListeners('dialog');
  let prompts=0;
  page.on('dialog',dialog=>{prompts++; return dialog.dismiss();});
  await page.goBack();
  await libraryCard(page,incline.catalogId).click();
  assert.equal(prompts,1);
  assert.deepEqual(await saved(page),before);
  await page.reload();
  await page.locator('#t-workouts').click();
  await page.locator('.workout-start').click();
  assert.equal(prompts,2);
  assert.deepEqual(await saved(page),before);
  await page.reload();
  await page.locator('#t-resume-exercise').click();
  assert.equal(await page.locator('.set-chip').count(),1);
});

test('creating workout cards reuses selected identities and new draft cards share one stable identity',async t=>{
  const other={...bench,id:'other-card',catalogId:'exercise:other-bench',name:'Dumbbell Bench Press'};
  const page=await open(t,{...blank(),workouts:[deck('one',[bench]),deck('two',[other])]});
  await page.locator('#t-create').click();
  await page.locator('#cw-name').fill('Shared identity');
  await page.locator('#cw-exname').fill('Bench');
  await page.locator('.suggest-item[data-catalog-id="exercise:other-bench"]').click();
  await page.locator('#cw-addex').click();
  await page.locator('#cw-save').click();
  const chosen=(await saved(page)).workouts.at(-1).exercises[0];
  assert.equal(chosen.catalogId,other.catalogId);
  assert.notEqual(chosen.id,other.id);
  await page.reload();
  await page.locator('#t-create').click();
  await page.locator('#cw-name').fill('New identity');
  await page.locator('#cw-exname').fill('Cable Row');
  await page.locator('#cw-addex').click();
  await page.locator('#cw-exname').fill(' cable row ');
  await page.locator('#cw-addex').click();
  await page.locator('#cw-save').click();
  const added=(await saved(page)).workouts.at(-1).exercises;
  assert.match(added[0].catalogId,/^exercise:/);
  assert.equal(added[0].catalogId,added[1].catalogId);
  assert.notEqual(added[0].id,added[1].id);
  assert.notEqual(added[0].catalogId,bench.catalogId);
});

test('ambiguous same-name identities are rejected without merging or overwriting the original data',async t=>{
  const other={...bench,id:'other-card',catalogId:'exercise:other-bench'};
  const state={...blank(),workouts:[deck('one',[bench]),deck('two',[other])],sessions:[
    session('s1',bench),session('s2',other,{workoutId:'two',sets:[{weight:20,reps:15,time:'2026-10-24T12:01:00Z'}]})
  ]};
  const dialogs=[];
  const page=await open(t,state,dialogs);
  assert(dialogs.some(message=>/different.*identit.*share.*name/i.test(message)));
  assert.equal(await page.evaluate(()=>localStorage.getItem('racked_state_v1')),JSON.stringify(state));
  await library(page);
  assert.equal(await page.locator('.exercise-library-card').count(),0);
  await page.locator('#ex-add').click();
  await page.locator('#exercise-name').fill('Recovery must not overwrite');
  await page.locator('#exercise-save').click();
  assert.equal(await page.evaluate(()=>localStorage.getItem('racked_state_v1')),JSON.stringify(state));
  assert.equal(await page.locator('#exercise-save').isVisible(),true);
});

test('one persistent identity shares progression across template instances and individual logging',async t=>{
  const second={...bench,id:'second-template-card'};
  const state={...blank(),workouts:[deck('one',[bench]),deck('two',[second])],sessions:[
    session('s1',bench,{workoutId:'one',date:'2026-10-22T12:00:00Z'}),
    session('s2',second,{workoutId:'two',date:'2026-10-23T12:00:00Z'})
  ]};
  const page=await open(t,state);
  await page.locator('#t-workouts').click();
  await page.locator('.workout-start').last().click();
  assert.equal((await saved(page)).activeSession.exercises[0].exerciseId,second.id);
  assert.equal((await saved(page)).activeSession.exercises[0].catalogId,bench.catalogId);
  await page.locator('[data-act="logset"]').click();
  await page.locator('[data-act="finishex"]').click();
  await page.locator('#sessFinishBottom').click();
  await page.reload();
  await library(page);
  assert.equal(await page.locator('.exercise-library-card').count(),1);
  await libraryCard(page,bench.catalogId).click();
  await page.locator('[data-act="logset"]').click();
  await page.locator('[data-act="finishex"]').click();
  assert.equal((await saved(page)).sessions.length,4);
  await page.reload();
  await page.locator('#t-progress').click();
  assert.equal(await page.locator('.chart-card').count(),1);
  assert.match(await page.locator('.cc-sub').innerText(),/4 data points/);
});

test('legacy history keeps original records and its existing name groups while explaining ambiguity',async t=>{
  const legacy={...bench}; delete legacy.catalogId;
  const second={...legacy,id:'second-legacy-card',name:' bench press '};
  const historical=[session('legacy-one',legacy),session('legacy-two',second,{workoutId:'two'})];
  historical[0].exercises[0].unknownMetadata={preserve:['old',1]};
  const state={...blank(),workouts:[deck('one',[legacy]),deck('two',[second])],sessions:historical};
  const page=await open(t,state);
  await library(page);
  assert.equal(await page.locator('.exercise-library-card').count(),1);
  assert.match(await page.locator('#view-exercises').innerText(),/legacy|older|historical/i);
  assert.match(await page.locator('#view-exercises').innerText(),/name/i);
  await page.locator('.exercise-library-card').click();
  const next=await saved(page);
  const catalogId='legacy-name:'+JSON.stringify('bench press');
  const expectedHistory=historical.map(sess=>({...sess,exercises:sess.exercises.map(ex=>({...ex,catalogId}))}));
  const expectedWorkouts=state.workouts.map(w=>({...w,exercises:w.exercises.map(ex=>({...ex,catalogId}))}));
  assert.deepEqual(next.sessions,expectedHistory);
  assert.deepEqual(next.workouts,expectedWorkouts);
  assert.equal(next.activeSession.exercises[0].catalogId,'legacy-name:'+JSON.stringify('bench press'));
  await page.locator('[data-act="logset"]').click();
  await page.locator('[data-act="finishex"]').click();
  assert.deepEqual((await saved(page)).sessions.slice(0,2),expectedHistory);
  await page.reload();
  await page.locator('#t-progress').click();
  assert.equal(await page.locator('.chart-card').count(),1);
  assert.match(await page.locator('.cc-sub').innerText(),/3 data points/);
});

test('full and category backups preserve persistent identities and a resumable individual exercise',async t=>{
  const page=await open(t,{...blank(),workouts:[deck()],sessions:[session('s1',bench)]});
  await library(page);
  await libraryCard(page,incline.catalogId).click();
  await page.locator('[data-act="logset"]').click();
  await page.locator('[data-role="notes"]').fill('Resume me');
  await page.reload();
  await page.locator('#t-backup').click();
  const downloadEvent=page.waitForEvent('download');
  await page.locator('#bk-export-full').click();
  const download=await downloadEvent;
  const exported=JSON.parse(await readFile(await download.path(),'utf8'));
  assert.equal(exported.activeSession.kind,'exercise');
  assert.equal(exported.activeSession.exercises[0].catalogId,incline.catalogId);
  assert.equal(exported.activeSession.exercises[0].notes,'Resume me');
  await importFile(page,'#bk-file-workouts',{version:1,workouts:exported.workouts});
  assert.deepEqual((await saved(page)).activeSession,exported.activeSession);
  await importFile(page,'#bk-file-sessions',{version:1,sessions:exported.sessions});
  assert.deepEqual((await saved(page)).workouts,exported.workouts);
  assert.deepEqual((await saved(page)).activeSession,exported.activeSession);
  await importFile(page,'#bk-file-full',exported);
  assert.deepEqual(await saved(page),exported);
  await page.locator('#t-resume-exercise').click();
  assert.equal(await page.locator('.ex-name').textContent(),'Incline Bench Press');
  assert.equal(await page.locator('.set-chip').count(),1);
});
