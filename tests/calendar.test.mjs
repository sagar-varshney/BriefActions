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
import {calendarDate,monthDates,shiftMonth} from '../web/src/calendarDates.js';

test('Calendar dates stay date-only at leap years, month boundaries and early years',()=>{
 assert.equal(monthDates('2024-02').dates.length,29);assert.equal(monthDates('2026-02').dates.length,28);
 assert.equal(monthDates('2026-10').offset,3);assert.equal(shiftMonth('2026-01-31',1),'2026-02-28');
 assert.equal(shiftMonth('2024-01-31',1),'2024-02-29');assert.equal(shiftMonth('2026-12-31',1),'2027-01-31');
 assert.equal(shiftMonth('0001-01-01',-1),'0001-01-01');assert.equal(shiftMonth('9999-12-31',1),'9999-12-31');
 assert.equal(calendarDate('0001-01-01').getUTCFullYear(),1);
 assert.equal(calendarDate('2026-10-01').toISOString().slice(0,10),'2026-10-01');
 const url=new URL('https://example.test/calendar');assert.equal(readRoute(url).page,'calendar');assert.equal(routePath({page:'calendar'}),'/calendar');assert.equal(workspaceDestination('/calendar?private=ignored',url.origin),'/calendar');
});

test('Calendar is private, bounded, and follows current plans while preserving original meetings',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'briefactions-calendar-api-')),alice=randomUUID(),bob=randomUUID();
 const config={...loadConfig(),authMode:'supabase',supabaseUrl:'https://fixture.supabase.co',databaseUrl:process.env.FLOW_TEST_DATABASE_URL};
 const server=createApp({config,historyPath:path.join(folder,'history.sqlite3'),verifyAccount:async token=>({alice,bob})[token]});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const post=(url,body)=>fetch(base+url,{method:'POST',headers:{Authorization:'Bearer alice','Content-Type':'application/json'},body:JSON.stringify(body)});
 const get=(query,user='alice')=>fetch(base+'/api/calendar?'+query,{headers:user?{Authorization:`Bearer ${user}`}:{}});
 try{
  assert.equal((await get('month=2026-10',null)).status,401);
  const run=await (await post('/api/runs',{title:'Release 📋',transcript:'Maya will send the report tomorrow.\nPlease prepare the agenda.',reference_date:'2026-10-20'})).json();
  await post(`/api/runs/${run.id}/finalize`,{decisions:run.proposals.map(p=>({...p,accept:true}))});
  const response=await get('month=2026-10&day=2026-10-21');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const first=await response.json();assert.equal(first.scheduled.total,1);assert.equal(first.unscheduled.total,1);assert.equal(first.days.find(d=>d.date==='2026-10-20').meetings,1);assert.ok(!JSON.stringify(first).includes('transcript'));
  const other=await (await get('month=2026-10&day=2026-10-21','bob')).json();assert.deepEqual(other.days,[]);assert.equal(other.unscheduled.total,0);
  for(const query of ['month=2026-10&owner_id='+alice,'month=2026-10&month=2026-11','month=2026-13','month=2026-10&day=2026-11-01','month=2026-10&page=-1','month=2026-10&page_size=999'])assert.equal((await get(query)).status,400,query);
  const next=await (await post(`/api/runs/${run.id}/updates`,{transcript:'Maya: Move the report to Friday.',reference_date:'2026-10-21',request_id:randomUUID().replaceAll('-','')})).json();
  const decisions=next.settings.plan_update.rows.filter(r=>r.kind!=='unchanged').map(r=>({change_id:r.change_id,apply:true,...(r.after||r.before)}));
  const confirmed=await post(`/api/runs/${next.id}/update-confirm`,{decisions,version:0});assert.equal(confirmed.status,200);
  const latest=await (await get('month=2026-10&day=2026-10-23')).json();assert.equal(latest.scheduled.total,1);assert.equal(latest.scheduled.items[0].run_id,next.id);assert.equal(latest.unscheduled.total,1);
  assert.equal(latest.days.reduce((n,d)=>n+d.meetings,0),2);assert.equal(latest.days.reduce((n,d)=>n+d.tasks,0),1);
  await post(`/api/runs/${run.id}/delete`,{confirmation:'DELETE TRANSCRIPT'});
  const deleted=await (await get('month=2026-10')).json();assert.deepEqual(deleted.days,[]);assert.equal(deleted.unscheduled.total,0);
 }finally{server.closeAllConnections();await server.shutdown();await rm(folder,{recursive:true,force:true});}
});
