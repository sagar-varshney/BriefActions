import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';
import {loadConfig} from '../server/config.mjs';
import {actionPlan} from '../web/src/actionPlan.js';
const id=()=>randomUUID().replaceAll('-','');

test('Deadline corrections are private, versioned, retry-safe, reflected in every view and explicit in exports',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'briefactions-deadlines-api-')),alice=randomUUID(),bob=randomUUID();
 const config={...loadConfig(),authMode:'supabase',supabaseUrl:'https://fixture.supabase.co',databaseUrl:process.env.FLOW_TEST_DATABASE_URL};
 const server=createApp({config,historyPath:path.join(folder,'history.sqlite3'),verifyAccount:async token=>({alice,bob})[token]});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const get=(url,user='alice')=>fetch(base+url,{headers:user?{Authorization:`Bearer ${user}`}:{}});
 const post=(url,body,user='alice')=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',...(user?{Authorization:`Bearer ${user}`}:{})},body:JSON.stringify(body)});
 const ok=async response=>{assert.ok(response.ok,await response.clone().text());return response.json();};
 try{
  const run=await ok(await post('/api/runs',{transcript:'Maya will send the report tomorrow.',reference_date:'2026-10-20'})),task=run.proposals[0].proposal_id,url=`/api/runs/${run.id}/deadline`;
  const correction={proposal_id:task,deadline:'2026-10-23',reason:'Customer agreed Friday.',version:0,request_id:id(),owner_id:bob};
  assert.equal((await post(url,correction,null)).status,401);assert.equal((await post(url,correction,'bob')).status,404);assert.equal((await post(url,correction)).status,409);
  await ok(await post(`/api/runs/${run.id}/finalize`,{decisions:run.proposals.map(p=>({...p,accept:true}))}));
  assert.equal((await get(url)).status,405);
  const response=await post(url,correction);assert.equal(response.headers.get('cache-control'),'no-store');let value=await ok(response);
  assert.equal(value.final_tasks[0].deadline,'2026-10-21');assert.equal(value.current_tasks[0].deadline,'2026-10-23');assert.equal(value.current_tasks[0].evidence[0].text,run.proposals[0].evidence[0].text);
  assert.equal(value.events.at(-1).payload.reason,correction.reason);
  const text=actionPlan(value),md=actionPlan({...value,current_tasks:[{...value.current_tasks[0],deadline_correction:{...value.current_tasks[0].deadline_correction,reason:'<img src=x> [unsafe](https://evil.example)'}}]},{format:'markdown'});
  assert.match(text,/Originally confirmed deadline: 2026-10-21/);assert.match(text,/Deadline: 2026-10-23/);assert.ok(!md.includes('<img'));assert.ok(!md.includes('[unsafe]('));
  assert.equal((await (await get('/api/today?today=2026-10-23')).json()).sections.today.total,1);
  assert.equal((await (await get('/api/tasks?today=2026-10-23&view=today')).json()).total,1);
  assert.equal((await (await get('/api/calendar?month=2026-10&day=2026-10-23')).json()).scheduled.total,1);
  const csv=await (await get(`/api/runs/${run.id}/tasks.csv`)).text();assert.ok(csv.includes('confirmed_deadline'));assert.ok(csv.includes(correction.reason));
  for(const change of [{reason:''},{deadline:'2026-02-30'},{version:true},{request_id:'bad'}])assert.equal((await post(url,{...correction,...change})).status,400);
  assert.equal((await post(url,{...correction,request_id:id(),deadline:'Unknown'})).status,409);
  value=await ok(await post(url,{...correction,request_id:id(),version:1,deadline:'Unknown',reason:'Date no longer agreed.'}));
  value=await ok(await post(url,correction));assert.equal(value.current_tasks[0].deadline,'Unknown');assert.equal(value.events.filter(e=>e.kind==='task_deadline').length,2);
  assert.equal((await post(url,{...correction,reason:'A different request.'})).status,409);
  assert.equal((await (await get('/api/today?today=2026-10-23','bob')).json()).meta.open_tasks,0);
  assert.equal((await (await get('/api/calendar?month=2026-10')).json()).unscheduled.total,1);
  await ok(await post(`/api/runs/${run.id}/delete`,{confirmation:'DELETE TRANSCRIPT'}));assert.ok([404,410].includes((await post(url,correction)).status));
 }finally{server.closeAllConnections();await server.shutdown();await rm(folder,{recursive:true,force:true});}
});
