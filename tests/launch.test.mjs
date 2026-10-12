import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp,engine} from '../server/index.mjs';
import {loadConfig} from '../server/config.mjs';
import {rateLimiter,credentialKey} from '../server/auth.mjs';
import {createTelemetry,routeName} from '../server/telemetry.mjs';

const hosted=()=>({...loadConfig(),authMode:'supabase',supabaseUrl:'https://fixture.supabase.co',supabaseKey:'sb_publishable_fixture'});
async function running(options,action){
  const server=createApp(options);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await action(`http://127.0.0.1:${server.address().port}`,server);}
  finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve:value=>resolve(value)};};

test('Shared proxy users have independent limits; token rotation and forged headers cannot reset an account',async()=>{
  const ids=[randomUUID(),randomUUID(),randomUUID()];
  await running({config:hosted(),verifyAccount:async token=>ids[Number(token.split('-')[1])]},async base=>{
    const get=(token,ip='203.0.113.9')=>fetch(base+'/api/unknown',{headers:{Authorization:`Bearer ${token}`,'X-Forwarded-For':ip,'CF-Connecting-IP':ip}});
    for(let i=0;i<150;i++)assert.equal((await get(`fixture-${i%3}`)).status,404);
    for(let i=0;i<40;i++)assert.equal((await get(`rotated-0-${i}`,`198.51.100.${i}`)).status,404);
    const limited=await get('new-0-token','192.0.2.42');assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60');
    assert.equal((await get('fixture-1')).status,404);
  });
});

test('Authentication verification is bounded and frees its slot after a provider failure',async()=>{
  const gate=deferred(),entered=deferred();let active=0,peak=0;
  await running({config:hosted(),maxAuthChecks:2,verifyAccount:async token=>{active++;peak=Math.max(peak,active);if(active===2)entered.resolve();await gate.promise;active--;if(token==='bad')throw new Error('private provider detail');return randomUUID();}},async base=>{
    const get=token=>fetch(base+'/api/unknown',{headers:{Authorization:`Bearer ${token}`}});
    const one=get('good'),two=get('bad');await entered.promise;
    const busy=await get('other');assert.equal(busy.status,503);assert.equal(busy.headers.get('retry-after'),'2');
    gate.resolve();assert.equal((await one).status,404);const failed=await two;assert.equal(failed.status,503);assert.ok(!(await failed.text()).includes('private provider detail'));
    assert.equal((await get('next')).status,404);assert.equal(peak,2);
  });
});

test('One busy analysis does not block liveness or readiness; queue timeout and recovery are bounded',async()=>{
  const gate=deferred(),entered=deferred(),probes=[];let active=0,peak=0,time=0;
  await running({maxWorkers:1,queueTimeout:40,healthTtl:1,healthNow:()=>time,checkHealth:async deep=>{probes.push(deep);},execute:async()=>{active++;peak=Math.max(peak,active);entered.resolve();await gate.promise;active--;return [];}},async base=>{
    assert.equal((await fetch(base+'/api/health')).status,200);
    const work=fetch(base+'/api/runs');await entered.promise;time=2;
    assert.equal((await fetch(base+'/api/live')).status,200);assert.equal((await fetch(base+'/api/health')).status,200);
    const queued=await fetch(base+'/api/runs');assert.equal(queued.status,503);assert.equal(queued.headers.get('retry-after'),'2');
    gate.resolve();assert.equal((await work).status,200);assert.equal((await fetch(base+'/api/runs')).status,200);
    assert.equal(peak,1);assert.deepEqual(probes,[true,false]);
  });
});

test('Concurrent health requests share a single probe and failed readiness still leaves liveness available',async()=>{
  const gate=deferred(),entered=deferred(),both=deferred();let count=0,seen=0;
  await running({checkHealth:async()=>{count++;entered.resolve();await gate.promise;throw new Error('private connection URI');}},async (base,server)=>{
    server.on('request',req=>{if(req.url==='/api/health'&&++seen===2)both.resolve();});
    const one=fetch(base+'/api/health'),two=fetch(base+'/api/health');await Promise.all([entered.promise,both.promise]);
    assert.equal((await fetch(base+'/api/live')).status,200);gate.resolve();
    for(const request of [one,two]){const response=await request;assert.equal(response.status,500);assert.ok(!(await response.text()).includes('private connection URI'));}
    assert.equal(count,1);
  });
});

test('Failure references match sanitized logs; private values and supplied request IDs never enter logs',async()=>{
  const events=[],telemetry=createTelemetry({enabled:true,write:event=>events.push(event)}),secret='private-'+randomUUID();
  await running({telemetry,execute:async()=>{throw new Error(secret);}},async base=>{
    const response=await fetch(base+'/api/runs',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${secret}`,'X-Request-ID':secret},body:JSON.stringify({transcript:secret,reference_date:'2026-10-12'})});
    assert.equal(response.status,500);const data=await response.json();assert.match(data.request_id,/^[a-f0-9-]{36}$/);assert.equal(response.headers.get('x-request-id'),data.request_id);
    assert.equal(events.find(e=>e.request_id===data.request_id)?.route,'runs');assert.ok(!JSON.stringify(events).includes(secret));
    await fetch(base+`/api/unknown/${secret}?email=${secret}`);assert.equal(events.at(-1).route,'api.unknown');assert.ok(!JSON.stringify(events).includes(secret));
  });
});

test('Telemetry details are capped while counters and latency histograms remain complete',()=>{
  const events=[];let time=0;const telemetry=createTelemetry({enabled:true,write:e=>events.push(e),now:()=>time});
  for(let i=0;i<205;i++)telemetry.observe({id:randomUUID(),route:'/api/runs/'+('a'.repeat(32))+'/history.json?private=text',method:'GET',status:503,duration:125,code:'secret'});
  assert.equal(events.length,200);assert.ok(events.every(e=>e.route==='runs.item.history.json'&&e.code==='request.failed'));
  assert.equal(telemetry.snapshot().requests,205);assert.equal(telemetry.snapshot().suppressed_failure_logs,5);assert.equal(telemetry.snapshot().duration_histogram.counts.reduce((a,b)=>a+b),205);
  time=60_001;telemetry.observe({id:randomUUID(),route:'/api/unknown',method:'PRIVATE',status:500,duration:1});assert.equal(events.length,201);assert.equal(events.at(-1).method,'OTHER');
  assert.equal(routeName('/file-with-private-name.pdf'),'web');
});

test('Limits expire predictably, credentials are hashed, and the production worker budget is explicit',()=>{
  let time=0;const allow=rateLimiter({limit:1,capacity:1,windowMs:100,now:()=>time});assert.ok(allow('one'));assert.equal(allow('one'),false);assert.equal(allow('two'),false);time=101;assert.ok(allow('two'));
  assert.match(credentialKey('private-token'),/^[a-f0-9]{64}$/);
  const env={NODE_ENV:'production',PUBLIC_ORIGIN:'https://flow.example',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SUPABASE_SECRET_KEY:'sb_secret_fixture',FLOW_DATABASE_URL:'postgresql://localhost/flow'};
  assert.equal(loadConfig(env).maxWorkers,1);assert.equal(loadConfig(env).telemetry,true);
  for(const value of ['0','5','two'])assert.throws(()=>loadConfig({...env,FLOW_MAX_WORKERS:value}));
});

test('Worker stdout failures and stderr cannot leak private exception text',async()=>{
  const folder=await mkdtemp(path.join(tmpdir(),'flow-private-errors-')),original=process.env.PYTHON_BIN,secret='private-'+randomUUID(),wrapper=path.join(folder,'python-fixture.sh');
  const originalError=console.error,logs=[];console.error=(...args)=>logs.push(args);
  try{
    await writeFile(wrapper,`#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({ok:false,status:500,error:secret,code:'runtime.dependencies'})}'\nprintf '%s\\n' '${secret}' >&2\n`,{mode:0o700});process.env.PYTHON_BIN=wrapper;
    await assert.rejects(engine({operation:'health'}),error=>error.status===500&&error.code==='runtime.dependencies'&&!error.message.includes(secret));assert.deepEqual(logs,[]);
  }finally{console.error=originalError;if(original)process.env.PYTHON_BIN=original;else delete process.env.PYTHON_BIN;await rm(folder,{recursive:true,force:true});}
});
