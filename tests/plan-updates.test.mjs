import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';
import {loadConfig} from '../server/config.mjs';

test('Private follow-up review is isolated, recoverable, and supersedes only after approval',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'briefactions-plan-updates-')),alice=randomUUID(),bob=randomUUID();
 const config={...loadConfig(),authMode:'supabase',supabaseUrl:'https://test-project.supabase.co',databaseUrl:process.env.FLOW_TEST_DATABASE_URL};
 const server=createApp({config,historyPath:path.join(folder,'history.sqlite3'),verifyAccount:async token=>({alice,bob})[token]});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const post=(url,data,user='alice')=>fetch(base+url,{method:'POST',headers:{Authorization:`Bearer ${user}`,'Content-Type':'application/json'},body:JSON.stringify(data)});
 const get=(url,user='alice')=>fetch(base+url,{headers:user?{Authorization:`Bearer ${user}`}:{}});
 try{
  const draft=await (await post('/api/runs',{transcript:'Maya will send the report by Friday.\nJon will draft the notes.',reference_date:'2026-10-16'})).json();
  const input={transcript:'Maya: Move send the report to Monday.\nJon: Cancel draft the notes.\nAda: I will review the budget tomorrow.',reference_date:'2026-10-17',request_id:randomUUID().replaceAll('-',''),owner_id:bob};
  assert.equal((await post(`/api/runs/${draft.id}/updates`,input)).status,409);
  const original=await (await post(`/api/runs/${draft.id}/finalize`,{decisions:draft.proposals.map(p=>({...p,accept:true}))})).json();
  const originalCSV=await (await get(`/api/runs/${original.id}/tasks.csv`)).text();
  const anonymous=await fetch(base+`/api/runs/${original.id}/updates`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(anonymous.status,401);
  assert.equal((await post(`/api/runs/${original.id}/updates`,input,'bob')).status,404);
  let response=await post(`/api/runs/${original.id}/updates`,input);assert.equal(response.status,201);const comparison=await response.json();
  assert.equal((await (await post(`/api/runs/${original.id}/updates`,input)).json()).id,comparison.id);
  assert.equal((await post(`/api/runs/${original.id}/updates`,{...input,transcript:'Another input.'})).status,409);
  assert.equal((await get(`/api/runs/${comparison.id}`,'bob')).status,404);
  for(const action of ['update-draft','update-confirm'])assert.equal((await post(`/api/runs/${comparison.id}/${action}`,{decisions:[],version:0},'bob')).status,404);
  assert.equal((await (await get('/api/tasks?today=2026-10-17&status=')).json()).total,2);
  const rows=comparison.settings.plan_update.rows,decisions=rows.filter(r=>r.kind!=='unchanged').map(r=>({change_id:r.change_id,apply:true,...Object.fromEntries(['task','owner','deadline'].map(k=>[k,(r.after||r.before)[k]]))}));
  decisions.find(d=>d.change_id===rows[0].change_id).apply=false;
  response=await post(`/api/runs/${comparison.id}/update-draft`,{decisions,version:0});assert.equal(response.status,200);assert.equal((await response.json()).update_draft.version,1);
  assert.equal((await post(`/api/runs/${comparison.id}/update-draft`,{decisions,version:0})).status,409);
  assert.equal((await post(`/api/runs/${comparison.id}/finalize`,{decisions:comparison.proposals.map(p=>({...p,accept:true}))})).status,409);
  const payload={decisions,version:1};response=await post(`/api/runs/${comparison.id}/update-confirm`,payload);assert.equal(response.status,200);const final=await response.json();assert.equal(final.final_tasks.length,2);assert.equal(final.final_tasks[0].deadline,'2026-10-16');
  const retry=await (await post(`/api/runs/${comparison.id}/update-confirm`,payload)).json();assert.deepEqual(retry.events,final.events);
  const tasks=await (await get('/api/tasks?today=2026-10-17&status=')).json();assert.equal(tasks.total,2);assert.ok(tasks.items.every(t=>t.run_id===comparison.id));
  assert.equal(await (await get(`/api/runs/${original.id}/tasks.csv`)).text(),originalCSV);
  assert.ok((await (await get('/api/account/export')).text()).includes('plan_update_review'));
  assert.equal((await post(`/api/runs/${original.id}/progress`,{proposal_id:original.final_tasks[0].proposal_id,status:'done',version:0,request_id:randomUUID().replaceAll('-','')})).status,409);
  assert.equal((await post(`/api/runs/${original.id}/delete`,{confirmation:'DELETE TRANSCRIPT'},'bob')).status,404);
  const deleted=await (await post(`/api/runs/${original.id}/delete`,{confirmation:'DELETE TRANSCRIPT'})).json();assert.deepEqual(new Set(deleted.deleted_ids),new Set([original.id,comparison.id]));
  assert.equal((await get(`/api/runs/${comparison.id}`)).status,404);assert.equal((await post(`/api/runs/${original.id}/updates`,input)).status,410);
  assert.equal((await (await get('/api/tasks?today=2026-10-17&status=')).json()).total,0);
 }finally{server.closeAllConnections();await server.shutdown();await rm(folder,{recursive:true,force:true});}
});
