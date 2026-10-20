import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';
import {loadConfig} from '../server/config.mjs';
import {followupMessage,followupText,weeklySummary} from '../web/src/followupMessage.js';
const id=()=>randomUUID().replaceAll('-','');

test('Follow-up text uses confirmed corrections and current progress without inventing missing details',()=>{
 const tasks=[{proposal_id:'one',task:'Send corrected report',owner:'Unknown',deadline:'Unknown'},{proposal_id:'two',task:'Check budget',owner:'Maya',deadline:'2026-10-25'}];
 const run={status:'confirmed',title:'Planning 📋',reference_date:'2026-10-20',followup_revision:'a'.repeat(64),final_tasks:[{...tasks[0],task:'Old text',deadline:'2026-10-21'}],current_tasks:tasks,task_progress:{two:{status:'done',version:1}}},before=structuredClone(run);
 const value=followupMessage(run);assert.ok(value.body.includes('Send corrected report'));assert.ok(!value.body.includes('Old text'));assert.ok(!value.body.includes('2026-10-21'));assert.match(value.body,/owner Unknown; deadline Unknown/);assert.match(value.body,/Completed\n• Check budget/);assert.match(followupText(value),/^Subject: Follow-up: Planning 📋\n\n/);assert.deepEqual(run,before);
 assert.throws(()=>followupMessage({...run,status:'review'}),/current confirmed/);assert.throws(()=>followupMessage({...run,superseded_by:'b'.repeat(32)}));
 assert.match(followupMessage({...run,current_tasks:[],final_tasks:[]}).body,/No open tasks/);
 assert.throws(()=>followupMessage({...run,current_tasks:[{...tasks[0],task:'x'.repeat(100001)}]}),/too long/);
 const literal=followupMessage({...run,title:'Title\n<script>',current_tasks:[{...tasks[0],task:'<img src=x onerror=alert(1)>'}]});assert.ok(!literal.subject.includes('\n'));assert.ok(literal.body.includes('<img'),'Message text remains literal and is not rendered as HTML');
});

test('Weekly copy labels counts and time boundaries without presenting a paged preview as the full report',()=>{
 const value=weeklySummary({period_start:'2026-10-14',period_end:'2026-10-20',today:'2026-10-20',time_zone:'Asia/Kolkata',upcoming_through:'2026-10-27',counts:{completed:21,overdue:9,upcoming:12,reviews:3,undated:2},items:[{task:'Only one preview'}]});
 assert.match(value,/completed in this period: 21/);assert.match(value,/Asia\/Kolkata/);assert.match(value,/Earlier plan versions and reopened tasks are excluded/);assert.ok(!value.includes('Only one preview'));
});

test('Follow-up saves and weekly snapshots require verified accounts, preserve sources and recover retries',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'briefactions-follow-through-api-')),alice=randomUUID(),bob=randomUUID();
 const server=createApp({config:{...loadConfig(),authMode:'supabase',supabaseUrl:'https://fixture.supabase.co',databaseUrl:process.env.FLOW_TEST_DATABASE_URL},historyPath:path.join(folder,'history.sqlite3'),verifyAccount:async token=>({alice,bob})[token]});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const request=(url,body,user='alice')=>fetch(base+url,{method:body?'POST':'GET',headers:{...(user?{Authorization:`Bearer ${user}`}:{}) ,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const json=async response=>{assert.ok(response.ok,await response.clone().text());return response.json();},post=async(url,body)=>json(await request(url,body));
 try{
  assert.equal((await request('/api/weekly-review?today=2026-10-20',null,null)).status,401);
  let run=await post('/api/runs',{title:'Weekly planning',transcript:'Maya will send the report tomorrow.\nPlease prepare the agenda.',reference_date:'2026-10-20'});
  const payload={subject:'Follow-up',body:'Confirmed tasks only.',version:0,source_revision:run.followup_revision,request_id:id()};
  assert.equal((await request(`/api/runs/${run.id}/followup-draft`,payload)).status,409);
  run=await post(`/api/runs/${run.id}/finalize`,{decisions:run.proposals.map(p=>({...p,accept:true}))});const originals=structuredClone(run.final_tasks);
  const first={...payload,source_revision:run.followup_revision,request_id:id()};
  assert.equal((await request(`/api/runs/${run.id}/followup-draft`,first,null)).status,401);
  assert.equal((await request(`/api/runs/${run.id}/followup-draft`,first,'bob')).status,404);
  run=await post(`/api/runs/${run.id}/followup-draft`,first);assert.equal(run.followup_draft.version,1);assert.deepEqual(run.final_tasks,originals);
  const second={...first,version:1,body:'Edited message',request_id:id()};run=await post(`/api/runs/${run.id}/followup-draft`,second);
  run=await post(`/api/runs/${run.id}/followup-draft`,first);assert.equal(run.followup_draft.body,'Edited message');assert.equal(run.events.filter(e=>e.kind==='followup_draft').length,2);
  assert.equal((await request(`/api/runs/${run.id}/followup-draft`,{...first,request_id:id()})).status,409);
  run=await post(`/api/runs/${run.id}/deadline`,{proposal_id:run.final_tasks[0].proposal_id,deadline:'2026-10-19',reason:'Updated date.',version:0,request_id:id()});
  assert.equal((await request(`/api/runs/${run.id}/followup-draft`,{...second,version:2,request_id:id()})).status,409);
  const today=new Date().toISOString().slice(0,10);
  run=await post(`/api/runs/${run.id}/progress`,{proposal_id:run.final_tasks[0].proposal_id,status:'done',version:0,request_id:id()});
  const response=await request('/api/weekly-review?'+new URLSearchParams({today,time_zone:'UTC'}));assert.equal(response.headers.get('cache-control'),'no-store');let review=await json(response);assert.equal(review.counts.completed,1);assert.equal(review.counts.undated,1);assert.equal(review.items[0].run_id,run.id);assert.ok(!JSON.stringify(review).includes('evidence'));
  const other=await json(await request('/api/weekly-review?today='+today,null,'bob'));assert.deepEqual(other.counts,{completed:0,overdue:0,upcoming:0,reviews:0,undated:0});
  for(const query of ['','today=2026-02-30','today=2026-10-20&time_zone=Not/AZone','today=2026-10-20&today=2026-10-21','today=2026-10-20&owner_id='+alice,'today=2026-10-20&view=bad','today=2026-10-20&page=-1','today=2026-10-20&page_size=51'])assert.equal((await request('/api/weekly-review?'+query)).status,400,query);
  const exportResponse=await request('/api/account/export');assert.ok((await exportResponse.text()).includes('Edited message'));
  await post(`/api/runs/${run.id}/delete`,{confirmation:'DELETE TRANSCRIPT'});review=await json(await request('/api/weekly-review?today='+today));assert.equal(review.total,0);assert.equal((await request(`/api/runs/${run.id}/followup-draft`,first)).status,404);
 }finally{server.closeAllConnections();await server.shutdown();await rm(folder,{recursive:true,force:true});}
});
