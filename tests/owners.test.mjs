import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';
import {loadConfig} from '../server/config.mjs';
const id=()=>randomUUID().replaceAll('-','');

test('Owner workloads and exact task filters remain private, bounded and current across plan versions',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'briefactions-owners-api-')),alice=randomUUID(),bob=randomUUID();
 const server=createApp({config:{...loadConfig(),authMode:'supabase',supabaseUrl:'https://fixture.supabase.co',databaseUrl:process.env.FLOW_TEST_DATABASE_URL},historyPath:path.join(folder,'history.sqlite3'),verifyAccount:async token=>({alice,bob})[token]});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const get=(url,user='alice')=>fetch(base+url,{headers:user?{Authorization:`Bearer ${user}`}:{}});
 const post=async(url,body)=>{const r=await fetch(base+url,{method:'POST',headers:{Authorization:'Bearer alice','Content-Type':'application/json'},body:JSON.stringify(body)});assert.ok(r.ok,await r.clone().text());return r.json();};
 try{
  assert.equal((await get('/api/owners?today=2026-10-20',null)).status,401);
  let run=await post('/api/runs',{title:'Owners planning',transcript:'Maya will send the report tomorrow.\nMaya will review the budget today.\nJon will draft the notes.\nPlease prepare the agenda.',reference_date:'2026-10-20'});
  assert.equal((await (await get('/api/owners?today=2026-10-20')).json()).total,0);
  run=await post(`/api/runs/${run.id}/finalize`,{decisions:run.proposals.map(p=>({...p,accept:true}))});
  const response=await get('/api/owners?today=2026-10-20');assert.equal(response.headers.get('cache-control'),'no-store');let value=await response.json();
  assert.deepEqual(value.summary,{groups:3,named_owners:2,open_tasks:4,overdue_tasks:0,unassigned_open:1});assert.equal(value.items[0].owner,'Unknown');assert.ok(!JSON.stringify(value).includes('transcript'));
  const exact=await (await get('/api/tasks?'+new URLSearchParams({today:'2026-10-20',owner:'Maya',status:'open'}))).json();assert.equal(exact.total,2);assert.ok(exact.items.every(item=>item.owner==='Maya'));
  assert.equal((await (await get('/api/tasks?today=2026-10-20&owner=Unknown')).json()).total,1);
  await post(`/api/runs/${run.id}/deadline`,{proposal_id:run.final_tasks[0].proposal_id,deadline:'2026-10-19',reason:'Corrected planning date.',version:0,request_id:id()});
  value=await (await get('/api/owners?today=2026-10-20&view=overdue')).json();assert.equal(value.total,1);assert.equal(value.items[0].overdue,1);
  await post(`/api/runs/${run.id}/progress`,{proposal_id:run.final_tasks[0].proposal_id,status:'done',version:0,request_id:id()});
  assert.equal((await (await get('/api/owners?today=2026-10-20&view=overdue')).json()).total,0);
  const follow=await post(`/api/runs/${run.id}/updates`,{transcript:'We discussed the roadmap.',reference_date:'2026-10-21',request_id:id()});await post(`/api/runs/${follow.id}/update-confirm`,{decisions:[],version:0});
  value=await (await get('/api/owners?today=2026-10-20&view=all&page=999&page_size=1')).json();assert.equal(value.total,3);assert.equal(value.page,2);assert.equal(value.items.length,1);assert.equal(value.summary.open_tasks,3);
  assert.equal((await (await get('/api/owners?today=2026-10-20','bob')).json()).total,0);assert.equal((await (await get('/api/tasks?today=2026-10-20&owner=Maya','bob')).json()).total,0);
  for(const query of ['today=2026-02-30','today=2026-10-20&today=2026-10-21','today=2026-10-20&owner_id='+alice,'today=2026-10-20&view=bad','today=2026-10-20&page=-1','today=2026-10-20&page_size=51',''])assert.equal((await get('/api/owners?'+query)).status,400,query);
  assert.equal((await get('/api/tasks?today=2026-10-20&owner=Maya&owner=Jon')).status,400);
  await post(`/api/runs/${run.id}/delete`,{confirmation:'DELETE TRANSCRIPT'});value=await (await get('/api/owners?today=2026-10-20&view=all')).json();assert.equal(value.total,0);assert.equal(value.summary.open_tasks,0);
 }finally{server.closeAllConnections();await server.shutdown();await rm(folder,{recursive:true,force:true});}
});
