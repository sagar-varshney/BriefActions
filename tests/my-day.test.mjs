import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';
import {loadConfig} from '../server/config.mjs';

test('My day uses verified accounts, confirmed corrections and current plan versions',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'briefactions-daily-api-')),alice=randomUUID(),bob=randomUUID();
 const config={...loadConfig(),authMode:'supabase',supabaseUrl:'https://fixture.supabase.co',databaseUrl:process.env.FLOW_TEST_DATABASE_URL};
 const server=createApp({config,historyPath:path.join(folder,'history.sqlite3'),verifyAccount:async token=>({alice,bob})[token]});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const get=(query,user='alice')=>fetch(base+'/api/today?'+query,{headers:user?{Authorization:`Bearer ${user}`}:{}});
 const post=async(url,body)=>{const r=await fetch(base+url,{method:'POST',headers:{Authorization:'Bearer alice','Content-Type':'application/json'},body:JSON.stringify(body)});assert.ok(r.ok,await r.clone().text());return r.json();};
 try{
  assert.equal((await get('today=2026-10-20',null)).status,401);
  const run=await post('/api/runs',{title:'Daily planning',transcript:'Maya will send the report tomorrow.\nPlease prepare the agenda.',reference_date:'2026-10-19'});
  let value=await (await get('today=2026-10-20')).json();assert.equal(value.sections.reviews.total,1);assert.equal(value.sections.today.total,0);
  await post(`/api/runs/${run.id}/finalize`,{decisions:run.proposals.map(p=>({...p,task:p.task.includes('report')?'send the corrected report':p.task,accept:true}))});
  const response=await get('today=2026-10-20');assert.equal(response.headers.get('cache-control'),'no-store');value=await response.json();assert.equal(value.sections.today.items[0].task,'send the corrected report');assert.equal(value.sections.reviews.total,0);assert.equal(value.meta.undated,1);
  const draft=await post(`/api/runs/${run.id}/updates`,{transcript:'Maya: Move the corrected report to Friday.',reference_date:'2026-10-20',request_id:randomUUID().replaceAll('-','')});
  value=await (await get('today=2026-10-20')).json();assert.equal(value.sections.reviews.items[0].review_kind,'followup');assert.equal(value.sections.today.total,1);
  const rows=draft.settings.plan_update.rows;await post(`/api/runs/${draft.id}/update-confirm`,{version:0,decisions:rows.filter(r=>r.kind!=='unchanged').map(r=>({change_id:r.change_id,apply:true,...Object.fromEntries(['task','owner','deadline'].map(k=>[k,(r.after||r.before)[k]]))}))});
  value=await (await get('today=2026-10-20')).json();assert.equal(value.sections.today.total,0);assert.equal(value.sections.upcoming.total,1);assert.equal(value.sections.upcoming.items[0].run_id,draft.id);assert.equal(value.sections.reviews.total,0);assert.equal(value.meta.undated,1);
  const other=await (await get('today=2026-10-20','bob')).json();assert.equal(other.meta.saved_meetings,0);assert.ok(Object.values(other.sections).every(s=>s.total===0));
  for(const q of ['today=2026-10-20&owner_id='+alice,'today=2026-10-20&today=2026-10-21','today=2026-02-30','today=2026-10-20&limit=99','today=2026-10-20&limit=-1',''])assert.equal((await get(q)).status,400,q);
  await post(`/api/runs/${run.id}/delete`,{confirmation:'DELETE TRANSCRIPT'});value=await (await get('today=2026-10-20')).json();assert.equal(value.meta.open_tasks,0);assert.equal(value.meta.saved_meetings,0);
 }finally{server.closeAllConnections();await server.shutdown();await rm(folder,{recursive:true,force:true});}
});
