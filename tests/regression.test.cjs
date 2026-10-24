const {test} = require('node:test');
const assert = require('node:assert/strict');
const {browserSuite,seedState} = require('./browser-helper.cjs');
const app = browserSuite();

async function open(t,workout){
  const context = await app.context(t);
  await seedState(context,{version:1,workouts:[workout],sessions:[],measurements:[],activeSession:null});
  const page = await context.newPage();
  page.on('dialog',dialog=>dialog.type()==='confirm' ? dialog.accept() : dialog.dismiss());
  await page.goto(app.origin);
  return page;
}
async function saved(page){return page.evaluate(()=>JSON.parse(localStorage.getItem('racked_state_v1')));}
async function start(page){await page.locator('#t-workouts').click(); await page.locator('.workout-start').click();}

const exercise = {id:'e',name:'Squat',notes:'Keep the cue',weight:40,reps:8};
test('editing and reordering a workout preserves unknown exercise metadata and notes',async t=>{
  const first={...exercise,custom:{source:'legacy',detail:['keep',1]}};
  const second={...exercise,id:'e2',name:'Curl',notes:'Other cue',custom:{keep:true}};
  const page=await open(t,{id:'w',name:'Workout',exercises:[first,second]});
  await page.locator('#t-workouts').click();
  await page.locator('[data-edit]').click();
  await page.locator('[data-move="up:1"]').click();
  await page.locator('#cw-name').fill('Renamed');
  await page.locator('#cw-save').click();
  const result=(await saved(page)).workouts[0];
  assert.equal(result.name,'Renamed');
  assert.deepEqual(result.exercises,[second,first]);
});

test('large finite legacy weights survive steppers, logging, finishing and reload',async t=>{
  const page=await open(t,{id:'w',name:'Large legacy value',exercises:[{...exercise,weight:1e308}]});
  await start(page);
  await page.locator('[data-act="wup"]').click();
  assert.equal((await saved(page)).activeSession.exercises[0].weight,1e308);
  await page.locator('[data-act="wdown"]').click();
  assert.equal((await saved(page)).activeSession.exercises[0].weight,1e308);
  await page.locator('[data-act="logset"]').click();
  assert.equal((await saved(page)).activeSession.exercises[0].sets[0].weight,1e308);
  await page.locator('[data-act="finishex"]').click();
  await page.locator('#sessFinishBottom').click();
  await page.reload();
  const data=await saved(page);
  assert.equal(data.sessions[0].exercises[0].sets[0].weight,1e308);
  assert.equal(data.workouts[0].exercises[0].weight,1e308);
});

test('weight steppers keep existing decimal rounding and clamp decreases at zero',async t=>{
  const page=await open(t,{id:'w',name:'Decimal values',exercises:[{...exercise,weight:1.45}]});
  await start(page);
  await page.locator('[data-act="wup"]').click();
  assert.equal((await saved(page)).activeSession.exercises[0].weight,2);
  for(let i=0;i<5;i++) await page.locator('[data-act="wdown"]').click();
  assert.equal((await saved(page)).activeSession.exercises[0].weight,0);
});
