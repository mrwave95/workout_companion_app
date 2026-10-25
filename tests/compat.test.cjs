const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {browserSuite} = require('./browser-helper.cjs');

// Linux WebKit supplements compatibility checks; it is not iOS Safari.
const engine = process.env.RACKED_TEST_BROWSER || 'chromium';
let originUnavailable = false;
const app = browserSuite({engine,respond:(_name,_req,res)=>{
  if(!originUnavailable) return false;
  res.destroy();
  return true;
}});
async function open(t,{init,serviceWorkers='block'}={}){
  const context=await app.context(t,{viewport:{width:390,height:844},serviceWorkers});
  if(init)await context.addInitScript(init);
  const page=await context.newPage();
  const alerts=[];page.on('dialog',dialog=>{alerts.push(dialog.message());return dialog.dismiss();});
  await page.goto(app.origin);
  return {page,context,alerts};
}

for(const outcome of ['false','throw','true']){
  test(`${engine}: clipboard fallback reports ${outcome==='true'?'success':'manual copying'} when execCommand returns ${outcome}`,{timeout:30000},async t=>{
    const {page,alerts}=await open(t);
    await page.locator('#t-backup').click();
    await page.evaluate(outcome=>{
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('Clipboard permission denied');}}});
      window.copyAttempted=false;
      document.execCommand=()=>{window.copyAttempted=true;if(outcome==='throw')throw new Error('Copy denied');return outcome==='true';};
    },outcome);
    await page.locator('#bk-copy').click();
    if(outcome==='true'){
      await page.waitForFunction(()=>document.getElementById('toast').textContent==='Summary copied');
      assert.deepEqual(alerts,[]);
    }else{
      await page.waitForFunction(()=>window.copyAttempted);
      assert.equal(alerts.length,1);
      assert.match(alerts[0],/^Racked progress summary/);
      assert.doesNotMatch(await page.locator('#toast').textContent(),/copied/i);
    }
  });
}

test(`${engine}: restricted localStorage cannot cause destructive recovery or false export success`,{timeout:30000},async t=>{
  const {page,alerts}=await open(t,{init:()=>{
    Storage.prototype.getItem=function(){throw new DOMException('Storage denied','SecurityError');};
    Storage.prototype.setItem=function(){throw new DOMException('Storage denied','SecurityError');};
  }});
  await page.locator('#t-backup').click();
  await page.locator('#bk-export-full').click();
  assert(alerts.some(text=>text.includes('storage is restricted')));
  assert.doesNotMatch(await page.locator('#toast').textContent(),/downloaded/i);
});

test(`${engine}: standalone static workflow preserves notes, downloads data, and relaunches without its server`,{timeout:30000},async t=>{
  const {page,context}=await open(t,{serviceWorkers:'allow'});
  await page.locator('#t-create').click();
  await page.locator('#cw-name').fill('Compatibility workout');
  await page.locator('#cw-exname').fill('Squat');
  await page.locator('#cw-addex').click();
  await page.locator('#cw-save').click();
  await page.locator('.workout-start').click();
  await page.locator('[data-role="notes"]').fill('Controlled tempo');
  await page.locator('[data-act="logset"]').click();
  await page.reload();
  await page.locator('#t-workouts').click();
  await page.locator('.workout-start').click();
  assert.equal(await page.locator('[data-role="notes"]').inputValue(),'Controlled tempo');
  assert.equal(await page.locator('.set-chip').count(),1);
  await page.reload();
  await page.locator('#t-backup').click();
  const event=page.waitForEvent('download');
  await page.locator('#bk-export-full').click();
  const download=await event;
  const backup=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
  assert.equal(backup.activeSession.exercises[0].notes,'Controlled tempo');
  assert.equal(backup.activeSession.exercises[0].sets.length,1);
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  // Playwright WebKit's offline emulation can reject before worker dispatch:
  // https://github.com/microsoft/playwright/issues/42775
  // Disconnect the origin instead; the installed worker must serve the cache.
  originUnavailable = true;
  try{
    const response=await page.goto(app.origin+'/?standalone=1');
    assert.equal(response.status(),200);
    assert.equal(response.fromServiceWorker(),true);
    await page.locator('#t-workouts').click();
    await page.locator('.workout-start').click();
    assert.equal(await page.locator('[data-role="notes"]').inputValue(),'Controlled tempo');
    assert.equal(await page.locator('.set-chip').count(),1);
  }finally{ originUnavailable = false; }
});
