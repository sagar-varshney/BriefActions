import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, engine } from '../server/index.mjs';

let server, base, folder, saved;
before(async () => {
  folder = await mkdtemp(path.join(tmpdir(),'flow-api-'));
  server = createApp({historyPath:path.join(folder,'history.sqlite3')});
  await new Promise((resolve,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(resolve=>server.close(resolve));
  await rm(folder,{recursive:true,force:true});
});
async function request(url, data, method='POST') {
  return fetch(base+url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
}
test('Python readiness and sample configuration',async()=>{
  const response=await fetch(base+'/api/health');assert.equal(response.status,200);
  assert.equal((await response.json()).engine,'rules-v2');
  const config=await (await fetch(base+'/api/config')).json();assert.ok(config.sample_transcript.includes('Maya'));
});
test('Analyze validates input, saves grounded proposals and metadata',async()=>{
  for(const invalid of [{transcript:''},{clusters:0},{reference_date:'2026-02-30'}]){
    const response=await request('/api/runs',{transcript:'Maya will review the risks tomorrow.',reference_date:'2026-09-15',clusters:3,...invalid});
    assert.equal(response.status,400);
  }
  assert.deepEqual(await (await fetch(base+'/api/runs')).json(),[]);
  const response=await request('/api/runs',{transcript:'Maya will review the risks tomorrow.\nJon will send the invoice.',reference_date:'2026-09-15',clusters:3});
  assert.equal(response.status,201);saved=await response.json();
  assert.equal(saved.status,'review');assert.equal(saved.proposals.length,2);
  assert.equal(saved.proposals[0].deadline,'2026-09-16');
  for(const p of saved.proposals) for(const e of p.evidence) assert.equal(saved.transcript.slice(e.start,e.end),e.text);
});
test('Rejected review does not persist; explicit correction and final exports do',async()=>{
  const decisions=saved.proposals.map((p,i)=>({...p,accept:i===0}));
  let response=await request(`/api/runs/${saved.id}/finalize`,{decisions:[{...decisions[0],deadline:'not-a-date'},decisions[1]]});
  assert.equal(response.status,400);
  assert.equal((await (await fetch(base+`/api/runs/${saved.id}`)).json()).events.length,1);
  response=await fetch(base+`/api/runs/${saved.id}/tasks.csv`);assert.equal(response.status,409);
  decisions[0].owner='Ravi';decisions[0].task='Review launch risks';
  response=await request(`/api/runs/${saved.id}/finalize`,{decisions});assert.equal(response.status,200);
  const final=await response.json();assert.equal(final.final_tasks.length,1);assert.equal(final.final_tasks[0].owner,'Ravi');
  assert.equal(final.events[0].payload.proposals[0].owner,'Maya');
  assert.equal(final.events[1].payload.decisions[0].corrections.owner.after,'Ravi');
  assert.equal((await request(`/api/runs/${saved.id}/finalize`,{decisions})).status,409);
  const csv=await (await fetch(base+`/api/runs/${saved.id}/tasks.csv`)).text();
  assert.ok(csv.includes('Ravi'));assert.ok(csv.includes('Maya will review the risks tomorrow.'));assert.ok(!csv.includes('Jon'));
  const history=await (await fetch(base+`/api/runs/${saved.id}/history.json`)).json();assert.deepEqual(history.map(e=>e.kind),['extraction','review','final']);
  const runs=await (await fetch(base+'/api/runs')).json();assert.equal(runs[0].status,'confirmed');
});
test('Empty extraction can be confirmed explicitly',async()=>{
  const run=await (await request('/api/runs',{transcript:'We already reviewed the report.',reference_date:'2026-09-15'})).json();
  assert.deepEqual(run.proposals,[]);
  const final=await (await request(`/api/runs/${run.id}/finalize`,{decisions:[]})).json();assert.deepEqual(final.final_tasks,[]);
});
test('Benchmark reports include measured models and annotated cases',async()=>{
  const listing=await (await fetch(base+'/api/benchmarks')).json();assert.equal(listing.reports.length,10);
  const report=listing.reports.find(r=>r.label==='rules'&&r.dataset==='test.jsonl');
  const full=await (await fetch(base+`/api/benchmarks/${report.id}`)).json();assert.equal(full.cases.length,30);assert.equal(full.report.runs.length,30);
  assert.equal((await fetch(base+'/api/benchmarks/0000000000000000')).status,404);
});
test('API rejects malformed bodies, unexpected routes and cross-site writes',async()=>{
  assert.equal((await fetch(base+'/api/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:'{bad'})).status,400);
  assert.equal((await fetch(base+'/api/runs',{method:'POST',body:'text'})).status,415);
  assert.equal((await fetch(base+'/api/unknown')).status,404);
  assert.equal((await fetch(base+'/api/runs',{method:'POST',headers:{'Origin':'https://example.com','Content-Type':'application/json'},body:'{}'})).status,403);
});
test('Missing Python returns a useful service error',async()=>{
  const original=process.env.PYTHON_BIN;
  try {process.env.PYTHON_BIN='/nonexistent/flow-python';await assert.rejects(engine({operation:'health'}),{status:503});}
  finally {if(original) process.env.PYTHON_BIN=original;else delete process.env.PYTHON_BIN;}
});
