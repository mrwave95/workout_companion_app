const {test,before,after} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const playwright = require('playwright');

// Run against another installed engine with RACKED_TEST_BROWSER=webkit.
// WebKit on Linux supplements compatibility checks; it is not iOS Safari.
const engine = process.env.RACKED_TEST_BROWSER || 'chromium';
let browser,server,origin;
before(async()=>{
  const root=path.resolve(__dirname,'..');
  const files=new Set(['index.html','sw.js','manifest.json','icon-192.png','icon-512.png']);
  server=http.createServer((req,res)=>{
    const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
    if(!files.has(name)){res.writeHead(404).end();return;}
    res.setHeader('Content-Type',name.endsWith('.html')?'text/html':name.endsWith('.js')?'application/javascript':name.endsWith('.json')?'application/json':'image/png');
    res.end(fs.readFileSync(path.join(root,name)));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin=`http://127.0.0.1:${server.address().port}`;
  const executablePath=engine==='chromium' ? process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined) : undefined;
  browser=await playwright[engine].launch({executablePath,args:engine==='chromium'?['--no-sandbox']:[]});
});
after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));});
async function open(t,{init,serviceWorkers='block'}={}){
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers});
  t.after(()=>context.close());
  if(init)await context.addInitScript(init);
  const page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const alerts=[];page.on('dialog',dialog=>{alerts.push(dialog.message());return dialog.dismiss();});
  t.after(()=>assert.deepEqual(errors,[]));
  await page.goto(origin);
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

test(`${engine}: standalone static workflow preserves notes, downloads data, and relaunches offline`,{timeout:30000},async t=>{
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
  await context.setOffline(true);
  await page.goto(origin+'/?standalone=1');
  await page.locator('#t-workouts').click();
  await page.locator('.workout-start').click();
  assert.equal(await page.locator('[data-role="notes"]').inputValue(),'Controlled tempo');
  assert.equal(await page.locator('.set-chip').count(),1);
});
