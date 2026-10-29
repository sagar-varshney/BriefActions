import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';
import {loadConfig} from '../server/config.mjs';

async function running(action){
 const folder=await mkdtemp(path.join(tmpdir(),'briefactions-extraction-corrections-'));
 const server=createApp({config:loadConfig({}),historyPath:path.join(folder,'history.sqlite3')});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const post=async(url,data)=>{const response=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});assert.ok(response.ok,`${url}: ${response.status} ${await response.clone().text()}`);return response.json();};
 const get=async url=>{const response=await fetch(base+url);assert.ok(response.ok,`${url}: ${response.status}`);return response.json();};
 try{await action({base,post,get});}finally{server.closeAllConnections();await server.shutdown();await rm(folder,{recursive:true,force:true});}
}

test('Full API preserves all 74 predeclared extraction audit contracts',async t=>{
 const cases=JSON.parse(await readFile(new URL('./fixtures/extraction-expanded.json',import.meta.url),'utf8'));
 assert.equal(cases.length,74);
 await running(async({post})=>{
  for(const c of cases)await t.test(c.id,async()=>{
   const run=await post('/api/runs',{transcript:c.transcript,reference_date:c.reference_date});
   assert.equal(run.proposals.length,c.expected.length);
   for(let i=0;i<c.expected.length;i++){
    for(const [field,value] of Object.entries(c.expected[i]))assert.deepEqual(run.proposals[i][field],value);
    for(const e of run.proposals[i].evidence)assert.equal([...run.transcript].slice(e.start,e.end).join(''),e.text);
   }
   if(c.evidence_counts)assert.deepEqual(run.proposals.map(p=>p.evidence.length),c.evidence_counts);
  });
 });
});

test('Unicode follow-up choices keep history, clear uncertain dates and reach Calendar only after approval',async()=>running(async({base,post,get})=>{
 const run=await post('/api/runs',{transcript:'MAYA will review 東京 by Friday.\nMAYA will review 大阪 by Friday.',reference_date:'2026-09-15'});
 assert.equal(run.proposals.length,2);assert.equal(new Set(run.proposals.map(p=>p.proposal_id)).size,2);
 const original=await post(`/api/runs/${run.id}/finalize`,{decisions:run.proposals.map(p=>({...p,accept:true}))});
 const csv=await(await fetch(base+`/api/runs/${run.id}/tasks.csv`)).text(),task=original.final_tasks[0];
 await post(`/api/runs/${run.id}/progress`,{proposal_id:task.proposal_id,status:'in_progress',version:0,request_id:randomUUID().replaceAll('-','')});
 const comparison=await post(`/api/runs/${run.id}/updates`,{transcript:'Maya: Move my 東京 deadline to Monday or next Tuesday instead.\nMaya: I will send the summary tomorrow if approved.',reference_date:'2026-09-16',request_id:randomUUID().replaceAll('-','')});
 const rows=comparison.settings.plan_update.rows;assert.deepEqual(rows.map(r=>r.kind),['changed','unchanged']);
 assert.equal(rows[0].after.deadline,'Unknown');assert.equal(rows[0].after.owner,'MAYA');assert.equal(rows[0].after.proposal_id,task.proposal_id);
 assert.equal((await get('/api/calendar?month=2026-09&day=2026-09-18')).scheduled.total,2);
 const final=await post(`/api/runs/${comparison.id}/update-confirm`,{decisions:[{change_id:rows[0].change_id,apply:true,...rows[0].after}],version:0});
 assert.equal(final.final_tasks.length,2);assert.equal(final.final_tasks[0].deadline,'Unknown');
 assert.equal(final.task_progress[task.proposal_id].status,'in_progress');
 for(const t of final.final_tasks)for(const e of t.evidence)assert.equal([...final.transcript].slice(e.start,e.end).join(''),e.text);
 const calendar=await get('/api/calendar?month=2026-09&day=2026-09-18');assert.equal(calendar.scheduled.total,1);assert.equal(calendar.unscheduled.total,1);
 assert.equal((await get('/api/calendar?month=2026-09&day=2026-09-21')).scheduled.total,0);
 assert.equal(await(await fetch(base+`/api/runs/${run.id}/tasks.csv`)).text(),csv);
}));
