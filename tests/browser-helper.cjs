const {before,after} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const playwright = require('playwright');

const root = path.resolve(__dirname,'..');
const assets = {
  'index.html':'text/html', 'sw.js':'application/javascript',
  'manifest.json':'application/json', 'icon-192.png':'image/png', 'icon-512.png':'image/png'
};

// Each test file gets its own browser/server; each case gets isolated storage.
function browserSuite({engine='chromium',respond}={}){
  const suite = {};
  let server,browser;
  before(async()=>{
    server = http.createServer(async(req,res)=>{
      const name = new URL(req.url,'http://localhost').pathname.slice(1) || 'index.html';
      try {
        res.setHeader('Cache-Control','no-store');
        if(respond && await respond(name,req,res)) return;
        if(!Object.hasOwn(assets,name)){res.writeHead(404).end();return;}
        res.setHeader('Content-Type',assets[name]);
        res.end(fs.readFileSync(path.join(root,name)));
      } catch {res.writeHead(500).end();}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    suite.origin = `http://127.0.0.1:${server.address().port}`;
    const executablePath = engine==='chromium'
      ? process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined)
      : undefined;
    browser = await playwright[engine].launch({executablePath,args:engine==='chromium'?['--no-sandbox']:[]});
  });
  after(async()=>{
    await browser?.close();
    if(server) await new Promise(resolve=>server.close(resolve));
  });
  suite.context = async(t,options={})=>{
    const context = await browser.newContext({serviceWorkers:'block',...options});
    const errors = [];
    context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
    t.after(async()=>{
      await context.close();
      assert.deepEqual(errors,[], 'No uncaught application errors');
    });
    return context;
  };
  return suite;
}

async function seedState(context,state){
  await context.addInitScript(raw=>{
    if(location.origin==='null') return; // The initial about:blank document has no storage.
    if(!sessionStorage.getItem('seeded')){
      localStorage.setItem('racked_state_v1',raw);
      sessionStorage.setItem('seeded','1');
    }
  },typeof state==='string'?state:JSON.stringify(state));
}
module.exports = {browserSuite,seedState};
