const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFile} = require('node:fs/promises');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const html = readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const historyCode = html.slice(html.indexOf('function exerciseCatalogId('),html.indexOf('function renderExercisesLibrary('));
const metricCode = html.slice(html.indexOf('function est1RM('),html.indexOf('function paintWorkoutProgress('));
const {browserSuite,seedState} = require('./browser-helper.cjs');

const app = browserSuite({engine:process.env.RACKED_TEST_BROWSER || 'chromium'});
const bench = {id:'exercise:bench',name:'Bench Press',custom:{keep:'definition'}};
const light = {id:'exercise:light',name:'Light Bench Press'};
const blank = ()=>({version:2,exercises:[bench,light],workouts:[],sessions:[],measurements:[],activeSession:null});
const card = (id='card',catalogId=bench.id,weight=25,reps=12)=>({id,catalogId,name:catalogId===bench.id ? bench.name : light.name,weight,reps,notes:'Template note'});
const workout = (id='push',exercises=[card()])=>({id,name:id==='push' ? 'Push Day' : 'Upper Body',exercises,custom:{keep:'template'}});
const set = (weight,reps,time='2026-11-01T12:01:00Z')=>({weight,reps,time,custom:{keep:'set'}});
function session(id,date,sets,{catalogId=bench.id,workoutId='push',kind,exerciseId='card'}={}){
  return {id,date,workoutId,workoutName:workoutId==='push' ? 'Push Day' : 'Upper Body',...(kind ? {kind} : {}),custom:{keep:'session'},
    exercises:[{exerciseId,catalogId,name:catalogId===bench.id ? bench.name : light.name,notes:'Historical cue <keep>',
      weight:25,reps:12,startWeight:25,startReps:12,finished:true,sets,custom:{keep:'entry'}}]};
}
async function open(t,state=blank()){
  const context = await app.context(t);
  await seedState(context,state);
  const page = await context.newPage();
  page.on('dialog',dialog=>dialog.type()==='confirm' ? dialog.accept() : dialog.dismiss());
  await page.goto(app.origin);
  return page;
}
async function saved(page){return page.evaluate(()=>JSON.parse(localStorage.getItem('racked_state_v1')));}
async function download(page,selector){
  const event=page.waitForEvent('download');
  await page.locator(selector).click();
  return JSON.parse(await readFile(await (await event).path(),'utf8'));
}
async function importFile(page,selector,data){
  await page.locator(selector).setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
  await page.waitForFunction(selector=>!document.querySelector(selector)?.value,selector);
}

// Raw completed sessions are the sole source for history; active drafts never contribute.
test('shared history keeps every set, one best 1RM per session, chronological IDs and independent exercises',()=>{
  const untimed={weight:10,reps:1,custom:{keep:'untimed'}};
  const early=session('early','2026-11-01T12:00:00Z',[set(40,12,'2026-11-01T12:02:00Z'),untimed,set(60,8)]);
  const secondEntry={...early.exercises[0],exerciseId:'second-card',sets:[set(70,3,'2026-11-01T12:03:00Z')]};
  early.exercises.push(secondEntry);
  const upper=session('upper','2026-11-04T12:00:00Z',[set(65,6,'2026-11-04T12:01:00Z')],{workoutId:'upper'});
  const individual=session('individual','2026-11-04T12:00:00Z',[set(90,1,'2026-11-04T14:00:00Z')],{workoutId:'library:bench',kind:'exercise'});
  const other=session('light','2026-11-04T12:00:00Z',[set(10,8,'2026-11-04T14:01:00Z')],{catalogId:light.id});
  const empty=session('empty','2026-11-05T12:00:00Z',[]);
  const active=session('active','2026-11-06T12:00:00Z',[set(200,8,'2026-11-06T12:01:00Z')]);
  active.exercises[0].finished=false;
  const initial={...blank(),workouts:[workout(),workout('upper',[card('upper-card')])],sessions:[upper,early,individual,other,empty],activeSession:active};
  const original=structuredClone(initial);
  const context=vm.createContext({state:initial});
  vm.runInContext(historyCode+'\n'+metricCode,context);
  const history=JSON.parse(JSON.stringify(vm.runInContext(`getExerciseHistory('exercise:bench').map(({session,sets,bestSet,bestEstimated1RM})=>({sessionId:session.id,date:session.date,workoutName:session.workoutName,sets,bestSet,bestEstimated1RM}))`,context)));
  assert.deepEqual(history.map(row=>row.sessionId),['early','upper','individual']);
  assert.deepEqual(history.map(row=>row.bestEstimated1RM),[77,78,90]);
  assert.deepEqual(history[0].sets,[untimed,early.exercises[0].sets[2],early.exercises[0].sets[0],...secondEntry.sets],
    'unsorted sets become chronological, using session date when a set has no timestamp');
  assert.deepEqual(history[0].bestSet,secondEntry.sets[0]);
  assert.equal(history[1].workoutName,'Upper Body');
  assert.equal(history[1].date,history[2].date,'same dates remain separate session points');
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext(`getExerciseHistory('exercise:light').map(row=>row.session.id)`,context))),['light']);
  assert.deepEqual(initial,original,'reading history must not rewrite originals');
});

test('workout controls use the latest logged set across sources and retain template fallbacks without history',async t=>{
  const olderStart=session('resumed','2026-10-30T12:00:00Z',[set(100,8,'2026-10-30T12:01:00Z'),set(62.5,9,'2026-11-06T12:01:00Z')],{workoutId:'upper'});
  const individual=session('individual','2026-11-05T12:00:00Z',[set(90,3,'2026-11-05T12:01:00Z'),set(60,8,'2026-11-05T12:02:00Z')],{kind:'exercise',workoutId:'library:bench'});
  const template=workout('push',[card(),card('light-card',light.id,17.5,15)]);
  const page=await open(t,{...blank(),workouts:[template],sessions:[olderStart,individual]});
  await page.locator('#t-workouts').click();
  await page.locator('.workout-start').click();
  assert.equal(await page.locator('[data-role="weight"]').first().inputValue(),'62.5');
  assert.equal(await page.locator('[data-role="reps"]').first().inputValue(),'9');
  const active=(await saved(page)).activeSession;
  assert.deepEqual(active.exercises.map(({weight,reps,startWeight,startReps})=>({weight,reps,startWeight,startReps})),[
    {weight:62.5,reps:9,startWeight:62.5,startReps:9},{weight:17.5,reps:15,startWeight:17.5,startReps:15}
  ]);
  assert.deepEqual((await saved(page)).workouts,[template]);
  await page.reload();
  await page.locator('#t-workouts').click();
  await page.locator('.workout-start').click();
  assert.deepEqual((await saved(page)).activeSession,active,'resume retains the existing active-session controls');
});

test('same-date performances are individually inspectable with all original sets and graph point selection',async t=>{
  const first=session('morning-session','2026-11-04T08:00:00Z',[set(60,8,'2026-11-04T08:01:00Z'),set(45,12,'2026-11-04T08:02:00Z')]);
  const second=session('evening-session','2026-11-04T08:00:00Z',[set(70,6,'2026-11-04T18:01:00Z')],{workoutId:'upper'});
  const page=await open(t,{...blank(),sessions:[first,second]});
  await page.locator('#t-progress').click();
  assert.equal(await page.locator('.chart-card').count(),1);
  assert.match(await page.locator('.cc-sub').innerText(),/2 data points/);
  const rows=page.locator('#exercise-history-entries [data-history-index]');
  assert.equal(await rows.count(),2);
  const firstRow=rows.filter({hasText:'Push Day'});
  await firstRow.focus();
  await page.keyboard.press('Enter');
  let text=await page.getByRole('dialog').innerText();
  assert.match(text,/morning-session/);
  assert.match(text,/60\s*kg\s*×\s*8/);
  assert.match(text,/45\s*kg\s*×\s*12/);
  assert.match(text,/Nov|November/);
  assert.match(text,/Historical cue <keep>/);
  assert.equal(await page.getByRole('dialog').locator('keep').count(),0);
  await page.keyboard.press('Escape');
  assert.equal(await firstRow.evaluate(el=>el===document.activeElement),true);
  // The last point is at the chart's right padding and maximum Y value.
  const canvas=page.locator('.chart');
  const box=await canvas.boundingBox();
  const y=14+(box.height-14-22)*(.18/1.36);
  await canvas.click({position:{x:box.width-10,y}});
  text=await page.getByRole('dialog').innerText();
  assert.match(text,/evening-session/);
  assert.match(text,/Upper Body/);
  assert.match(text,/70\s*kg\s*×\s*6/);
  assert.doesNotMatch(text,/45\s*kg\s*×\s*12/);
});

test('rename retains shared history and derived export while raw sessions and full backups stay lossless',async t=>{
  const historical=session('source','2026-11-01T12:00:00Z',[set(60,8),set(40,12,'2026-11-01T12:02:00Z')]);
  const active=session('unfinished','2026-11-06T12:00:00Z',[set(22,8,'2026-11-06T12:01:00Z')],{kind:'exercise',workoutId:'library:bench'});
  active.exercises[0].finished=false;
  active.exercises[0].draftInputs={weight:'22,.',reps:'',custom:{keep:'draft'}};
  active.editSetDraft={exerciseIndex:0,setIndex:0,weight:'23,',reps:'',custom:{keep:'edit'}};
  const initial={...blank(),workouts:[workout()],sessions:[historical],activeSession:active,measurements:[{id:'waist',date:'2026-11-01',part:'Waist',value:80,custom:{keep:true}}],custom:{keep:'root'}};
  const page=await open(t,initial);
  await page.locator('#t-exercises').click();
  await page.locator('[data-rename-id="exercise:bench"]').click();
  await page.locator('#exercise-name').fill('Flat Bench Press');
  await page.locator('#exercise-save').click();
  await page.reload();
  await page.locator('#t-progress').click();
  assert.equal(await page.locator('.cc-title').textContent(),'Flat Bench Press');
  await page.reload();
  await page.locator('#t-backup').click();
  const before=await saved(page);
  const analytical=await download(page,'#bk-export-exercise-progression');
  assert.equal(analytical.type,'racked-exercise-progression');
  assert.equal(analytical.version,1);
  assert.deepEqual(analytical.exercises,before.exercises);
  assert.deepEqual(analytical.progression,[{catalogId:bench.id,name:'Flat Bench Press',sessionId:historical.id,sessionDate:historical.date,workoutId:historical.workoutId,workoutName:historical.workoutName,bestEstimated1RM:76}]);
  assert.equal(Object.hasOwn(analytical,'sessions'),false);
  const raw=await download(page,'#bk-export-sessions');
  assert.equal(raw.type,'racked-sessions');
  assert.equal(raw.version,2);
  assert.deepEqual(raw.sessions,initial.sessions);
  const full=await download(page,'#bk-export-full');
  assert.deepEqual(full,before);
  assert.deepEqual(full.activeSession,initial.activeSession);
  assert.deepEqual(full.workouts,initial.workouts);
  assert.deepEqual(full.measurements,initial.measurements);
  assert.deepEqual(await saved(page),before,'analytical exports never modify localStorage');
  await importFile(page,'#bk-file-full',full);
  assert.deepEqual(await saved(page),full);
  await page.locator('#t-resume-exercise').click();
  assert.equal(await page.locator('#modal-set-weight').inputValue(),'23,');
  assert.equal(await page.locator('#modal-set-reps').inputValue(),'');
  await page.locator('#modal-set-cancel').click();
  assert.equal(await page.locator('[data-role="weight"]').inputValue(),'22,.');
  assert.equal(await page.locator('[data-role="reps"]').inputValue(),'');
});

test('completing an individual session updates the shared graph and next workout without a persistent progression copy',async t=>{
  const historical=session('source','2026-11-01T12:00:00Z',[set(60,8)]);
  const page=await open(t,{...blank(),workouts:[workout()],sessions:[historical]});
  await page.locator('#t-exercises').click();
  await page.locator('[data-catalog-id="exercise:bench"]').click();
  await page.locator('[data-role="weight"]').fill('65');
  await page.locator('[data-role="reps"]').fill('9');
  await page.locator('[data-act="logset"]').click();
  await page.locator('[data-act="finishex"]').click();
  await page.reload();
  await page.locator('#t-progress').click();
  assert.match(await page.locator('.cc-sub').innerText(),/2 data points/);
  const data=await saved(page);
  assert.equal(data.sessions.length,2);
  assert.equal(data.sessions[1].kind,'exercise');
  assert.deepEqual(data.sessions[0],historical);
  assert.deepEqual(data.exercises,[bench,light]);
  assert.deepEqual(Object.keys(data).sort(),Object.keys(blank()).sort());
  await page.reload();
  await page.locator('#t-workouts').click();
  await page.locator('.workout-start').click();
  assert.equal(await page.locator('[data-role="weight"]').inputValue(),'65');
  assert.equal(await page.locator('[data-role="reps"]').inputValue(),'9');
});

test('category import replaces the derived view while preserving active drafts and legacy backup compatibility',async t=>{
  const historical=session('old','2026-11-01T12:00:00Z',[set(60,8)]);
  const active=session('active','2026-11-06T12:00:00Z',[],{kind:'exercise',workoutId:'library:bench'});
  active.exercises[0].finished=false;
  active.exercises[0].draftInputs={weight:'35,',reps:'11',custom:{keep:true}};
  const initial={...blank(),workouts:[workout()],sessions:[historical],activeSession:active};
  const page=await open(t,initial);
  const replacement=session('replacement','2026-11-05T12:00:00Z',[set(72.5,5,'2026-11-05T12:01:00Z')],{workoutId:'upper'});
  await page.locator('#t-backup').click();
  await importFile(page,'#bk-file-sessions',{type:'racked-sessions',version:2,exercises:[bench],sessions:[replacement]});
  assert.deepEqual((await saved(page)).activeSession,active);
  assert.deepEqual((await saved(page)).workouts,initial.workouts);
  await page.reload();
  await page.locator('#t-progress').click();
  await page.locator('#exercise-history-entries [data-history-index]').click();
  assert.match(await page.getByRole('dialog').innerText(),/replacement/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#exercise-history-entries [data-history-index]').count(),1);
  await page.reload();
  await page.locator('#t-backup').click();
  const legacy={version:1,workouts:initial.workouts,sessions:[historical],measurements:[],activeSession:active,custom:{keep:'v1'}};
  await importFile(page,'#bk-file-full',legacy);
  const restored=await saved(page);
  assert.deepEqual(restored.sessions,[historical]);
  assert.deepEqual(restored.activeSession,active);
  assert.equal(restored.custom.keep,'v1');
  await page.locator('#t-progress').click();
  await page.locator('#exercise-history-entries [data-history-index]').click();
  assert.match(await page.getByRole('dialog').innerText(),/Session: old/);
  await page.keyboard.press('Escape');
  await page.reload();
  await page.locator('#t-resume-exercise').click();
  assert.equal(await page.locator('[data-role="weight"]').inputValue(),'35,');
  assert.equal(await page.locator('[data-role="reps"]').inputValue(),'11');
});


test('history list and original-set inspection render imported names, session IDs and notes as inert text',async t=>{
  const name='<img src=x onerror="window.historyInjected=1">';
  const id='session"><svg onload="window.historyInjected=1">';
  const historical=session(id,'2026-11-01T12:00:00Z',[set(60,8)]);
  historical.workoutName='<svg onload="window.historyInjected=1">';
  historical.exercises[0].name=name;
  historical.exercises[0].notes='<script>window.historyInjected=1</script>';
  const page=await open(t,{...blank(),exercises:[{...bench,name},light],sessions:[historical]});
  await page.locator('#t-progress').click();
  assert.equal(await page.locator('.cc-title').textContent(),name);
  await page.locator('#exercise-history-entries [data-history-index]').click();
  const dialog=page.getByRole('dialog');
  const text=await dialog.innerText();
  assert(text.includes(name));
  assert(text.includes(id));
  assert(text.includes(historical.workoutName));
  assert(text.includes(historical.exercises[0].notes));
  assert.equal(await dialog.locator('img,svg,script').count(),0);
  assert.equal(await page.evaluate(()=>window.historyInjected),undefined);
});


test('live plateau suggestion still compares the best-set reps in the last two sessions',async t=>{
  for(const reps of [8,7]){
    const older=session('older','2026-11-01T12:00:00Z',[set(100,5)]);
    const previous=session('previous','2026-11-04T12:00:00Z',[set(60,8,'2026-11-04T12:01:00Z'),set(20,3,'2026-11-04T12:02:00Z')]);
    const latest=session('latest','2026-11-05T12:00:00Z',[set(65,reps,'2026-11-05T12:01:00Z'),set(25,3,'2026-11-05T12:02:00Z')],{kind:'exercise',workoutId:'library:bench'});
    const unrelated=session('unrelated','2026-11-06T12:00:00Z',[set(10,3,'2026-11-06T12:01:00Z')],{catalogId:light.id});
    const page=await open(t,{...blank(),workouts:[workout()],sessions:[latest,older,unrelated,previous]});
    await page.locator('#t-workouts').click();
    await page.locator('.workout-start').click();
    assert.equal(await page.locator('[data-role="weight"]').inputValue(),'25');
    assert.equal(await page.locator('[data-role="reps"]').inputValue(),'3','starting values still use the last logged set');
    const hint=page.locator('.progress-hint');
    if(reps===8){
      assert.equal(await hint.textContent(),'↗ Same rep count (8) the last 2 times — maybe push for one more today.');
    } else {
      assert.equal(await hint.count(),0,'matching final-set reps do not override different best-set reps');
    }
  }
});
