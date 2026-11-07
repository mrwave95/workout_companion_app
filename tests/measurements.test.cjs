const {test} = require('node:test');
const assert = require('node:assert/strict');
const {browserSuite,seedState} = require('./browser-helper.cjs');
const app = browserSuite({engine:process.env.RACKED_TEST_BROWSER || 'chromium'});
const original = [
  {id:'older',part:'Waist',value:80,date:'2026-10-23'},
  {id:'latest',part:'Waist',value:81,date:'2026-10-24'}
];
async function open(t){
  const context = await app.context(t);
  await seedState(context,{version:2,exercises:[],workouts:[],sessions:[],measurements:original,activeSession:null});
  const page = await context.newPage();
  await page.goto(app.origin);
  return page;
}
const saved = page=>page.evaluate(()=>JSON.parse(localStorage.getItem('racked_state_v1')));
const raw = page=>page.evaluate(()=>localStorage.getItem('racked_state_v1'));
async function decimalField(field){
  assert.equal(await field.getAttribute('type'),'text');
  assert.equal(await field.getAttribute('inputmode'),'decimal');
}
for(const decimal of ['82,5','82.5','82','0,5','0.5']){
  test(`standard and custom measurements accept ${decimal} as numbers, ignoring empty fields`,async t=>{
    const page = await open(t);
    await page.locator('#t-measure').click();
    const standard = page.getByLabel('Waist (cm)',{exact:true});
    await decimalField(standard);
    await standard.fill(decimal);
    await page.locator('#ms-customname').fill('Neck');
    await page.locator('#ms-addcustom').click();
    assert.equal(await standard.inputValue(),decimal);
    const custom = page.getByLabel('Neck (cm)',{exact:true});
    await decimalField(custom);
    await custom.fill(decimal);
    // Drafts belong to this form only, never to persistent records.
    assert.deepEqual((await saved(page)).measurements,original);
    await page.locator('#ms-save').click();
    const measurements = (await saved(page)).measurements;
    assert.deepEqual(measurements.slice(0,2),original);
    assert.equal(measurements.length,4);
    assert.deepEqual(measurements.slice(2).map(m=>[m.part,m.value]),[['Waist',Number(decimal.replace(',','.'))],['Neck',Number(decimal.replace(',','.'))]]);
  });
}

test('custom field rerenders preserve invalid and partially typed drafts without saving',async t=>{
  const page = await open(t);
  await page.locator('#t-measure').click();
  const before = await raw(page);
  const waist = page.getByLabel('Waist (cm)',{exact:true});
  await waist.fill('80,');
  await page.locator('#ms-customname').fill('Neck');
  await page.locator('#ms-addcustom').click();
  const neck = page.getByLabel('Neck (cm)',{exact:true});
  const invalid = '80,5.2" autofocus data-test="draft';
  await neck.fill(invalid);
  await page.locator('#ms-customname').fill('Wrist');
  await page.locator('#ms-addcustom').click();
  assert.equal(await waist.inputValue(),'80,');
  assert.equal(await neck.inputValue(),invalid);
  await page.getByRole('button',{name:'Remove Wrist',exact:true}).click();
  assert.equal(await waist.inputValue(),'80,');
  assert.equal(await neck.inputValue(),invalid);
  await page.locator('#ms-save').click();
  assert.equal(await raw(page),before);
  assert.equal(await neck.inputValue(),invalid);
  assert.match(await page.locator('#toast').textContent(),/non-negative measurement/);
});

const invalidValues = ['', ' ', '-1','80,5.2','80,,5','abc','NaN','Infinity','1e309','1e','0x10'];
test('invalid standard and custom measurements remain visible and save no partial batch',async t=>{
  const page = await open(t);
  await page.locator('#t-measure').click();
  await page.locator('#ms-customname').fill('Neck');
  await page.locator('#ms-addcustom').click();
  const before = await raw(page);
  const waist = page.getByLabel('Waist (cm)',{exact:true});
  const neck = page.getByLabel('Neck (cm)',{exact:true});
  for(const [field,other] of [[waist,neck],[neck,waist]]){
    await other.fill('82,5');
    for(const invalid of invalidValues.filter(v=>v.trim()!=='')){
      await field.fill(invalid);
      await page.locator('#ms-save').click();
      assert.equal(await raw(page),before,invalid);
      assert.equal(await field.inputValue(),invalid);
      assert.match(await page.locator('#toast').textContent(),/non-negative measurement/);
    }
  }
});

for(const decimal of ['82,5','82.5']){
  test(`measurement editing accepts ${decimal}, preserves history and updates progression`,async t=>{
    const page = await open(t);
    await page.locator('#t-progress').click();
    await page.locator('#seg-size').click();
    await page.locator('[data-mid="latest"]').click();
    const value = page.locator('#modal-m-value');
    await decimalField(value);
    const before = await raw(page);
    for(const invalid of invalidValues){
      await value.fill(invalid);
      await page.locator('#modal-m-save').click();
      assert.equal(await raw(page),before,invalid);
      assert.equal(await value.inputValue(),invalid);
      assert.equal(await page.locator('#modal-m-save').isVisible(),true);
      assert.match(await page.locator('#toast').textContent(),/valid value/);
    }
    await value.fill(decimal);
    await page.locator('#modal-m-save').click();
    assert.deepEqual((await saved(page)).measurements,[original[0],{...original[1],value:82.5}]);
    assert.equal(await page.locator('[data-mid="latest"] .er-val').textContent(),'82.5 cm');
    assert.equal(await page.locator('[data-mid="older"] .er-val').textContent(),'80 cm');
    assert.equal(await page.locator('.stat .sv').first().textContent(),'82.5cm');
    assert.equal(await page.locator('canvas.chart').count(),1);
    await page.reload();
    assert.deepEqual((await saved(page)).measurements,[original[0],{...original[1],value:82.5}]);
  });
}
