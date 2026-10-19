import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createApp} from '../server/index.mjs';
import {loadConfig} from '../server/config.mjs';
import {rateLimiter,accountVerifier} from '../server/auth.mjs';

const alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222';
test('Public configuration fails closed without auth, persistent storage, or HTTPS',()=>{
  const valid={NODE_ENV:'production',PUBLIC_ORIGIN:'https://flow.example',SUPABASE_URL:'https://project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SUPABASE_SECRET_KEY:'sb_secret_test',FLOW_DATABASE_URL:'postgresql://test/database?sslmode=require'};
  assert.equal(loadConfig(valid).host,'0.0.0.0');
  for(const change of [{FLOW_AUTH_MODE:'local'},{FLOW_DATABASE_URL:''},{FLOW_DATABASE_URL:'postgresql://remote/database'},{PUBLIC_ORIGIN:'http://flow.example'},{PUBLIC_ORIGIN:'https://flow.example/path'},{SUPABASE_URL:'https://username:secret@project.supabase.co'},{SUPABASE_PUBLISHABLE_KEY:'sb_secret_test'},{PORT:'-1'}])assert.throws(()=>loadConfig({...valid,...change}));
  const privileged=`x.${Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')}.x`;
  assert.throws(()=>loadConfig({...valid,SUPABASE_PUBLISHABLE_KEY:privileged}));
  assert.throws(()=>loadConfig({HOST:'0.0.0.0',FLOW_AUTH_MODE:'local'}));
});
test('Rate limiter bounds account usage and tracking memory',()=>{
  const allow=rateLimiter({limit:2,capacity:2});assert.ok(allow('a'));assert.ok(allow('a'));assert.equal(allow('a'),false);assert.ok(allow('b'));assert.equal(allow('c'),false);
});
test('Managed auth SDK verifies tokens with the authoritative provider',async()=>{
  const provider=http.createServer((req,res)=>{
    assert.equal(req.url,'/auth/v1/user');assert.equal(req.headers.apikey,'sb_publishable_test');
    const valid=req.headers.authorization==='Bearer valid';
    res.writeHead(valid?200:401,{'Content-Type':'application/json'});res.end(JSON.stringify(valid?{id:alice,is_anonymous:false}:{message:'Invalid JWT'}));
  });
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  try{const verify=accountVerifier({authMode:'supabase',supabaseUrl:`http://127.0.0.1:${provider.address().port}`,supabaseKey:'sb_publishable_test'});assert.equal(await verify('valid'),alice);assert.equal(await verify('forged'),null);}finally{provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));}
});
test('Authenticated routes isolate all private state and authenticated downloads',async()=>{
  const folder=await mkdtemp(path.join(tmpdir(),'flow-accounts-'));
  const config={...loadConfig(),authMode:'supabase',supabaseUrl:'https://test-project.supabase.co',supabaseKey:'sb_publishable_test',publicOrigin:'https://flow.example',databaseUrl:process.env.FLOW_TEST_DATABASE_URL};
  const server=createApp({config,historyPath:path.join(folder,'local.sqlite3'),verifyAccount:async token=>({alice,bob})[token] || null});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const get=(route,token)=>fetch(base+route,{headers:token?{Authorization:`Bearer ${token}`}:{}});
  const post=(route,data,token,origin='https://flow.example')=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,Origin:origin},body:JSON.stringify(data)});
  try {
    for(const route of ['/api/calendar?month=2026-09','/api/tasks?today=2026-09-15','/api/config','/api/runs','/api/annotations','/api/benchmarks','/api/reviewed-snapshots','/api/reviewed-benchmarks'])assert.equal((await get(route)).status,401);
    assert.equal((await get('/api/runs','tampered')).status,401);
    const publicConfig=await (await get('/api/auth-config')).json();assert.equal(publicConfig.mode,'supabase');assert.equal(publicConfig.databaseUrl,undefined);
    assert.equal((await post('/api/runs',{},'alice','https://evil.example')).status,403);
    const created=await post('/api/runs',{transcript:'Maya will send the report tomorrow.',reference_date:'2026-09-15',owner_id:bob,FLOW_ACCOUNT_ID:bob},'alice');assert.equal(created.status,201);
    const run=await created.json();assert.equal((await (await get('/api/runs','alice')).json()).length,1);assert.deepEqual(await (await get('/api/runs','bob')).json(),[]);
    for(const suffix of ['', '/history.json','/tasks.csv'])assert.equal((await get(`/api/runs/${run.id}${suffix}`,'bob')).status,404);
    assert.equal((await post(`/api/runs/${run.id}/finalize`,{decisions:run.proposals.map(p=>({...p,accept:true}))},'bob')).status,404);
    const finalized=await post(`/api/runs/${run.id}/finalize`,{decisions:run.proposals.map(p=>({...p,accept:true}))},'alice');assert.equal(finalized.status,200);
    const progress={proposal_id:run.proposals[0].proposal_id,status:'done',version:0,request_id:'d'.repeat(32),owner_id:bob};
    assert.equal((await fetch(base+`/api/runs/${run.id}/progress`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(progress)})).status,401);
    assert.equal((await post(`/api/runs/${run.id}/progress`,progress,'bob')).status,404);
    const tracked=await post(`/api/runs/${run.id}/progress`,progress,'alice');assert.equal(tracked.status,200);assert.equal((await tracked.json()).task_progress[progress.proposal_id].status,'done');
    const tasks=await (await get('/api/tasks?today=2026-09-15&status=','alice')).json();
    assert.equal(tasks.total,1);assert.equal(tasks.items[0].run_id,run.id);assert.equal(tasks.items[0].status,'done');
    const otherTasks=await (await get('/api/tasks?today=2026-09-15&status=','bob')).json();
    assert.equal(otherTasks.total,0);assert.deepEqual(otherTasks.items,[]);assert.ok(Object.values(otherTasks.counts).every(count=>count===0));
    assert.equal((await get('/api/tasks?today=2026-09-15&owner_id='+alice,'bob')).status,400);
    const exported=await get(`/api/runs/${run.id}/tasks.csv`,'alice');assert.equal(exported.status,200);assert.ok((await exported.text()).includes('Maya'));assert.equal(exported.headers.get('cache-control'),'no-store');
    const annotation=await (await post('/api/annotations',{transcript:'No actions.',reference_date:'2026-09-15',source:'synthetic',permission:true,anonymized:true,group:'a'},'alice')).json();
    assert.deepEqual(await (await get('/api/annotations','bob')).json(),[]);assert.equal((await get(`/api/annotations/${annotation.id}`,'bob')).status,404);
    assert.equal((await get('/api/runs','alice')).headers.get('x-frame-options'),'DENY');
  }finally{server.closeAllConnections();await server.shutdown();await rm(folder,{recursive:true,force:true});}
});
test('Authentication outage cannot open a workspace',async()=>{
  const config={...loadConfig(),authMode:'supabase',supabaseUrl:'https://test-project.supabase.co'};
  const server=createApp({config,verifyAccount:async()=>{throw new Error('offline');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/runs`,{headers:{Authorization:'Bearer token'}});assert.equal(r.status,503);}finally{server.closeAllConnections();await server.shutdown();}
});
