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

for(const decimal of ['22,5','22.5']){
  test(`weight fields accept ${decimal} and persist numeric values`,async t=>{
    const page=await open(t,{id:'w',name:'Decimals',exercises:[exercise]});
    await page.locator('#t-create').click();
    await page.locator('#cw-name').fill('Decimal deck');
    await page.locator('#cw-exname').fill('Curl');
    const initialWeight=page.locator('#cw-exweight');
    assert.equal(await initialWeight.getAttribute('type'),'text');
    assert.equal(await initialWeight.getAttribute('inputmode'),'decimal');
    await initialWeight.fill(decimal);
    await page.locator('#cw-addex').click();
    await page.locator('#cw-save').click();
    assert.equal((await saved(page)).workouts.at(-1).exercises[0].weight,22.5);
    await page.locator('.workout-start').last().click();
    const weight=page.locator('[data-role="weight"]');
    assert.equal(await weight.getAttribute('type'),'text');
    assert.equal(await weight.getAttribute('inputmode'),'decimal');
    await weight.fill(decimal);
    await weight.blur();
    assert.equal((await saved(page)).activeSession.exercises[0].weight,22.5);
    await page.locator('[data-act="logset"]').click();
    await page.locator('.set-chip').click();
    const editedWeight=page.locator('#modal-set-weight');
    assert.equal(await editedWeight.getAttribute('type'),'text');
    assert.equal(await editedWeight.getAttribute('inputmode'),'decimal');
    await editedWeight.fill(decimal);
    await page.locator('#modal-set-reps').fill('9');
    await page.locator('#modal-set-save').click();
    await page.reload();
    const set=(await saved(page)).activeSession.exercises[0].sets[0];
    assert.equal(set.weight,22.5);
    assert.equal(set.reps,9);
  });
}

test('invalid edited weights and fractional reps leave saved workout data intact',async t=>{
  const page=await open(t,{id:'w',name:'Validation',exercises:[exercise]});
  await start(page);
  await page.locator('[data-act="logset"]').click();
  await page.locator('.set-chip').click();
  const raw=()=>page.evaluate(()=>localStorage.getItem('racked_state_v1'));
  const before=await raw();
  for(const value of ['', ' ', '-1', '22,5.5', '22,,5', '22.5kg', 'NaN', 'Infinity', '1e309', '0x10']){
    await page.locator('#modal-set-weight').fill(value);
    await page.locator('#modal-set-save').click();
    assert.equal(await raw(),before,`Saved data unchanged for ${JSON.stringify(value)}`);
    assert.equal(await page.locator('#modal-set-save').isVisible(),true);
  }
  await page.locator('#modal-set-weight').fill('22,5');
  await page.locator('#modal-set-reps').fill('8.5');
  await page.locator('#modal-set-save').click();
  assert.equal(await raw(),before);
  await page.locator('#modal-set-cancel').click();
  await page.reload();
  assert.equal(await raw(),before);
});
