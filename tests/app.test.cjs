const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFile} = require('node:fs/promises');
const {join} = require('node:path');
const {browserSuite,seedState} = require('./browser-helper.cjs');

let shellFailure = false;
let legacyWorker = false;
const app = browserSuite({respond:async(name,req,res)=>{
  if(shellFailure && name==='index.html'){res.writeHead(503).end('Unavailable');return true;}
  if(name==='sw.js' && legacyWorker){
    res.setHeader('Content-Type','application/javascript');
    res.end(await readFile(join(__dirname,'fixtures/sw-v4.js')));return true;
  }
}});
const blank = ()=>({version:1,workouts:[],sessions:[],measurements:[],activeSession:null});
function workout(id='w',name='Strength'){
  return {id,name,exercises:[{id:'e',name:'Squat',weight:40,reps:8,notes:'Keep this cue'}]};
}
async function open(t, state=blank(), options={}){
  const context = await app.context(t,options);
  await seedState(context,state);
  const page = await context.newPage();
  page.on('dialog',dialog=>dialog.type()==='confirm'?dialog.accept():dialog.dismiss());
  await page.goto(app.origin);
  return page;
}
async function saved(page){return page.evaluate(()=>JSON.parse(localStorage.getItem('racked_state_v1')));}
async function importFile(page,id,value){
  await page.locator(id).setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
  // File reading, replacement confirmation and persistence happen asynchronously.
  // A reload must not abort the import while the input still holds the file.
  await page.waitForFunction(selector=>{
    const input=document.querySelector(selector);
    return !input || input.value==='';
  },id);
}

test('workout creation, session sets, edit/delete/reopen, defaults and persistence',async t=>{
  const page = await open(t);
  await page.locator('#t-create').click();
  await page.locator('#cw-name').fill('Strength');
  await page.locator('#cw-exname').fill('Squat');
  await page.locator('#cw-exweight').fill('40');
  await page.locator('#cw-addex').click();
  await page.locator('#cw-save').click();
  await page.locator('.workout-start').click();
  await page.locator('[data-act="logset"]').click();
  await page.locator('[data-act="finishex"]').click();
  await page.locator('.set-chip').click();
  await page.locator('#modal-set-weight').fill('42.5');
  await page.locator('#modal-set-save').click();
  assert.equal((await saved(page)).workouts[0].exercises[0].weight,42.5);
  await page.locator('[data-act="reopenex"]').click();
  await page.locator('[data-act="logset"]').click();
  await page.locator('.set-chip').last().click();
  await page.locator('#modal-set-delete').click();
  await page.locator('[data-act="finishex"]').click();
  await page.locator('#sessFinishBottom').click();
  await page.reload();
  const state = await saved(page);
  assert.equal(state.sessions.length,1);
  assert.equal(state.sessions[0].exercises[0].sets.length,1);
  assert.equal(state.sessions[0].exercises[0].sets[0].weight,42.5);
  assert.equal(state.activeSession,null);
});

test('editing workout preserves existing exercise notes',async t=>{
  const page=await open(t,{...blank(),workouts:[workout()]});
  await page.locator('#t-workouts').click();
  await page.locator('[data-edit]').click();
  await page.locator('#cw-name').fill('Renamed');
  await page.locator('#cw-save').click();
  assert.equal((await saved(page)).workouts[0].exercises[0].notes,'Keep this cue');
});

test('full backup round-trip preserves resumable fields and unknown metadata',async t=>{
  const page=await open(t);
  const data={...blank(),customMetadata:{source:'existing-v1'},workouts:[workout()],activeSession:{
    id:'s',workoutId:'w',workoutName:'Strength',date:'2026-10-24T12:00:00Z',exercises:[{
      exerciseId:'e',name:'Squat',notes:'Knees out',weight:43,reps:9,startWeight:40,startReps:8,finished:false,
      sets:[{weight:42,reps:8,time:'2026-10-24T12:05:00Z'}]
    }]
  }};
  await page.locator('#t-backup').click();
  await importFile(page,'#bk-file-full',data);
  await page.locator('#t-workouts').click();
  await page.locator('.workout-start').click();
  assert.equal(await page.locator('[data-role="weight"]').inputValue(),'43');
  assert.equal(await page.locator('[data-role="reps"]').inputValue(),'9');
  await page.locator('[data-act="wup"]').click();
  assert.equal((await saved(page)).activeSession.exercises[0].weight,43.5);
  assert.deepEqual((await saved(page)).customMetadata,{source:'existing-v1'});
});

test('malformed imports are rejected atomically without replacing existing records',async t=>{
  const data={...blank(),workouts:[workout()]};
  const page=await open(t,data);
  await page.locator('#t-backup').click();
  const cases=[
    ['#bk-file-workouts',{workouts:[null]}],
    ['#bk-file-sessions',{sessions:[{date:'not-a-date'}]}],
    ['#bk-file-sessions',{sessions:[{date:'2026-02-30',exercises:[]}]}],
    ['#bk-file-sessions',{sessions:[{exercises:[{name:{bad:true}}]}]}],
    ['#bk-file-measurements',{measurements:[{part:'Waist',value:'Infinity'}]}],
    ['#bk-file-full',{workouts:[]}]
  ];
  for(const [id,value] of cases){
    await importFile(page,id,value);
    await page.waitForFunction(()=>[...document.querySelectorAll('input[type=file]')].every(input=>!input.value));
    assert.deepEqual(await saved(page),data);
  }
});

test('imported IDs remain inert text while workouts remain editable and runnable',async t=>{
  const page=await open(t);
  const id='w"><img src=x onerror="window.injected=1">';
  await page.locator('#t-backup').click();
  await importFile(page,'#bk-file-workouts',{workouts:[workout(id)]});
  await page.reload();
  await page.locator('#t-workouts').click();
  assert.equal(await page.locator('#view-workouts img').count(),0);
  assert.equal(await page.evaluate(()=>window.injected),undefined);
  await page.locator('[data-edit]').click();
  assert.equal(await page.locator('#cw-name').inputValue(),'Strength');
  await page.locator('#cw-save').click();
  await page.locator('.workout-start').click();
  assert.equal((await saved(page)).activeSession.workoutId,id);
});

test('prototype-like names work in charts, measurement forms and copied summaries',async t=>{
  const data={...blank(),measurements:[{id:'m',part:'__proto__',value:12,date:'2026-10-24'}],sessions:[{
    id:'s',workoutId:'w',workoutName:'Strength',date:'2026-10-24T12:00:00Z',exercises:[{
      exerciseId:'e',name:'constructor',sets:[{weight:40,reps:8}]
    }]
  }]};
  const page=await open(t,data);
  await page.locator('#t-progress').click();
  assert.equal(await page.locator('.cc-title').textContent(),'constructor');
  await page.locator('#seg-size').click();
  assert.equal(await page.locator('.cc-title').textContent(),'__proto__');
  await page.reload();
  await page.locator('#t-backup').click();
  await page.evaluate(()=>{window.summary=''; navigator.clipboard.writeText=async text=>{window.summary=text;};});
  await page.locator('#bk-copy').click();
  assert.match(await page.evaluate(()=>window.summary),/__proto__: latest 12cm/);
  await page.reload();
  await page.locator('#t-measure').click();
  await page.locator('#ms-customname').fill('__proto__');
  await page.locator('#ms-addcustom').click();
  assert.equal(await page.locator('[data-part="__proto__"]').inputValue(),'');
  await page.locator('[data-part="__proto__"]').fill('13');
  await page.locator('#ms-save').click();
  assert.equal((await saved(page)).measurements.at(-1).value,13);
});

test('date-only measurements display the chosen day west of UTC',async t=>{
  const page=await open(t,{...blank(),measurements:[{id:'m',part:'Waist',value:80,date:'2026-10-24'}]}, {timezoneId:'America/Los_Angeles',locale:'en-US'});
  await page.locator('#t-progress').click();
  await page.locator('#seg-size').click();
  assert.equal(await page.locator('.er-date').innerText(),'Oct 24, 2026');
});

test('failed writes preserve durable data and report no import success',async t=>{
  const data={...blank(),workouts:[workout()]};
  const page=await open(t,data);
  await page.locator('#t-backup').click();
  await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException('Quota exceeded','QuotaExceededError');};});
  await importFile(page,'#bk-file-workouts',{workouts:[workout('new','Unsaved')]});
  await page.waitForFunction(()=>!document.getElementById('bk-file-workouts').value);
  assert.deepEqual(await saved(page),data);
  assert.doesNotMatch(await page.locator('#toast').innerText(),/imported/);
  await page.reload();
  await page.locator('#t-workouts').click();
  assert.equal(await page.locator('.workout-start').innerText(),'Strength\n1 exercise');
});

test('invalid stored data is preserved, exported byte-for-byte and recoverable',async t=>{
  const raw='{"workouts": [null], "important": "preserve me"}';
  const page=await open(t,raw);
  await page.locator('#t-create').click();
  await page.locator('#cw-name').fill('Should not overwrite');
  await page.locator('#cw-exname').fill('Squat');
  await page.locator('#cw-addex').click();
  await page.locator('#cw-save').click();
  assert.equal(await page.evaluate(()=>localStorage.getItem('racked_state_v1')),raw);
  await page.reload();
  await page.locator('#t-backup').click();
  const downloadEvent=page.waitForEvent('download');
  await page.locator('#bk-export-full').click();
  const download=await downloadEvent;
  assert.equal(await readFile(await download.path(),'utf8'),raw);
  await importFile(page,'#bk-file-full',blank());
  await page.locator('#t-create').waitFor();
  assert.deepEqual(await saved(page),{...blank(),version:2,exercises:[]});
});

test('browser PWA install, HTTP-error fallback and offline query navigation',async t=>{
  const context=await app.context(t,{serviceWorkers:'allow'});
  const page=await context.newPage();
  await page.goto(app.origin);
  await page.evaluate(()=>caches.open('unrelated-app-cache').then(cache=>cache.put('/other',new Response('keep'))));
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  assert((await page.evaluate(()=>caches.keys())).includes('unrelated-app-cache'));
  shellFailure=true;
  try{
    await page.goto(app.origin+'/index.html?server-error=1');
    assert.equal(await page.title(),'Racked');
  } finally {shellFailure=false;}
  await context.setOffline(true);
  await page.goto(app.origin+'/?from=installed');
  assert.equal(await page.title(),'Racked');
  await page.locator('#t-create').click();
  assert.equal(await page.locator('#cw-name').count(),1);
});

test('set and measurement editors can retry after a failed write without stale records',async t=>{
  const data={...blank(),workouts:[workout()],measurements:[{id:'m',part:'Waist',value:80,date:'2026-10-24'}]};
  const page=await open(t,data);
  const failOnce=()=>page.evaluate(()=>{
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(...args){
      Storage.prototype.setItem=original;
      throw new DOMException('Quota exceeded','QuotaExceededError');
    };
  });
  await page.locator('#t-workouts').click();
  await page.locator('.workout-start').click();
  await page.locator('[data-act="logset"]').click();
  await page.locator('.set-chip').click();
  await page.locator('#modal-set-weight').fill('50');
  await failOnce();
  await page.locator('#modal-set-save').click();
  assert.equal((await saved(page)).activeSession.exercises[0].sets[0].weight,40);
  await page.locator('#modal-set-save').click();
  assert.equal((await saved(page)).activeSession.exercises[0].sets[0].weight,50);
  await page.reload();
  await page.locator('#t-progress').click();
  await page.locator('#seg-size').click();
  await page.locator('.entry-row').click();
  await page.locator('#modal-m-value').fill('81');
  await failOnce();
  await page.locator('#modal-m-save').click();
  assert.equal((await saved(page)).measurements[0].value,80);
  await page.locator('#modal-m-save').click();
  assert.equal((await saved(page)).measurements[0].value,81);
});

test('invalid inline numbers are rejected and failed writes reset visible controls',async t=>{
  const page=await open(t,{...blank(),workouts:[workout()]});
  await page.locator('#t-workouts').click();
  await page.locator('.workout-start').click();
  const weight=page.locator('[data-role="weight"]');
  const reps=page.locator('[data-role="reps"]');
  await weight.fill('-5'); await weight.blur();
  assert.equal(await weight.inputValue(),'40');
  await reps.fill('1.5'); await reps.blur();
  assert.equal(await reps.inputValue(),'8');
  await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException('Quota','QuotaExceededError');};});
  await weight.fill('50'); await weight.blur();
  assert.equal(await weight.inputValue(),'40');
  await reps.fill('10'); await reps.blur();
  assert.equal(await reps.inputValue(),'8');
  await page.locator('[data-role="notes"]').fill('Unsaved');
  assert.equal(await page.locator('[data-role="notes"]').inputValue(),'');
  assert.equal((await saved(page)).activeSession.exercises[0].weight,40);
});

test('deleting the final set of a finished exercise restores its original defaults',async t=>{
  const page=await open(t,{...blank(),workouts:[workout()]});
  await page.locator('#t-workouts').click();
  await page.locator('.workout-start').click();
  await page.locator('[data-role="weight"]').fill('50');
  await page.locator('[data-role="weight"]').blur();
  await page.locator('[data-act="logset"]').click();
  await page.locator('[data-act="finishex"]').click();
  assert.equal((await saved(page)).workouts[0].exercises[0].weight,50);
  await page.locator('.set-chip').click();
  await page.locator('#modal-set-delete').click();
  assert.equal((await saved(page)).workouts[0].exercises[0].weight,40);
});

test('an installed v4 worker upgrades without deleting sibling caches or breaking offline launch',async t=>{
  const context=await app.context(t,{serviceWorkers:'allow'});
  const page=await context.newPage();
  legacyWorker=true;
  try {
    await page.goto(app.origin);
    await page.evaluate(()=>navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
    await page.evaluate(()=>caches.open('sibling-app-cache').then(cache=>cache.put('/other',new Response('keep'))));
  } finally {legacyWorker=false;}
  await page.evaluate(()=>new Promise((resolve,reject)=>{
    navigator.serviceWorker.addEventListener('controllerchange',()=>resolve(),{once:true});
    navigator.serviceWorker.getRegistration().then(reg=>reg.update()).catch(reject);
  }));
  assert((await page.evaluate(()=>caches.keys())).includes('sibling-app-cache'));
  const keys=await page.evaluate(()=>caches.keys());
  assert(keys.some(key=>key.startsWith('racked:') && key.endsWith(':v5')));
  await context.setOffline(true);
  await page.goto(app.origin+'/?upgraded=1');
  assert.equal(await page.title(),'Racked');
});

test('keyboard focus stays on session actions through repeated activation',async t=>{
  const page=await open(t,{...blank(),workouts:[workout()]});
  await page.locator('#t-workouts').click();
  await page.locator('.workout-start').click();
  await page.locator('[data-act="wup"]').focus();
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  assert.equal((await saved(page)).activeSession.exercises[0].weight,41);
  await page.locator('[data-act="logset"]').focus();
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  assert.equal((await saved(page)).activeSession.exercises[0].sets.length,2);
  await page.locator('[data-act="finishex"]').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.act),'reopenex');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.act),'finishex');
});

test('full and category exports download valid data without changing saved state',async t=>{
  const data={...blank(),workouts:[workout()]};
  const page=await open(t,data);
  const catalogId='legacy-name:'+JSON.stringify('squat');
  const expected={...data,version:2,exercises:[{id:catalogId,name:'Squat',legacy:true}],
    workouts:data.workouts.map(w=>({...w,exercises:w.exercises.map(ex=>({...ex,catalogId}))}))};
  await page.locator('#t-backup').click();
  for(const [button,category] of [['#bk-export-workouts','workouts'],['#bk-export-sessions','sessions'],['#bk-export-measurements','measurements'],['#bk-export-full',null]]){
    const event=page.waitForEvent('download');
    await page.locator(button).click();
    const download=await event;
    const json=JSON.parse(await readFile(await download.path(),'utf8'));
    assert.equal(json.version,2);
    if(category){
      assert.deepEqual(json[category],expected[category]);
      if(category==='workouts') assert.deepEqual(json.exercises,expected.exercises);
      if(category==='sessions') assert.deepEqual(json.exercises,[]);
    } else assert.deepEqual(json,expected);
  }
  assert.deepEqual(await saved(page),data);
});
