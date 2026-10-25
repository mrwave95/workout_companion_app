const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {test} = require('node:test');
const vm = require('node:vm');
const html = readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const storage = html.slice(html.indexOf('const STORAGE_KEY'),html.indexOf('/* =========================================================\n   UTILS'));
const data = html.slice(html.indexOf('function requireRecord('),html.indexOf('\nfunction copySummary('));
const empty = ()=>({version:2,exercises:[],workouts:[],sessions:[],measurements:[],activeSession:null});
const legacyId = name=>'legacy-name:'+JSON.stringify(name.trim().toLowerCase());
const card = (catalogId='exercise:bench',name='Bench Press',id='card')=>({id,catalogId,name,weight:40,reps:8,notes:'Keep this cue',custom:{keep:true}});
const workout = (exercise=card(),id='workout')=>({id,name:'Strength',exercises:[exercise],custom:{keep:true}});
function session(exercise=card(),id='session'){
  return {id,workoutId:'workout',workoutName:'Strength',date:'2026-10-24T12:00:00Z',custom:{keep:true},exercises:[{
    exerciseId:exercise.id,...(exercise.catalogId===undefined ? {} : {catalogId:exercise.catalogId}),name:exercise.name,
    notes:'Keep this note',weight:45,reps:9,startWeight:40,startReps:8,finished:false,
    sets:[{weight:45,reps:9,time:'2026-10-24T12:01:00Z',custom:{keep:true}}],custom:{keep:true}
  }]};
}
function runtime(initial=empty()){
  const raw=typeof initial==='string' ? initial : JSON.stringify(initial);
  const values=new Map([['racked_state_v1',raw]]);
  const alerts=[],confirmations=[],successes=[];
  let failing=false,writes=0;
  const context=vm.createContext({
    console:{error(){}},
    localStorage:{getItem:key=>values.get(key)??null,setItem(key,value){writes++;if(failing) throw new Error('QuotaExceededError');values.set(key,value);}},
    alert:message=>alerts.push(message),confirm:message=>{confirmations.push(message);return true;},
    uid:()=>`generated-${Math.random()}`,todayISODate:()=> '2026-10-24',toast:message=>successes.push(message),
    renderBackup(){},navigate(){},history:{replaceState(){}}
  });
  vm.runInContext(`${storage}\n${data}\nhasWriteLock=true; readJSONFile=async file=>file;`,context);
  return {context,values,alerts,confirmations,successes,raw,
    writes:()=>writes,run:code=>vm.runInContext(code,context),failWrites:()=>{failing=true;}};
}
const plain = value=>JSON.parse(JSON.stringify(value));
function withoutCatalog(record){const result=structuredClone(record);delete result.catalogId;return result;}
async function importCategory(r,category,value){
  r.context.event={target:{files:[value],value:'file'}};
  const command={workouts:'importWorkoutsFile',sessions:'importSessionsFile',measurements:'importMeasurementsFile'}[category];
  await r.run(`${command}(event)`);
  assert.equal(r.context.event.target.value,'');
}

test('v1 conversion adds one central identity per existing name group without changing history or drafts',()=>{
  const bench=withoutCatalog(card(undefined,' Bench Press '));
  const second=withoutCatalog(card(undefined,'bench press','other-card'));
  const incline=withoutCatalog(card(undefined,'Incline Bench Press','card'));
  const active=session(second,'active');
  active.kind='exercise';
  active.exercises[0].draftInputs={weight:'22,.',reps:'',custom:{keep:true}};
  active.editSetDraft={exerciseIndex:0,setIndex:0,weight:'45,',reps:'',custom:{keep:true}};
  const old={version:1,workouts:[workout(bench),workout(incline,'other-workout')],sessions:[session(second)],
    measurements:[{id:'m',date:'2026-10-24',part:'Waist',value:80,custom:{keep:true}}],activeSession:active,custom:{keep:['old',1]}};
  const original=structuredClone(old),r=runtime(old);
  const next=plain(r.run('state'));
  assert.equal(next.version,2);
  assert.equal(next.exercises.length,2);
  assert.deepEqual(new Set(next.exercises.map(ex=>ex.id)),new Set([legacyId('bench press'),legacyId('Incline Bench Press')]));
  assert.equal(next.workouts[0].exercises[0].catalogId,legacyId('bench press'));
  assert.equal(next.sessions[0].exercises[0].catalogId,legacyId('bench press'));
  assert.equal(next.activeSession.exercises[0].catalogId,legacyId('bench press'));
  assert.deepEqual(next.workouts.map(w=>({...w,exercises:w.exercises.map(withoutCatalog)})),old.workouts);
  assert.deepEqual(next.sessions.map(s=>({...s,exercises:s.exercises.map(withoutCatalog)})),old.sessions);
  assert.deepEqual({...next.activeSession,exercises:next.activeSession.exercises.map(withoutCatalog)},old.activeSession);
  assert.deepEqual(next.measurements,old.measurements);
  assert.deepEqual(next.custom,old.custom);
  assert.deepEqual(old,original);
  assert.equal(r.values.get('racked_state_v1'),r.raw,'reading/converting must not write storage');
  r.context.next=next;
  assert.deepEqual(plain(r.run('normalizeState(next)')),next,'conversion must be idempotent');
});

test('PR3 explicit and mixed legacy compatibility IDs are retained exactly',()=>{
  const explicit=card('exercise:bench');
  const implicit=withoutCatalog(card(undefined,'Squat','squat-card'));
  const linked=card(legacyId('Squat'),'Squat','linked-card');
  const old={version:1,workouts:[workout(explicit),workout(implicit,'squat')],sessions:[session(linked)],measurements:[],activeSession:null};
  const r=runtime(old),next=plain(r.run('state'));
  assert.equal(next.version,2);
  assert.equal(next.exercises.length,2);
  assert.equal(next.workouts[0].exercises[0].catalogId,explicit.catalogId);
  assert.equal(next.workouts[1].exercises[0].catalogId,linked.catalogId);
  assert.equal(next.sessions[0].exercises[0].catalogId,linked.catalogId);
});

test('ambiguous conversions preserve original bytes and cannot be saved over',()=>{
  const cases=[
    [card('first'),card('second',' bench press ','other')],
    [card('shared'),card('shared','Incline Bench Press','other')],
    [card('explicit'),withoutCatalog(card(undefined,'Bench Press','other'))]
  ];
  for(const exercises of cases){
    const initial={version:1,workouts:[{id:'w',name:'Strength',exercises}],sessions:[],measurements:[],activeSession:null};
    const r=runtime(initial);
    assert.equal(r.run('storageRecoveryRaw'),r.raw);
    assert.equal(r.run('saveState()'),false);
    assert.equal(r.values.get('racked_state_v1'),r.raw);
    assert.match(r.alerts.join(' '),/identity|identit|name|exercise|ambig|conflict/i);
  }
});

test('failed first v2 save retains v1 bytes and the complete resumable converted snapshot',()=>{
  const legacy=withoutCatalog(card());
  const initial={version:1,workouts:[workout(legacy)],sessions:[],measurements:[],activeSession:session(legacy,'active')};
  const r=runtime(initial),converted=plain(r.run('state'));
  assert.equal(converted.version,2);
  r.failWrites();
  assert.equal(r.run('state.activeSession.exercises[0].notes="Unsaved"; saveState()'),false);
  assert.equal(r.values.get('racked_state_v1'),r.raw);
  assert.deepEqual(plain(r.run('state')),converted);
});

test('v2 central definitions preserve library-only exercises and allow historical name snapshots',()=>{
  const exercise=card('exercise:bench','Bench Press');
  const initial={...empty(),exercises:[{id:exercise.catalogId,name:'Renamed Bench',custom:{keep:true}},{id:'library-only',name:'Cable Row'}],
    workouts:[workout(exercise)],sessions:[session(exercise)],activeSession:session(exercise,'active'),custom:{keep:true}};
  const r=runtime(initial);
  assert.deepEqual(plain(r.run('state')),initial);
  r.context.backup=initial;
  assert.deepEqual(plain(r.run('normalizeState(backup)')),initial);
});

test('v2 rejects missing definitions, duplicate IDs/names and invalid central records',()=>{
  const r=runtime();
  const cases=[
    {...empty(),exercises:undefined},
    {...empty(),exercises:[{id:'one',name:'Bench'},{id:'one',name:'Incline'}]},
    {...empty(),exercises:[{id:'one',name:'Bench'},{id:'two',name:' bench '}]},
    {...empty(),exercises:[{id:'one',name:'  '}]},
    {...empty(),exercises:[{id:7,name:'Bench'}]},
    {...empty(),exercises:[null]},
    {...empty(),workouts:[workout()]},
    {...empty(),sessions:[session()]},
    {...empty(),activeSession:session(card(),'active')},
    {...empty(),exercises:[{id:'exercise:bench',name:'Bench Press'}],workouts:[workout(withoutCatalog(card()))]}
  ];
  for(const backup of cases){
    r.context.backup=backup;
    assert.throws(()=>r.run('normalizeState(backup)'),undefined,JSON.stringify(backup));
  }
});

test('v2 category import adds referenced definitions while retaining unrelated data and library-only rows',async()=>{
  const existing=card();
  const initial={...empty(),exercises:[{id:existing.catalogId,name:existing.name},{id:'library-only',name:'Unlogged Curl'}],
    workouts:[workout(existing)],sessions:[session(existing)],activeSession:session(existing,'active'),
    measurements:[{id:'m',date:'2026-10-24',part:'Waist',value:80}]};
  const r=runtime(initial),added=card('exercise:row','Cable Row','row-card');
  await importCategory(r,'workouts',{version:2,exercises:[{id:added.catalogId,name:added.name}],workouts:[workout(added,'replacement')]});
  const next=plain(r.run('state'));
  assert.deepEqual(next.workouts,[workout(added,'replacement')]);
  assert.deepEqual(next.sessions,initial.sessions);
  assert.deepEqual(next.activeSession,initial.activeSession);
  assert.deepEqual(next.measurements,initial.measurements);
  assert.deepEqual(next.exercises.slice(0,2),initial.exercises);
  assert(next.exercises.some(ex=>ex.id===added.catalogId));
});

test('conflicting or incomplete category imports are rejected before confirmation and replacement',async()=>{
  const existing=card();
  const initial={...empty(),exercises:[{id:existing.catalogId,name:existing.name}],workouts:[workout(existing)],sessions:[session(existing)],activeSession:session(existing,'active')};
  const incomingCases=[
    {version:2,exercises:[{id:'another-id',name:' bench press '}],sessions:[session(card('another-id'))]},
    {version:2,exercises:[{id:existing.catalogId,name:'Incline Bench Press'}],sessions:[session(existing)]},
    {version:2,exercises:[],sessions:[session(existing)]},
    {version:2,sessions:[session(existing)]},
    {version:1,sessions:[session(card('another-id'))]},
    {version:1,sessions:[session(withoutCatalog(existing))]}
  ];
  for(const incoming of incomingCases){
    const r=runtime(initial);
    await importCategory(r,'sessions',incoming);
    assert.equal(r.confirmations.length,0,JSON.stringify(incoming));
    assert.equal(r.values.get('racked_state_v1'),r.raw);
    assert.deepEqual(plain(r.run('state')),initial);
    assert.match(r.alerts.join(' '),/identity|identit|name|exercise|conflict|definition|librar/i);
  }
});

test('historical snapshot names cannot rename an existing central definition during category import',async()=>{
  const existing=card();
  const initial={...empty(),exercises:[{id:existing.catalogId,name:'Renamed Bench'}],workouts:[workout(existing)],activeSession:session(existing,'active')};
  const r=runtime(initial),historical=session(existing);
  await importCategory(r,'sessions',{version:2,exercises:initial.exercises,sessions:[historical]});
  assert.deepEqual(plain(r.run('state.exercises')),initial.exercises);
  assert.deepEqual(plain(r.run('state.sessions')),[historical]);
  assert.deepEqual(plain(r.run('state.activeSession')),initial.activeSession);
  await importCategory(r,'sessions',{version:1,sessions:[historical]});
  assert.deepEqual(plain(r.run('state.exercises')),initial.exercises);
  assert.deepEqual(plain(r.run('state.sessions')),[historical]);
});

test('older name-only categories reconnect to the same legacy ID after its central name changes',async()=>{
  const legacy=withoutCatalog(card()),id=legacyId(legacy.name);
  const initial={...empty(),exercises:[{id,name:'Renamed Bench',legacy:true}]};
  const r=runtime(initial);
  await importCategory(r,'sessions',{version:1,sessions:[session(legacy)]});
  const next=plain(r.run('state'));
  assert.equal(next.exercises.length,1);
  assert.equal(next.exercises[0].name,'Renamed Bench');
  assert.equal(next.sessions[0].exercises[0].catalogId,id);
  assert.equal(next.sessions[0].exercises[0].name,'Bench Press');
});

test('separate old category imports create one legacy definition regardless of import order',async()=>{
  const legacy=withoutCatalog(card());
  for(const categories of [['workouts','sessions'],['sessions','workouts']]){
    const r=runtime();
    for(const category of categories){
      await importCategory(r,category,{version:1,[category]:category==='workouts'?[workout(legacy)]:[session(legacy)]});
    }
    const next=plain(r.run('state'));
    assert.equal(next.exercises.length,1);
    assert.equal(next.workouts[0].exercises[0].catalogId,legacyId(legacy.name));
    assert.equal(next.sessions[0].exercises[0].catalogId,legacyId(legacy.name));
  }
});

test('a failed category save rolls back both definitions and collection replacement',async()=>{
  const existing=card();
  const initial={...empty(),exercises:[{id:existing.catalogId,name:existing.name}],workouts:[workout(existing)],sessions:[session(existing)],activeSession:session(existing,'active')};
  const r=runtime(initial),added=card('exercise:row','Cable Row');
  r.failWrites();
  await importCategory(r,'workouts',{version:2,exercises:[{id:added.catalogId,name:added.name}],workouts:[workout(added,'replacement')]});
  assert.equal(r.confirmations.length,1);
  assert.equal(r.values.get('racked_state_v1'),r.raw);
  assert.deepEqual(plain(r.run('state')),initial);
  assert.equal(r.successes.length,0);
});

test('full restoration replaces the central library and preserves library-only definitions',async()=>{
  const r=runtime({...empty(),exercises:[{id:'old-only',name:'Old Exercise'}]});
  const restored={...empty(),exercises:[{id:'library-only',name:'New Exercise',custom:{keep:true}}]};
  r.context.event={target:{files:[restored],value:'file'}};
  await r.run('importFullBackup(event)');
  assert.deepEqual(plain(r.run('state')),restored);
  assert.deepEqual(JSON.parse(r.values.get('racked_state_v1')),restored);
});

test('v2 measurement category imports preserve the library without requiring exercise definitions',async()=>{
  const initial={...empty(),exercises:[{id:'library-only',name:'Unlogged Curl'}]};
  const r=runtime(initial),measurement={id:'m',date:'2026-10-24',part:'Waist',value:80};
  await importCategory(r,'measurements',{version:2,measurements:[measurement]});
  assert.deepEqual(plain(r.run('state.exercises')),initial.exercises);
  assert.deepEqual(plain(r.run('state.measurements')),[measurement]);
});

test('unnamed ID-less legacy records cannot fabricate a shared Exercise identity',async()=>{
  for(const name of [undefined,null,'','   ']){
    const unnamed=withoutCatalog(card());
    if(name===undefined) delete unnamed.name; else unnamed.name=name;
    const initial={version:1,workouts:[workout(unnamed)],sessions:[],measurements:[],activeSession:null};
    const r=runtime(initial);
    assert.equal(r.run('storageRecoveryRaw'),r.raw);
    assert.equal(r.run('saveState()'),false);
    assert.equal(r.values.get('racked_state_v1'),r.raw);
    assert.match(r.alerts.join(' '),/unnamed|name|identit/i);

    const importing=runtime();
    await importCategory(importing,'workouts',{version:1,workouts:[workout(unnamed)]});
    assert.equal(importing.confirmations.length,0);
    assert.equal(importing.values.get('racked_state_v1'),importing.raw);
    assert.equal(importing.run('state.exercises.length'),0);
  }
});

test('a malformed supplied legacy library is rejected rather than overwritten by conversion',()=>{
  const r=runtime();
  for(const exercises of [null,false,0,'',{},'not a library']){
    r.context.backup={version:1,exercises,workouts:[],sessions:[],measurements:[],activeSession:null};
    assert.throws(()=>r.run('normalizeState(backup)'),undefined,JSON.stringify(exercises));
  }
});

test('clearing workout and progression categories never garbage-collects library entries or the active session',async()=>{
  const existing=card();
  const initial={...empty(),exercises:[{id:existing.catalogId,name:'Current Bench'},{id:'library-only',name:'Unlogged Curl'}],
    workouts:[workout(existing)],sessions:[session(existing)],activeSession:session(existing,'active')};
  const r=runtime(initial);
  await importCategory(r,'workouts',{version:2,exercises:[],workouts:[]});
  await importCategory(r,'sessions',{version:2,exercises:[],sessions:[]});
  const next=plain(r.run('state'));
  assert.deepEqual(next.exercises,initial.exercises);
  assert.deepEqual(next.activeSession,initial.activeSession);
  assert.deepEqual(next.workouts,[]);
  assert.deepEqual(next.sessions,[]);
});
