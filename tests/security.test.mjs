import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {createApp} from '../server/index.mjs';
import {loadConfig} from '../server/config.mjs';
import {publicFile} from '../server/public-files.mjs';

async function running(action){
 const calls=[];
 const config={...loadConfig(),production:true,authMode:'supabase',supabaseUrl:'https://fixture.supabase.co',supabaseKey:'sb_publishable_fixture',supabaseSecret:'sb_secret_never_public',publicOrigin:'https://flow.example'};
 const app=createApp({config,verifyAccount:async token=>token==='valid'?'11111111-1111-4111-8111-111111111111':null,execute:async request=>{calls.push(request);return [];}});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 try{await action(`http://127.0.0.1:${app.address().port}`,app,calls);}finally{app.closeAllConnections();await app.shutdown();}
}

test('Public file allowlist rejects hidden files, source maps, backups, malformed paths and escaping symlinks',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'flow-public-')),dist=path.join(folder,'dist');
 try{
  await mkdir(path.join(dist,'assets'),{recursive:true});
  await mkdir(path.join(dist,'.vite'));
  for(const filename of ['index.html','assets/app-12345678.js','.env','.vite/manifest.json','assets/app.js.map','private.sqlite3'])await writeFile(path.join(dist,filename),'fixture');
  await writeFile(path.join(folder,'outside.js'),'private');
  await symlink(path.join(folder,'outside.js'),path.join(dist,'assets','outside.js'));
  await symlink(folder,path.join(dist,'assets','nested'));
  await symlink(path.join(dist,'assets','app-12345678.js'),path.join(dist,'assets','inside.js'));
  for(const pathname of ['/.env','/%2eenv','/.vite/manifest.json','/assets/app.js.map','/private.sqlite3','/private.sql','/assets/outside.js','/assets/nested/outside.js','/../outside.js','/assets/missing.js'])assert.equal((await publicFile(dist,pathname)).status,404,pathname);
  for(const pathname of ['/bad%ZZ','/bad%00.js','/assets%5coutside.js'])assert.equal((await publicFile(dist,pathname)).status,400,pathname);
  assert.match((await publicFile(dist,'/meetings/'+('a'.repeat(32)))).filename,/index\.html$/);
  assert.match((await publicFile(dist,'/assets/app-12345678.js')).filename,/app-12345678\.js$/);
  assert.match((await publicFile(dist,'/assets/inside.js')).filename,/app-12345678\.js$/);
 }finally{await rm(folder,{recursive:true,force:true});}
});

test('Security headers and public configuration never expose privileged keys; sensitive file paths fail closed',async()=>{
 await running(async base=>{
  for(const route of ['/api/auth-config','/api/runs','/.env','/%2eenv','/.git/config','/.vite/manifest.json','/assets/app.js.map','/backup.sqlite3']){
   const response=await fetch(base+route),text=await response.text();
   assert.equal(response.status,route==='/api/auth-config'?200:route==='/api/runs'?401:404,route);
   assert.equal(response.headers.get('cache-control'),'no-store');
   assert.equal(response.headers.get('x-content-type-options'),'nosniff');
   assert.equal(response.headers.get('x-frame-options'),'DENY');
   assert.match(response.headers.get('content-security-policy'),/object-src 'none'/);
   assert.doesNotMatch(response.headers.get('content-security-policy'),/unsafe-inline|unsafe-eval|\*/);
   assert.equal(response.headers.get('permissions-policy'),'camera=(), microphone=(), geolocation=()');
   assert.equal(response.headers.get('strict-transport-security'),'max-age=31536000');
   assert.ok(!text.includes('sb_secret_never_public'));
  }
 });
});

test('Ambiguous JSON media types, compressed and oversized bodies are rejected before executing a worker',async()=>{
 await running(async(base,app,calls)=>{
  const post=(headers,body='{}')=>fetch(base+'/api/runs',{method:'POST',headers:{Authorization:'Bearer valid',...headers},body});
  for(const type of ['application/jsonp','application/json-extra','text/plain'])assert.equal((await post({'Content-Type':type})).status,415);
  assert.equal((await post({'Content-Type':'application/json','Content-Encoding':'gzip'})).status,415);
  assert.equal((await post({'Content-Type':'application/json'},'x'.repeat(1_000_001))).status,413);
  // Send a chunked body too: Content-Length cannot be the only size gate.
  const status=await new Promise((resolve,reject)=>{
   const request=http.request(base+'/api/runs',{method:'POST',headers:{Authorization:'Bearer valid','Content-Type':'application/json','Transfer-Encoding':'chunked'}},response=>{response.resume();resolve(response.statusCode);});
   request.on('error',reject);request.write('x'.repeat(600_000));request.end('x'.repeat(400_001));
  });assert.equal(status,413);
  assert.equal(calls.length,0);
  assert.equal((await post({'Content-Type':'Application/JSON; charset=utf-8'})).status,201);
  assert.equal(calls.length,1);
  assert.equal(app.headersTimeout,15_000);assert.equal(app.requestTimeout,60_000);
 });
});

test('Oversized headers cannot reach authorization or workers',async()=>{
 await running(async(base,app,calls)=>{
  const output=await new Promise((resolve,reject)=>{
   let text='';const socket=net.connect(app.address().port,'127.0.0.1',()=>socket.end('GET /api/runs HTTP/1.1\r\nHost: localhost\r\nX-Large: '+'x'.repeat(17_000)+'\r\nConnection: close\r\n\r\n'));
   socket.setTimeout(3000,()=>socket.destroy(new Error('Header rejection timed out')));
   socket.on('data',chunk=>{text+=chunk;});socket.on('error',reject);socket.on('close',()=>resolve(text));
  });assert.match(output,/^HTTP\/1\.1 431 /);assert.equal(calls.length,0);
 });
});

test('Forged origins and preflight requests cannot authorize writes',async()=>{
 await running(async(base,app,calls)=>{
  for(const origin of ['null','https://evil.example','https://flow.example.evil.test','https://flow.example@evil.test']){
   const response=await fetch(base+'/api/runs',{method:'POST',headers:{Authorization:'Bearer valid','Content-Type':'application/json',Origin:origin},body:'{}'});
   assert.equal(response.status,403);assert.equal(response.headers.get('access-control-allow-origin'),null);
  }
  const preflight=await fetch(base+'/api/runs',{method:'OPTIONS',headers:{Origin:'https://evil.example','Access-Control-Request-Method':'POST'}});
  assert.equal(preflight.headers.get('access-control-allow-origin'),null);assert.equal(calls.length,0);
 });
});
