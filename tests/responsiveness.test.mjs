import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server/index.mjs';
import {createWorkQueue,operationLane} from '../server/work-queue.mjs';
import {createTelemetry} from '../server/telemetry.mjs';
import {configureApi,api} from '../web/src/api.js';
const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve:value=>resolve(value)};};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('Analysis saturation leaves meeting reads and saves available, with independent bounded queues',async()=>{
 const analysis=deferred(),entered=deferred(),interactive=deferred(),reading=deferred();let held=false;
 const telemetry=createTelemetry();
 const server=createApp({maxWorkers:1,queueTimeout:40,telemetry,execute:async request=>{
  if(request.operation==='analyze'){entered.resolve();await analysis.promise;return {id:'analysis'};}
  if(held){reading.resolve();await interactive.promise;}
  return {operation:request.operation};
 }});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const post=url=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 try{
  const pending=post('/api/runs');await entered.promise;
  const read=await fetch(base+'/api/runs');assert.equal(read.status,200);assert.equal((await read.json()).operation,'runs');
  assert.equal((await post(`/api/runs/${'a'.repeat(32)}/draft`)).status,200);
  const busy=await post('/api/runs');assert.equal(busy.status,503);assert.equal(busy.headers.get('retry-after'),'2');
  held=true;const blocked=fetch(base+'/api/runs');await reading.promise;
  assert.equal((await fetch(base+'/api/runs')).status,503);
  interactive.resolve();assert.equal((await blocked).status,200);held=false;
  assert.equal((await fetch(base+'/api/runs')).status,200);
  analysis.resolve();assert.equal((await pending).status,201);
  const metrics=telemetry.snapshot().phase_duration_histograms;
  assert.equal(metrics.runs['queue.analysis'].reduce((a,b)=>a+b),2);
  assert.equal(metrics.runs['worker.analysis'].reduce((a,b)=>a+b),1);
  assert.equal(metrics['runs.item.draft']['worker.interactive'].reduce((a,b)=>a+b),1);
 }finally{analysis.resolve();interactive.resolve();server.closeAllConnections();await server.shutdown();}
});
test('Classification defaults research, exports and unknown work to analysis',()=>{
 for(const op of ['analyze','plan_update','reviewed_run','annotation_import','annotation_freeze','new_heavy_operation',undefined])assert.equal(operationLane(op),'analysis');
 for(const op of ['run','draft','finalize','task_deadline','task_progress','calendar_search','weekly_review'])assert.equal(operationLane(op),'interactive');
});
test('Queues bound waiting work, preserve FIFO and release failed slots',async()=>{
 const queue=createWorkQueue({limit:1,timeout:1000,error:()=>new Error('busy')}),gate=deferred(),entered=deferred(),order=[];
 const first=queue.run(async()=>{entered.resolve();await gate.promise;throw new Error('failed write');});
 const rejected=assert.rejects(first,/failed write/);await entered.promise;
 const pending=Array.from({length:10},(_,i)=>queue.run(async()=>{order.push(i);}));
 await assert.rejects(queue.run(async()=>assert.fail('overflow ran')),/busy/);
 assert.deepEqual(queue.stats(),{active:1,queued:10,limit:1});gate.resolve();await rejected;await Promise.all(pending);
 assert.deepEqual(order,Array.from({length:10},(_,i)=>i));assert.equal(queue.stats().active,0);
});
test('Phase metrics accept only fixed names and normalized routes, never private labels',()=>{
 const telemetry=createTelemetry();
 telemetry.phase('/api/runs/'+('a'.repeat(32))+'?transcript=private','storage_scope',12);
 telemetry.phase('/api/runs','private-secret',100);telemetry.phase('/api/runs','auth',NaN);
 const snapshot=telemetry.snapshot();assert.deepEqual(Object.keys(snapshot.phase_duration_histograms),['runs.item']);
 assert.equal(snapshot.phase_duration_histograms['runs.item'].storage_scope.reduce((a,b)=>a+b),1);assert.ok(!JSON.stringify(snapshot).includes('private'));
 snapshot.phase_duration_histograms['runs.item'].storage_scope[0]=99;assert.equal(telemetry.snapshot().phase_duration_histograms['runs.item'].storage_scope[0],1);
});
test('Only simultaneous identical JSON reads share a request; objects and retries remain independent',async()=>{
 const original=globalThis.fetch;let calls=0;const gate=deferred();configureApi(null,null);
 globalThis.fetch=async()=>{calls++;await gate.promise;return Response.json({items:[{task:'test'}]});};
 try{
  const a=api('/runs'),b=api('/runs');await pause(0);assert.equal(calls,1);gate.resolve();
  const [one,two]=await Promise.all([a,b]);one.items[0].task='edited';assert.equal(two.items[0].task,'test');
  await api('/runs');assert.equal(calls,2);
  globalThis.fetch=async()=>{calls++;return Response.json({error:'temporary'},{status:503});};
  await Promise.all([assert.rejects(api('/runs')),assert.rejects(api('/runs'))]);assert.equal(calls,3);
  await assert.rejects(api('/runs'));assert.equal(calls,4);
 }finally{gate.resolve();globalThis.fetch=original;configureApi(null,null);}
});
test('Writes never coalesce and invalidate reads before and after mutation',async()=>{
 const original=globalThis.fetch,writeGate=deferred(),readGates=[],writes=[];configureApi(null,null);
 globalThis.fetch=async(_url,options)=>{
  if(options.method==='POST'){writes.push(options.body);await writeGate.promise;return Response.json({saved:true});}
  const gate=deferred();readGates.push(gate);await gate.promise;return Response.json({version:readGates.indexOf(gate)});
 };
 try{
  const before=api('/runs'),write1=api('/runs',{method:'POST',body:'{}'}),write2=api('/runs',{method:'POST',body:'{}'}),during=api('/runs');
  await pause(0);assert.equal(readGates.length,2);assert.equal(writes.length,2);writeGate.resolve();await Promise.all([write1,write2]);
  const after=api('/runs');await pause(0);assert.equal(readGates.length,3);readGates.forEach(g=>g.resolve());await Promise.all([before,during,after]);
 }finally{readGates.forEach(g=>g.resolve());writeGate.resolve();globalThis.fetch=original;configureApi(null,null);}
});
test('Account changes reject old responses and session lookups before credentials can be sent',async()=>{
 const original=globalThis.fetch,session=deferred(),response=deferred();let calls=0;
 configureApi({auth:{getSession:()=>session.promise}},'alice');globalThis.fetch=async()=>{calls++;return response.promise;};
 try{
  const pending=api('/runs'),rejected=assert.rejects(pending,/sign-in changed/);
  configureApi(null,'bob');session.resolve({data:{session:{user:{id:'alice'},access_token:'private-fixture'}}});await rejected;assert.equal(calls,0);
  const old=api('/runs'),oldRejected=assert.rejects(old,/sign-in changed/);await pause(0);
  configureApi(null,'carol');response.resolve(Response.json({private:'old account'}));await oldRejected;
  globalThis.fetch=async()=>Response.json({owner:'carol'});assert.equal((await api('/runs')).owner,'carol');
 }finally{globalThis.fetch=original;configureApi(null,null);}
});
test('Different filters and explicitly configured reads keep separate requests',async()=>{
 const original=globalThis.fetch;let count=0;configureApi(null,null);globalThis.fetch=async()=>{count++;return Response.json({});};
 try{await Promise.all([api('/tasks?owner=A'),api('/tasks?owner=B'),api('/tasks',{signal:AbortSignal.timeout(1000)}),api('/tasks',{headers:{Accept:'application/json'}})]);assert.equal(count,4);}
 finally{globalThis.fetch=original;configureApi(null,null);}
});
