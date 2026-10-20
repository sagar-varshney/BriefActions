import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';
import {loadConfig} from '../server/config.mjs';
import {readRoute,routePath} from '../web/src/routing.js';
import {workspaceDestination} from '../web/src/authRouting.js';
const id=()=>randomUUID().replaceAll('-','');

test('Series preparation links survive routing and sign-in without accepting arbitrary destinations',()=>{
 const seriesId=id(),route={page:'history',runId:null,seriesView:true,seriesId};assert.deepEqual(readRoute(new URL('https://flow.example/history/series/'+seriesId)),route);assert.equal(routePath(route),'/history/series/'+seriesId);assert.equal(workspaceDestination('/history/series/'+seriesId+'?private=text','https://flow.example'),'/history/series/'+seriesId);assert.equal(readRoute(new URL('https://flow.example/history/series/not-an-id')).invalid,true);
});

test('Series and agendas are private, retry-safe, current across plan versions, and erased with their sources',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'briefactions-series-api-')),alice=randomUUID(),bob=randomUUID();
 const server=createApp({config:{...loadConfig(),authMode:'supabase',supabaseUrl:'https://fixture.supabase.co',databaseUrl:process.env.FLOW_TEST_DATABASE_URL},historyPath:path.join(folder,'history.sqlite3'),verifyAccount:async token=>({alice,bob})[token]});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const request=(url,body,user='alice')=>fetch(base+url,{method:body?'POST':'GET',headers:{...(user?{Authorization:`Bearer ${user}`}:{}) ,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const json=async response=>{assert.ok(response.ok,await response.clone().text());return response.json();},get=async(url,user='alice')=>json(await request(url,null,user)),post=async(url,body)=>json(await request(url,body));
 try{
  assert.equal((await request('/api/series',null,null)).status,401);
  const seriesInput={name:'Weekly product 📋',request_id:id()},series=await post('/api/series',seriesInput);assert.equal((await post('/api/series',seriesInput)).id,series.id);
  assert.equal((await request('/api/series',{...seriesInput,name:'Other'})).status,409);
  assert.equal((await get('/api/series','bob')).total,0);assert.equal((await request(`/api/series/${series.id}`,null,'bob')).status,404);
  const input={title:'Product review',transcript:'Maya will send the report tomorrow.\nPlease prepare the agenda.',reference_date:'2026-10-20',request_id:id(),series_id:series.id};let run=await post('/api/runs',input);
  assert.equal(run.series_membership.series.id,series.id);assert.equal((await post('/api/runs',input)).id,run.id);
  let value=await get(`/api/series/${series.id}/preparation?today=2026-10-20`);assert.equal(value.counts.reviews,1);assert.equal(value.counts.open_tasks,0);
  run=await post(`/api/runs/${run.id}/finalize`,{decisions:run.proposals.map(p=>({...p,accept:true}))});const source=structuredClone(run.final_tasks);
  const response=await request(`/api/series/${series.id}/preparation?today=2026-10-20`);assert.equal(response.headers.get('cache-control'),'no-store');value=await json(response);assert.equal(value.counts.open_tasks,2);assert.equal(value.counts.undated,1);assert.ok(!JSON.stringify(value).includes('evidence'));assert.ok(!JSON.stringify(value).includes('transcript'));
  const agenda={...value.suggestion,version:0,source_revision:value.source_revision,request_id:id(),today:'2026-10-20'};value=await post(`/api/series/${series.id}/agenda`,agenda);assert.equal(value.agenda_version,1);assert.equal(value.counts.changes,0);
  value=await post(`/api/series/${series.id}/agenda`,agenda);assert.equal(value.agenda_version,1);assert.equal((await get(`/api/series/${series.id}/agendas/1`)).body,agenda.body);
  assert.equal((await request(`/api/series/${series.id}/agenda`,{...agenda,body:'Another edit'})).status,409);assert.equal((await request(`/api/series/${series.id}/agendas/1`,null,'bob')).status,404);
  const follow=await post(`/api/runs/${run.id}/updates`,{transcript:'We discussed the roadmap.','reference_date':'2026-10-21',request_id:id()});await post(`/api/runs/${follow.id}/update-confirm`,{version:0,decisions:[]});
  value=await get(`/api/series/${series.id}/preparation?today=2026-10-20`);assert.equal(value.counts.open_tasks,2);assert.equal(value.counts.meetings,2);assert.ok(value.items.every(t=>t.run_id===follow.id));
  assert.equal((await request(`/api/series/${series.id}/agenda`,{...agenda,version:1,request_id:id()})).status,409);
  const other=await post('/api/series',{name:'Other series',request_id:id()});const moved=await post(`/api/runs/${follow.id}/series`,{series_id:other.id,version:1,request_id:id()});assert.equal(moved.series_membership.version,2);
  assert.equal((await get(`/api/runs/${run.id}`)).series_membership.series.id,other.id);assert.equal((await post('/api/runs',input)).series_membership.series.id,other.id,'Analysis retry does not undo a later group change');
  assert.equal((await get(`/api/series/${series.id}/preparation?today=2026-10-20`)).counts.open_tasks,0);
  assert.deepEqual((await get(`/api/runs/${run.id}`)).final_tasks,source);
  for(const q of ['today=2026-02-30','today=2026-10-20&today=2026-10-21','today=2026-10-20&owner_id='+alice,'today=2026-10-20&view=bad','today=2026-10-20&page=-1','today=2026-10-20&page_size=13',''])assert.equal((await request(`/api/series/${series.id}/preparation?`+q)).status,400,q);
  assert.equal((await request('/api/series?query=a&query=b')).status,400);assert.equal((await request('/api/series?page_size=51')).status,400);
  for(const bad of [[],false,'bad'])assert.equal((await request('/api/runs',{...input,request_id:id(),series_id:bad})).status,400);
  await post(`/api/runs/${run.id}/delete`,{confirmation:'DELETE TRANSCRIPT'});value=await get(`/api/series/${series.id}/preparation?today=2026-10-20`);assert.equal(value.agenda,null);assert.equal(value.agenda_version,1);assert.equal((await request(`/api/series/${series.id}/agendas/1`)).status,404);
  assert.equal((await request(`/api/series/${series.id}/agenda`,agenda)).status,409);
  const standalone=await post('/api/runs',{title:'Keep this meeting',transcript:'Jon will send the invoice tomorrow.',reference_date:'2026-10-20',series_id:other.id});
  assert.equal((await request(`/api/series/${other.id}/delete`,{confirmation:'DELETE TRANSCRIPT'})).status,400);await post(`/api/series/${other.id}/delete`,{confirmation:'DELETE SERIES'});
  assert.equal((await get(`/api/runs/${standalone.id}`)).series_membership.series,null);assert.equal((await request(`/api/series/${other.id}`)).status,404);
 }finally{server.closeAllConnections();await server.shutdown();await rm(folder,{recursive:true,force:true});}
});
