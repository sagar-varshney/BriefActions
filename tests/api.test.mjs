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
  assert.equal((await response.json()).engine,'rules-v3');
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
  const listing=await (await fetch(base+'/api/benchmarks')).json();assert.equal(listing.reports.filter(r=>Object.values(listing.manifest.splits).some(s=>s.sha256===r.dataset_sha256)).length,10);
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

test('Annotation routes enforce permission and immutable independent reviews',async()=>{
  const data={transcript:'Person A will send the report tomorrow.',reference_date:'2028-02-28',source:'synthetic',group:'meeting-a',permission:true,anonymized:true};
  assert.equal((await request('/api/annotations',{...data,permission:false})).status,400);
  const response=await request('/api/annotations',data);assert.equal(response.status,201);const c=await response.json();
  assert.equal((await fetch(base+`/api/runs/${c.id}`)).status,404);
  const items=[{task:'send the report',owner:'Person A',deadline:'2028-02-29',evidence:[{text:c.transcript,start:0,end:c.transcript.length}]}];
  assert.equal((await request(`/api/annotations/${c.id}/submit`,{reviewer:'a',items,independent:true})).status,200);
  assert.equal((await request(`/api/annotations/${c.id}/submit`,{reviewer:'a',items,independent:true})).status,400);
  const reviewed=await (await request(`/api/annotations/${c.id}/submit`,{reviewer:'b',items,independent:true})).json();assert.equal(reviewed.status,'agreed');
  const listing=await (await fetch(base+'/api/annotations')).json();assert.equal(listing.length,1);
});
test('Draft endpoint stores partial fields and rejects stale writes',async()=>{
  const run=await (await request('/api/runs',{transcript:'Maya will send the report.',reference_date:'2026-10-11'})).json();
  const decisions=run.proposals.map(p=>({...p,task:'unfinished',accept:true}));
  assert.equal((await request(`/api/runs/${run.id}/draft`,{decisions,version:0})).status,200);
  assert.equal((await request(`/api/runs/${run.id}/draft`,{decisions,version:0})).status,409);
  const restored=await (await fetch(base+`/api/runs/${run.id}`)).json();assert.equal(restored.draft.decisions[0].task,'unfinished');
});

test('Annotation draft routes isolate identities, preserve partial edits and reject stale writes',async()=>{
  const listing=await (await fetch(base+'/api/annotations')).json();const c=listing[0];
  const state={items:[],selection:{text:c.preview,start:0,end:c.preview.length},task:'Unfinished task',owner:'',deadline:'2028-',reason:'',comparison_opened:false};
  const payload={reviewer:'draft-owner',state,version:0,client_id:'test-client',edit_id:1};
  assert.equal((await request(`/api/annotations/${c.id}/draft`,payload)).status,200);
  assert.equal((await request(`/api/annotations/${c.id}/draft`,payload)).status,409);
  const restored=await (await fetch(base+`/api/annotations/${c.id}/draft?reviewer=draft-owner`)).json();
  assert.equal(restored.state.task,'Unfinished task');assert.equal(restored.state.deadline,'2028-');
  assert.equal(await (await fetch(base+`/api/annotations/${c.id}/draft?reviewer=someone-else`)).json(),null);
  assert.equal((await fetch(base+`/api/annotations/${c.id}/draft`)).status,400);
  const publicCase=await (await fetch(base+`/api/annotations/${c.id}`)).json();
  assert.ok(publicCase.events.every(e=>!e.kind.includes('draft')));
});
test('Bundled corpus import copies 84 input-only cases and repeated imports reuse them',async()=>{
  const catalogue=await (await fetch(base+'/api/annotations/corpora')).json();assert.equal(catalogue.length,2);
  assert.equal((await request('/api/annotations/import-corpus',{corpus_id:'../../secret'})).status,400);
  let response=await request('/api/annotations/import-corpus',{corpus_id:'all'});assert.equal(response.status,200);
  assert.equal((await response.json()).imported,84);
  const listing=await (await fetch(base+'/api/annotations')).json();assert.equal(listing.filter(c=>c.origin).length,84);
  const c=await (await fetch(base+`/api/annotations/${listing.find(c=>c.origin).id}`)).json();
  assert.equal(c.gold,null);assert.deepEqual(c.reviews,[]);assert.equal(c.gold_labels_imported,false);
  assert.ok(!Object.hasOwn(c.events[0].payload,'items'));assert.ok(!Object.hasOwn(c.events[0].payload,'rationale'));
  response=await request('/api/annotations/import-corpus',{corpus_id:'all'});
  assert.deepEqual(Object.fromEntries(Object.entries(await response.json()).filter(([k])=>k!=='case_ids')),{imported:0,existing:84});
});

test('User-added proposals keep original extraction intact and require explicit confirmation',async()=>{
  const transcript="Maya will send the report tomorrow.\nAlex: I'll approve the invoice 📄 by Friday.";
  const run=await (await request('/api/runs',{transcript,reference_date:'2026-09-15'})).json();
  const start=transcript.indexOf('Alex:');const quote=transcript.slice(start);
  const item={task:'approve the invoice 📄',owner:'Alex',deadline:'2026-09-18',evidence:[{text:quote,start,end:Array.from(transcript).length}]};
  assert.equal((await request(`/api/runs/${run.id}/manual-actions`,{item:{...item,evidence:[]},request_id:'a'.repeat(32)})).status,400);
  const response=await request(`/api/runs/${run.id}/manual-actions`,{item,request_id:'a'.repeat(32)});assert.equal(response.status,200);
  const updated=await response.json();assert.equal(updated.proposals.length,2);assert.equal(updated.proposals[1].source,'manual');
  assert.equal(updated.events[0].payload.proposals.length,1);
  const retry=await (await request(`/api/runs/${run.id}/manual-actions`,{item,request_id:'a'.repeat(32)})).json();assert.equal(retry.events.length,updated.events.length);
  assert.equal((await request(`/api/runs/${run.id}/finalize`,{decisions:[{...updated.proposals[0],accept:false}]})).status,400);
  const final=await (await request(`/api/runs/${run.id}/finalize`,{decisions:updated.proposals.map((p,i)=>({...p,accept:i===1}))})).json();
  assert.equal(final.final_tasks.length,1);assert.equal(final.final_tasks[0].source,'manual');
  assert.equal((await request(`/api/runs/${run.id}/manual-actions`,{item,request_id:'b'.repeat(32)})).status,409);
});
test('Only frozen reviewed snapshots can be compared and held-out scoring is explicit',async()=>{
  const create=async(group,transcript)=>{
    const c=await (await request('/api/annotations',{transcript,reference_date:'2026-09-15',source:'synthetic',group,permission:true,anonymized:true})).json();
    const items=[{task:'approve the invoice',owner:'Alex',deadline:'2026-09-18',evidence:[{text:transcript,start:0,end:transcript.length}]}];
    for(const reviewer of ['fixture-one','fixture-two'])assert.equal((await request(`/api/annotations/${c.id}/submit`,{reviewer,items,independent:true})).status,200);
    return c;
  };
  const c=await create('reviewed-1','Alex will approve the invoice by Friday.');
  await create('reviewed-2','Alex: I will approve the invoice by Friday.');
  assert.equal((await request('/api/reviewed-benchmarks',{snapshot:c.id})).status,404);
  const frozen=await (await request('/api/annotations/freeze',{seed:'api-fixture',test_fraction:.3})).json();assert.ok(frozen.snapshot);
  const list=await (await fetch(base+'/api/reviewed-snapshots')).json();assert.equal(list[0].id,frozen.snapshot);
  assert.equal((await request('/api/reviewed-benchmarks',{snapshot:frozen.snapshot,split:'test'})).status,400);
  const response=await request('/api/reviewed-benchmarks',{snapshot:frozen.snapshot,split:'all',acknowledge_heldout:true,request_id:'c'.repeat(32)});assert.equal(response.status,200);
  const report=await response.json();assert.equal(report.reports.length,2);assert.ok(report.case_count>=2);
  assert.equal(report.reports[0].label,'Original rules');assert.equal(report.reports[1].label,'Current rules');
  assert.equal((await (await fetch(base+`/api/reviewed-benchmarks/${report.id}`)).json()).dataset_sha256,report.dataset_sha256);
  assert.equal((await (await fetch(base+'/api/reviewed-benchmarks')).json()).length,1);
});
