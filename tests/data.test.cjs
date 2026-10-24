const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {test} = require('node:test');
const vm = require('node:vm');
const html = readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const storage = html.slice(html.indexOf('const STORAGE_KEY'),html.indexOf('/* =========================================================\n   UTILS'));
const data = html.slice(html.indexOf('function requireRecord('),html.indexOf('\nfunction copySummary('));
const empty = () => ({version:1,workouts:[],sessions:[],measurements:[],activeSession:null});
function runtime(initial=empty()){
  const values = new Map(initial===undefined ? [] : [['racked_state_v1',typeof initial==='string' ? initial : JSON.stringify(initial)]]);
  const alerts=[]; let failing=false; const confirmations=[]; const successes=[];
  const context=vm.createContext({console:{error(){}},localStorage:{getItem:key=>values.get(key)??null,setItem(key,value){if(failing)throw new Error('QuotaExceededError');values.set(key,value);}},alert:message=>alerts.push(message),confirm:message=>{confirmations.push(message);return true;},uid:()=>`generated-${Math.random()}`,todayISODate:()=> '2026-10-24',toast:message=>successes.push(message),renderBackup(){},navigate(){},history:{replaceState(){}}});
  vm.runInContext(`${storage}\n${data}\nhasWriteLock=true; readJSONFile=async file=>file;`,context);
  return {context,values,alerts,confirmations,successes,run:code=>vm.runInContext(code,context),failWrites:()=>{failing=true;}};
}
function plain(value){return JSON.parse(JSON.stringify(value));}

test('v1 full backup preserves active session fields, IDs and extra metadata',()=>{
  const r=runtime();
  const backup={...empty(),customMetadata:{keep:true},workouts:[{id:7,name:'Workout',exercises:[{id:8,name:'Squat',notes:'form cue',weight:40,reps:8}]}],activeSession:{id:9,workoutId:7,workoutName:'Workout',date:'2026-10-24T13:00:00Z',exercises:[{exerciseId:8,name:'Squat',notes:'tempo',weight:50,reps:10,startWeight:40,startReps:8,finished:false,sets:[{weight:45,reps:9,time:'2026-10-24T13:01:00Z'}]}]}};
  r.context.backup=backup;
  const next=plain(r.run('normalizeState(backup)'));
  assert.equal(next.workouts[0].id,'7');assert.equal(next.activeSession.workoutId,'7');
  assert.deepEqual(next.activeSession.exercises[0],{...backup.activeSession.exercises[0],exerciseId:'8'});
  assert.deepEqual(next.customMetadata,{keep:true});
});

test('older active-session backups recover missing controls from their last logged set',()=>{
  const r=runtime();
  const result=plain(r.run("normalizeSessions([{id:'s',workoutId:'w',date:'2026-10-24',exercises:[{name:'Squat',sets:[{weight:45,reps:9}]}]}])"));
  assert.equal(result[0].exercises[0].weight,45);assert.equal(result[0].exercises[0].reps,9);
  assert.equal(result[0].exercises[0].startWeight,45);
});

test('invalid records, numbers, dates, versions and incomplete backups are rejected',()=>{
  const r=runtime();
  for(const code of [
    'normalizeWorkouts([null])','normalizeWorkouts([{name:42}])','normalizeWorkouts([{id:{}}])',
    'normalizeSessions([{exercises:[{name:42}]}])',
    'normalizeSessions([{date:"not a date"}])','normalizeSessions([{date:"2026-02-30T12:00:00Z"}])',
    'normalizeSessions([{exercises:[{sets:[{weight:"Infinity"}]}]}])',
    'normalizeMeasurements([{date:"2026-02-30"}])','normalizeMeasurements([{value:[] }])',
    'normalizeState({workouts:[]})','normalizeState({version:2,workouts:[],sessions:[],measurements:[]})'
  ]) assert.throws(()=>r.run(code),undefined,code);
});

test('failed writes retain durable data and roll in-memory changes back',()=>{
  const original={...empty(),measurements:[{id:'m',date:'2026-10-24',part:'Waist',value:80}]};
  const r=runtime(original);r.failWrites();
  assert.equal(r.run('state.measurements[0].value=99;saveState()'),false);
  assert.equal(r.run('state.measurements[0].value'),80);
  assert.deepEqual(JSON.parse(r.values.get('racked_state_v1')),original);
  assert.match(r.alerts[0],/not kept/);
});

test('invalid saved bytes are preserved and blocked from accidental overwrites',()=>{
  for(const raw of ['{broken json',JSON.stringify({workouts:null})]){
    const r=runtime(raw);
    assert.equal(r.run('saveState()'),false);assert.equal(r.values.get('racked_state_v1'),raw);
    assert.equal(r.run('storageRecoveryRaw'),raw);
    assert.equal(r.run('state=defaultState();saveState({allowRecovery:true})'),true);
    assert.deepEqual(JSON.parse(r.values.get('racked_state_v1')),empty());
  }
});

test('category imports validate before confirmation and never replace other collections',async()=>{
  const original={...empty(),measurements:[{id:'m',date:'2026-10-24',part:'Waist',value:80}]};
  const r=runtime(original);const durable=r.values.get('racked_state_v1');
  r.context.event={target:{files:[{sessions:[{exercises:[{name:{bad:true}}]}]}],value:'file'}};
  await r.run('importSessionsFile(event)');
  assert.equal(r.values.get('racked_state_v1'),durable);assert.equal(r.confirmations.length,0);assert.equal(r.context.event.target.value,'');
  r.context.event={target:{files:[{workouts:[{id:'w',name:'Workout',exercises:[]}]}],value:'file'}};
  await r.run('importWorkoutsFile(event)');
  assert.deepEqual(plain(r.run('state.measurements')),original.measurements);assert.equal(r.run('state.workouts[0].id'),'w');
});

test('full import validates before confirmation, and failed persistence cannot report success',async()=>{
  const r=runtime();const durable=r.values.get('racked_state_v1');
  r.context.event={target:{files:[{workouts:[],sessions:[],measurements:[{date:'invalid'}]}],value:'file'}};
  await r.run('importFullBackup(event)');assert.equal(r.confirmations.length,0);assert.equal(r.values.get('racked_state_v1'),durable);
  r.failWrites();r.context.event={target:{files:[{...empty(),workouts:[{id:'w',name:'Workout'}]}],value:'file'}};
  await r.run('importFullBackup(event)');assert.equal(r.values.get('racked_state_v1'),durable);assert.equal(r.successes.length,0);assert.equal(r.run('state.workouts.length'),0);
});
