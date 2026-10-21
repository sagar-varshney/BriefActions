import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {checkConfig,checkLive} from '../scripts/check_deployment.mjs';
import {createApp} from '../server/index.mjs';
import {loadConfig} from '../server/config.mjs';

const env={NODE_ENV:'production',FLOW_TELEMETRY:'false',RENDER:'true',RENDER_EXTERNAL_URL:'https://briefactions.onrender.com',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SUPABASE_SECRET_KEY:'sb_secret_private_fixture',FLOW_DATABASE_URL:'postgresql://user:database_private_fixture@127.0.0.1/flow?sslmode=require'};
const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Strict-Transport-Security':'max-age=31536000','Content-Security-Policy':"default-src 'self'; frame-ancestors 'none'"};
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
function fixture(url,options){
 const route=new URL(url).pathname;
 assert.equal(options.redirect,'manual');assert.equal(options.headers?.Authorization,undefined);
 if(options.method==='POST')return Promise.resolve(response({error:'Rejected'},options.headers.Origin==='https://briefactions.invalid'?403:401));
 if(route==='/api/live')return Promise.resolve(response({status:'alive'}));
 if(route==='/api/health')return Promise.resolve(response({status:'ready'}));
 if(route==='/api/auth-config')return Promise.resolve(response({mode:'supabase',url:env.SUPABASE_URL,key:env.SUPABASE_PUBLISHABLE_KEY,emailEnabled:false}));
 if(route.startsWith('/api/'))return Promise.resolve(response({error:'Sign in'},401));
 return Promise.resolve(new Response('<html><div id="root"></div></html>',{headers:{...headers,'Content-Type':'text/html','Cache-Control':'no-cache'}}));
}
test('Deployment config rejects missing/example values and never emits secrets',()=>{
 assert.equal(checkConfig(env).ok,true);
 for(const change of [{NODE_ENV:'development'},{SUPABASE_SECRET_KEY:''},{SUPABASE_SECRET_KEY:'sb_secret_replace_me'},{FLOW_DATABASE_URL:'postgresql://remote/flow'},{RENDER_EXTERNAL_URL:'https://your-app.onrender.com'},{HOST:'127.0.0.1'}])assert.equal(checkConfig({...env,...change}).ok,false);
 const result=JSON.stringify(checkConfig(env));for(const value of [env.SUPABASE_SECRET_KEY,env.FLOW_DATABASE_URL])assert.ok(!result.includes(value));
 const cli=spawnSync(process.execPath,['scripts/check_deployment.mjs','config'],{env:{...process.env,...env},encoding:'utf8'});assert.equal(cli.status,0,cli.stderr);assert.ok(cli.stdout.includes('Structure only'));assert.ok(!cli.stdout.includes('private_fixture'));
 const invalid=spawnSync(process.execPath,['scripts/check_deployment.mjs','config'],{env:{...process.env,...env,SUPABASE_SECRET_KEY:''},encoding:'utf8'});assert.equal(invalid.status,1);assert.ok(!invalid.stdout.includes('database_private_fixture'));
});
test('Live checks cover served pages, readiness, private gates and origins with no credentials',async()=>{
 const report=await checkLive('https://briefactions.onrender.com/',{fetchImpl:fixture});assert.equal(report.ok,true);assert.equal(report.checks.length,11);assert.ok(report.scope.includes('Real sign-in'));
});
test('Live checks fail on redirects, local mode, exposed private routes and leaked config fields',async()=>{
 for(const bad of ['redirect','local','private','secret','header','origin']){
  const fetchImpl=async(url,options)=>{
   const route=new URL(url).pathname;
   if(bad==='redirect'&&route==='/sign-in')return new Response('redirect',{status:302,headers:{Location:'https://unexpected.example'}});
   if(bad==='local'&&route==='/api/auth-config')return response({mode:'local',url:'',key:'',emailEnabled:false});
   if(bad==='secret'&&route==='/api/auth-config')return response({mode:'supabase',url:env.SUPABASE_URL,key:env.SUPABASE_PUBLISHABLE_KEY,emailEnabled:false,secret:env.SUPABASE_SECRET_KEY});
   if(bad==='private'&&route==='/api/runs'&&!options.method)return response({transcript:'private meeting fixture'});
   if(bad==='header'&&route==='/api/health')return new Response('{"status":"ready"}',{headers:{'Content-Type':'application/json'}});
   if(bad==='origin'&&options.method==='POST'&&options.headers.Origin!=='https://briefactions.invalid')return response({error:'Origin mismatch'},403);
   return fixture(url,options);
  };
  const report=await checkLive(env.RENDER_EXTERNAL_URL,{fetchImpl});assert.equal(report.ok,false,bad);assert.ok(!JSON.stringify(report).includes('private meeting fixture'));assert.ok(!JSON.stringify(report).includes(env.SUPABASE_SECRET_KEY));
 }
});
test('Live checks reject unsafe inputs before requests and handle bounded response failures',async()=>{
 let calls=0;for(const url of ['http://example.com','https://user:secret@example.com','https://example.com/path','https://example.com?key=secret','https://example.com/#token'])await assert.rejects(checkLive(url,{fetchImpl:()=>{calls++;}}));assert.equal(calls,0);
 const oversized=await checkLive(env.RENDER_EXTERNAL_URL,{fetchImpl:async()=>new Response('x'.repeat(70_000))});assert.equal(oversized.ok,false);assert.ok(oversized.checks.every(c=>!c.ok));
 let aborted=0;const timeout=await checkLive(env.RENDER_EXTERNAL_URL,{timeoutMs:5,fetchImpl:async(_url,{signal})=>new Promise((resolve,reject)=>{const timer=setTimeout(resolve,100);signal.addEventListener('abort',()=>{aborted++;clearTimeout(timer);reject(new Error('private diagnostic'));},{once:true});})});assert.equal(aborted,11);assert.equal(timeout.ok,false);assert.ok(!JSON.stringify(timeout).includes('private diagnostic'));
 let elapsed=0;const bounded=await checkLive(env.RENDER_EXTERNAL_URL,{budgetMs:1,now:()=>elapsed+=2,fetchImpl:()=>{throw new Error('Request must not run after budget');}});assert.equal(bounded.ok,false);assert.ok(bounded.checks.every(c=>c.detail==='Overall verification time limit reached.'));
});
test('Deployment probe verifies actual server gates and detects the wrong configured origin',async()=>{
 for(const mismatch of [false,true]){
  const config=loadConfig({...env,PUBLIC_ORIGIN:mismatch?'https://another-domain.example':''}),server=createApp({config,checkHealth:async()=>{}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  // API tests run before the React build in CI. Supply static shell fixtures;
  // every API probe still reaches the actual server, including origin guards.
  // The browser/container jobs verify real built pages separately.
  try{const local=`http://127.0.0.1:${server.address().port}`,report=await checkLive(env.RENDER_EXTERNAL_URL,{fetchImpl:(url,options)=>new URL(url).pathname.startsWith('/api/')?fetch(local+new URL(url).pathname,options):fixture(url,options)});assert.equal(report.ok,!mismatch,JSON.stringify(report.checks.filter(c=>!c.ok)));if(mismatch)assert.equal(report.checks.find(c=>c.name==='configured app origin').ok,false);}
  finally{server.closeAllConnections();await server.shutdown();}
 }
});
