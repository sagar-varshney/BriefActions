import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createEnginePool} from '../server/engine-pool.mjs';
import {createApp,HttpError,pythonBinary} from '../server/index.mjs';
import {loadConfig} from '../server/config.mjs';

const error=(status,message,code)=>new HttpError(status,message,code);
const fixture=`import json,os,sys,time
counter=0
for line in sys.stdin:
 e=json.loads(line);r=e['request'];counter+=1;op=r.get('operation')
 if op=='crash':
  with open(r['marker'],'a') as out:out.write('accepted\\n')
  sys.exit(1)
 if op=='sleep':time.sleep(60)
 if op=='invalid':print('private fixture detail',flush=True);continue
 if op=='oversize':print('x'*8000001,flush=True);continue
 result={'ok':False,'status':r['status'],'error':'private fixture detail'} if op=='fail' else {'ok':True,'data':{'pid':os.getpid(),'counter':counter,'owner':e.get('account_id')}}
 print(json.dumps({'id':e['id'],**result,'timings':r.get('timings')}),flush=True)
`;
async function withPool(action){
 const folder=await mkdtemp(path.join(tmpdir(),'flow-warm-worker-')),bridge=path.join(folder,'fixture.py');await writeFile(bridge,fixture);
 const pool=createEnginePool({python:pythonBinary,size:1,error,bridge});
 try{await action(pool,folder);}finally{await pool.stop();await rm(folder,{recursive:true,force:true});}
}
async function reaped(pool){
 const deadline=Date.now()+3000;
 while(pool.stats().processes&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(pool.stats().processes,0,'The failed process must be reaped');
}
test('Warm workers reuse imports without retaining account scope; handled errors do not corrupt the next response',()=>withPool(async pool=>{
 const a=await pool.execute({operation:'pid'},{accountId:'alice'});
 const b=await pool.execute({operation:'pid'},{accountId:'bob'});
 assert.equal(a.pid,b.pid);assert.equal(a.counter,1);assert.equal(b.counter,2);assert.equal(b.owner,'bob');
 await assert.rejects(pool.execute({operation:'fail',status:500}),e=>e.status===500&&!e.message.includes('private fixture'));
 await assert.rejects(pool.execute({operation:'fail',status:409}),e=>e.status===409);
 const next=await pool.execute({operation:'pid'});assert.equal(next.pid,a.pid);assert.equal(next.owner,null);assert.equal(pool.stats().spawned,1);
}));
test('A crashed accepted write is never replayed; the next explicit request gets a fresh worker',()=>withPool(async(pool,folder)=>{
 const marker=path.join(folder,'accepted.txt');
 await assert.rejects(pool.execute({operation:'crash',marker}),e=>e.status===502);
 await reaped(pool);assert.equal(await readFile(marker,'utf8'),'accepted\n');assert.equal(pool.stats().spawned,1);
 await pool.execute({operation:'pid'});assert.equal(pool.stats().spawned,2);assert.equal(await readFile(marker,'utf8'),'accepted\n');
}));
test('Timeouts, invalid protocol, and oversized output discard workers without leaking process output',()=>withPool(async pool=>{
 for(const [operation,status] of [['sleep',504],['invalid',502],['oversize',502]]){
  await assert.rejects(pool.execute({operation},{timeout:operation==='sleep'?100:5000}),e=>e.status===status&&!e.message.includes('private fixture'));
  await reaped(pool);assert.equal((await pool.execute({operation:'pid'})).counter,1);
 }
}));
test('Stopping a worker pool rejects in-flight work and prevents new processes',()=>withPool(async pool=>{
 await pool.execute({operation:'pid'});
 const pending=pool.execute({operation:'sleep'});const rejection=assert.rejects(pending,e=>e.status===503);
 await pool.stop();await rejection;assert.equal(pool.stats().processes,0);
 await assert.rejects(pool.execute({operation:'pid'}),e=>e.status===503);
}));
test('Worker diagnostics allow only numeric timing names and cannot change a completed result',()=>withPool(async pool=>{
 const samples=[];
 await pool.execute({operation:'pid',timings:{storage_scope:4,analysis_compute:8,'private query':12}},{onMetrics:value=>samples.push(value)});
 assert.deepEqual(samples,[{storage_scope:4,analysis_compute:8}]);
 await pool.execute({operation:'pid',timings:{storage_scope:-1,analysis_compute:'private'}},{onMetrics:value=>samples.push(value)});
 assert.deepEqual(samples.at(-1),{});
 const result=await pool.execute({operation:'pid',timings:{storage_scope:2}},{onMetrics:()=>{throw new Error('diagnostic failure');}});assert.ok(result.pid);
}));
test('Reused application lanes isolate alternating accounts through analysis, errors, drafts and confirmation',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'flow-warm-accounts-')),alice=randomUUID(),bob=randomUUID();
 const config={...loadConfig(),authMode:'supabase',supabaseUrl:'https://fixture.supabase.co',supabaseKey:'sb_publishable_fixture',publicOrigin:'https://flow.example',databaseUrl:process.env.FLOW_TEST_DATABASE_URL};
 const server=createApp({config,maxWorkers:1,historyPath:path.join(folder,'history.sqlite3'),verifyAccount:async token=>({alice,bob})[token]});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const get=(route,token)=>fetch(base+route,{headers:{Authorization:`Bearer ${token}`}});
 const post=(route,data,token)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://flow.example',Authorization:`Bearer ${token}`},body:JSON.stringify(data)});
 try{
  const input={transcript:'Maya will send the report tomorrow.',reference_date:'2026-10-21',request_id:randomUUID().replaceAll('-','')};
  const response=await post('/api/runs',input,'alice');assert.equal(response.status,201);const run=await response.json();assert.equal(run.proposals.length,1);
  assert.deepEqual(await(await get('/api/runs','bob')).json(),[]);
  assert.equal((await get(`/api/runs/${run.id}`,'bob')).status,404);
  const decisions=run.proposals.map(p=>({...p,owner:'Review correction',accept:true}));
  assert.equal((await post(`/api/runs/${run.id}/draft`,{decisions,version:0},'alice')).status,200);
  assert.equal((await post(`/api/runs/${run.id}/finalize`,{decisions},'bob')).status,404);
  assert.equal((await post(`/api/runs/${run.id}/finalize`,{decisions},'alice')).status,200);
  assert.equal((await post('/api/runs',input,'alice')).status,201,'An explicit retry retains the original analysis');
  const own=await(await get(`/api/runs/${run.id}`,'alice')).json();assert.equal(own.status,'confirmed');assert.equal(own.final_tasks[0].owner,'Review correction');
  assert.deepEqual(await(await get('/api/runs','bob')).json(),[]);
  assert.equal((await(await get('/api/runs','alice')).json()).length,1);
 }finally{server.closeAllConnections();await server.shutdown();await rm(folder,{recursive:true,force:true});}
});
