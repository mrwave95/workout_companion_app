const {test:runTest} = require('node:test');
const test=(name,fn)=>runTest(name,{timeout:30000},fn);
const assert = require('node:assert/strict');
const {readFile} = require('node:fs/promises');
const {browserSuite} = require('./browser-helper.cjs');
const engine = process.env.RACKED_TEST_BROWSER || 'chromium';
const app = browserSuite({engine,respond:(name,req,res)=>{
  if(name==='away'){res.setHeader('Content-Type','text/html');res.end('<title>Away</title>');return true;}
}});
const blank=()=>({version:1,workouts:[],sessions:[],measurements:[],activeSession:null});
const workout={id:'w',name:'Strength',exercises:[{id:'e',name:'Squat',weight:40,reps:8,notes:''}]};
const context=t=>app.context(t);
async function page(c){
  const p=await c.newPage();p.setDefaultTimeout(10000);
  p.on('dialog',d=>d.type()==='confirm'?d.accept():d.dismiss());
  await p.goto(app.origin);return p;
}
async function editable(p){await p.waitForFunction(()=>!document.getElementById('app').inert);}
async function stored(p){return p.evaluate(()=>JSON.parse(localStorage.getItem('racked_state_v1')));}
async function seed(p,state){await p.evaluate(state=>localStorage.setItem('racked_state_v1',JSON.stringify(state)),state);await p.reload();await editable(p);}
async function start(p){await p.locator('#t-workouts').click();await p.locator('.workout-start').click();}

test('a second tab cannot mutate; closing editor transfers latest session and notes',async t=>{
  const c=await context(t),first=await page(c);await editable(first);
  await seed(first,{...blank(),workouts:[workout]});await start(first);
  const second=await page(c);
  assert.equal(await second.locator('#app').evaluate(e=>e.inert),true);
  assert.match(await second.locator('#storageMessage').innerText(),/Another Racked tab/);
  // Even a programmatic event bypassing inert must fail the persistence guard.
  await second.evaluate(()=>document.getElementById('t-create').click());
  await second.locator('#cw-name').fill('Rejected',{force:true});
  await second.locator('#cw-exname').fill('Curl',{force:true});
  await second.evaluate(()=>{document.getElementById('cw-addex').click();document.getElementById('cw-save').click();});
  assert.equal((await stored(first)).workouts.length,1);
  await first.locator('[data-role="notes"]').fill('Latest form cue');
  await first.locator('[data-act="logset"]').click();
  await first.close();await editable(second);
  await start(second);
  assert.equal(await second.locator('[data-role="notes"]').inputValue(),'Latest form cue');
  assert.equal(await second.locator('.set-chip').count(),1);
  await second.locator('[data-act="logset"]').click();
  assert.equal((await stored(second)).activeSession.exercises[0].sets.length,2);
});

test('simultaneously opening tabs grants exactly one editor',async t=>{
  const c=await context(t);
  const tabs=await Promise.all([page(c),page(c),page(c)]);
  await tabs[0].waitForFunction(async()=>{
    const state=await navigator.locks.query();
    return state.held.filter(lock=>lock.name==='racked_state_v1').length===1
      && state.pending.filter(lock=>lock.name==='racked_state_v1').length===2;
  });
  const lockState=await tabs[0].evaluate(()=>navigator.locks.query());
  assert.equal(lockState.held.filter(lock=>lock.name==='racked_state_v1').length,1);
  assert.equal(lockState.pending.filter(lock=>lock.name==='racked_state_v1').length,2);
  assert.equal((await Promise.all(tabs.map(p=>p.locator('#app').evaluate(e=>!e.inert)))).filter(Boolean).length,1);
});

test('stale editor preserves outside writes and can export its own snapshot',async t=>{
  const c=await context(t),first=await page(c);await editable(first);
  await seed(first,{...blank(),workouts:[workout]});await start(first);
  await first.locator('[data-role="notes"]').fill('Local snapshot');
  const other=await page(c);
  const outside={...blank(),measurements:[{id:'outside',part:'Waist',value:80,date:'2026-10-24'}]};
  await other.evaluate(state=>localStorage.setItem('racked_state_v1',JSON.stringify(state)),outside);
  await first.locator('#storageNotice').waitFor({state:'visible'});
  assert.match(await first.locator('#storageMessage').innerText(),/changed outside/);
  assert.deepEqual(await stored(first),outside);
  const downloadEvent=first.waitForEvent('download');await first.locator('#storageExport').click();
  const download=await downloadEvent;
  const snapshot=JSON.parse(await readFile(await download.path(),'utf8'));
  assert.equal(snapshot.activeSession.exercises[0].notes,'Local snapshot');
  assert.deepEqual(await stored(first),outside);
});

test('pre-write check catches changes even if storage event has not run',async t=>{
  const c=await context(t),p=await page(c);await editable(p);
  await seed(p,{...blank(),workouts:[workout]});await start(p);
  await p.evaluate(()=>{
    const state=JSON.parse(localStorage.getItem('racked_state_v1'));
    state.measurements.push({id:'new',part:'Waist',value:81,date:'2026-10-24'});
    localStorage.setItem('racked_state_v1',JSON.stringify(state));
    // Same-document storage writes do not dispatch a storage event.
    document.querySelector('[data-act="logset"]').click();
  });
  assert.match(await p.locator('#storageMessage').innerText(),/changed outside/);
  const saved=await stored(p);
  assert.equal(saved.measurements.length,1);assert.equal(saved.activeSession.exercises[0].sets.length,0);
});

test('clear events and full restores cannot bypass stale-data protection',async t=>{
  const c=await context(t),p=await page(c);await editable(p);
  await seed(p,{...blank(),workouts:[workout]});await p.locator('#t-backup').click();
  await p.evaluate(()=>{
    localStorage.removeItem('racked_state_v1');
    window.dispatchEvent(new StorageEvent('storage',{key:null,storageArea:localStorage}));
  });
  assert.equal(await p.locator('#app').evaluate(e=>e.inert),true);
  assert.equal(await p.evaluate(()=>localStorage.getItem('racked_state_v1')),null);
  await p.locator('#bk-file-full').setInputFiles({name:'restore.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(blank()))});
  await p.waitForFunction(()=>!document.getElementById('bk-file-full').value);
  assert.equal(await p.evaluate(()=>localStorage.getItem('racked_state_v1')),null);
});

test('without Web Locks the app fails safely and still exports original data',async t=>{
  const c=await context(t);
  await c.addInitScript(()=>Object.defineProperty(navigator,'locks',{value:undefined}));
  const p=await page(c);
  assert.equal(await p.locator('#app').evaluate(e=>e.inert),true);
  assert.match(await p.locator('#storageMessage').innerText(),/Safe editing is unavailable/);
  const event=p.waitForEvent('download');await p.locator('#storageExport').click();
  const file=await event;
  assert.deepEqual(JSON.parse(await readFile(await file.path(),'utf8')),blank());
});

test('pending lock navigation cancels cleanly and lifecycle restores preserve drafts',async t=>{
  const c=await context(t),first=await page(c);await editable(first);
  const waiting=await page(c);await waiting.goto(app.origin+'/away');
  await first.locator('#t-create').click();await first.locator('#cw-name').fill('Draft retained');
  await first.evaluate(()=>{
    window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
    window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
  });
  await editable(first);
  assert.equal(await first.locator('#cw-name').inputValue(),'Draft retained');
  const locks=await first.evaluate(()=>navigator.locks.query());
  assert.equal(locks.held.filter(lock=>lock.name==='racked_state_v1').length,1);
  assert.equal(locks.pending.filter(lock=>lock.name==='racked_state_v1').length,0);
});

test('a suspended editor returning after another tab saves cannot overwrite newer data',async t=>{
  const c=await context(t),first=await page(c);await editable(first);
  await seed(first,{...blank(),workouts:[workout]});await start(first);
  const second=await page(c);
  await first.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  await editable(second);await start(second);await second.locator('[data-act="logset"]').click();
  await second.close();
  await first.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  await first.waitForFunction(()=>document.getElementById('storageMessage').textContent.includes('changed outside'));
  assert.equal((await stored(first)).activeSession.exercises[0].sets.length,1);
  assert.equal(await first.locator('#app').evaluate(e=>e.inert),true);
});


test('conflict export preserves unsaved exercise drafts without replacing metadata',async t=>{
  const c=await context(t),p=await page(c);await editable(p);
  await seed(p,{...blank(),rackedRecoveryDraft:{original:'metadata'}});
  await p.locator('#t-create').click();await p.locator('#cw-name').fill('Uncommitted workout');
  await p.locator('#cw-exname').fill('Squat');await p.locator('#cw-addex').click();
  await p.locator('#cw-exname').fill('Uncommitted second exercise');
  await p.evaluate(()=>{
    localStorage.setItem('racked_state_v1',JSON.stringify({version:1,workouts:[],sessions:[],measurements:[],activeSession:null}));
    window.dispatchEvent(new StorageEvent('storage',{key:'racked_state_v1',storageArea:localStorage}));
  });
  const event=p.waitForEvent('download');await p.locator('#storageExport').click();
  const file=await event, snapshot=JSON.parse(await readFile(await file.path(),'utf8'));
  assert.deepEqual(snapshot.rackedRecoveryDraft,{original:'metadata'});
  assert.equal(snapshot.rackedRecoveryDraft_.workoutName,'Uncommitted workout');
  assert.equal(snapshot.rackedRecoveryDraft_.exercises[0].name,'Squat');
  assert(snapshot.rackedRecoveryDraft_.fields.some(field=>field.id==='cw-exname' && field.value==='Uncommitted second exercise'));
  assert.deepEqual(await stored(p),blank());
});
