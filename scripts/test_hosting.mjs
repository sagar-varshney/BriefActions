// Resource-profile drill. Uses a disposable Postgres test server and generated
// HTTPS auth fixtures; never reads a live user's access token or transcript.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer as httpsServer} from 'node:https';
import {createServer as tcpServer} from 'node:net';
import {mkdtemp,readFile,writeFile,mkdir,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';

const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1];
const image=args.includes('--image')?option('--image'):'flow-ci';
const output=args.includes('--output')?path.resolve(option('--output')):path.resolve('artifacts/hosting-load.json');
if(!process.env.FLOW_TEST_DATABASE_URL)throw new Error('Set FLOW_TEST_DATABASE_URL to a disposable test database.');
if(!['127.0.0.1','localhost','[::1]'].includes(new URL(process.env.FLOW_TEST_DATABASE_URL).hostname))throw new Error('The hosting drill requires a local disposable Postgres test server.');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function command(executable,argv,{ignore=false,captureStderr=false}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,argv,{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
    child.stdout.on('data',part=>{stdout+=part;});child.stderr.on('data',part=>{if(captureStderr || stderr.length<4000)stderr+=part;});
    child.on('error',reject);child.on('close',code=>code===0||ignore?resolve(stdout+(captureStderr?stderr:'')):reject(new Error(`${executable} failed (exit ${code}). ${stderr}`)));
  });
}
async function unusedPort(){const server=tcpServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
const folder=await mkdtemp(path.join(tmpdir(),'flow-hosting-drill-')),name='flow-hosting-'+randomUUID().slice(0,8);
const users=Array.from({length:2},()=>({id:randomUUID(),token:'fixture-'+randomBytes(24).toString('hex')}));
let provider,monitoring=false,liveMonitor,readyMonitor;const report={profile:{memory_bytes:512*1024**2,cpu:0.1,workers:1},completed:0,retries:0,initial_burst_statuses:{},health:{liveness:[],readiness:[]}};
let failure;
try{
  const cert=path.join(folder,'ca.pem'),key=path.join(folder,'key.pem');
  await command('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-keyout',key,'-out',cert]);
  await chmod(cert,0o644);
  const certificate=await readFile(cert);
  provider=httpsServer({key:await readFile(key),cert:certificate},(req,res)=>{
    const user=users.find(u=>req.headers.authorization===`Bearer ${u.token}`);
    const valid=req.url==='/auth/v1/user'&&!!user;
    res.writeHead(valid?200:401,{'Content-Type':'application/json'});
    res.end(JSON.stringify(valid?{id:user.id,is_anonymous:false,aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}}:{message:'Invalid test credential'}));
  });
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  const port=await unusedPort(),base=`http://127.0.0.1:${port}`;
  const env={NODE_ENV:'production',HOST:'0.0.0.0',PORT:String(port),PUBLIC_ORIGIN:'https://flow.example',SUPABASE_URL:`https://127.0.0.1:${provider.address().port}`,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SUPABASE_SECRET_KEY:'sb_secret_fixture',FLOW_DATABASE_URL:process.env.FLOW_TEST_DATABASE_URL,FLOW_MAX_WORKERS:'1',FLOW_TELEMETRY:'true',NODE_EXTRA_CA_CERTS:'/tmp/flow-fixture-ca.pem'};
  assert.ok(Object.values(env).every(value=>!/[\r\n]/.test(value)),'Test configuration must contain single-line values');
  const envFile=path.join(folder,'container.env');await writeFile(envFile,Object.entries(env).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
  const started=performance.now();
  await command('docker',['run','--detach','--name',name,'--network','host','--memory','512m','--memory-swap','512m','--cpus','0.1','--env-file',envFile,'--mount',`type=bind,source=${cert},target=/tmp/flow-fixture-ca.pem,readonly`,image]);
  const deadline=Date.now()+120_000;
  while(true){
    if(Date.now()>deadline)throw new Error('Container readiness did not complete within 120 seconds.');
    try{const response=await fetch(base+'/api/health',{signal:AbortSignal.timeout(Math.max(1,Math.min(90_000,deadline-Date.now())))});if(response.ok)break;}catch{}
    if(Date.now()>deadline)throw new Error('Container readiness did not complete within 120 seconds.');
    await pause(500);
  }
  report.startup_ms=Math.round(performance.now()-started);
  assert.equal((await fetch(base+'/api/runs')).status,401);
  monitoring=true;
  async function monitor(route,target,timeout,interval){
    while(monitoring){
      const start=performance.now();let status;
      try{status=(await fetch(base+route,{signal:AbortSignal.timeout(timeout)})).status;}catch{status=0;}
      target.push({status,duration_ms:Math.round(performance.now()-start)});await pause(interval);
    }
  }
  liveMonitor=monitor('/api/live',report.health.liveness,2000,400);
  readyMonitor=monitor('/api/health',report.health.readiness,5000,5000);
  const items=Array.from({length:5},(_,index)=>({user:users[index%2],input:{request_id:randomUUID().replaceAll('-',''),transcript:'Maya will send the report tomorrow.\nJon will review the invoice by Friday.'+(index===4?'\n'+('Background discussion covered the previous quarter and general agenda.\n'.repeat(250)):''),reference_date:'2026-10-12',clusters:2},index}));
  const post=item=>fetch(base+'/api/runs',{method:'POST',headers:{Authorization:`Bearer ${item.user.token}`,Origin:'https://flow.example','Content-Type':'application/json'},body:JSON.stringify(item.input),signal:AbortSignal.timeout(90_000)});
  function grounded(run,item){
    assert.equal(run.id,item.input.request_id);assert.equal(run.transcript,item.input.transcript);assert.equal(run.proposals.length,2);
    assert.ok(run.proposals.some(p=>p.owner==='Maya'&&p.deadline==='2026-10-13'));
    for(const proposal of run.proposals)for(const passage of proposal.evidence)assert.equal(Array.from(run.transcript).slice(passage.start,passage.end).join(''),passage.text);
  }
  const timings=[];
  const results=await Promise.all(items.map(async item=>{
    const start=performance.now(),response=await post(item);report.initial_burst_statuses[response.status]=(report.initial_burst_statuses[response.status]||0)+1;
    assert.ok([201,503].includes(response.status),`Unexpected burst response: ${response.status}`);
    if(response.status===201){grounded(await response.json(),item);report.completed++;timings.push(performance.now()-start);return null;}
    assert.equal(response.headers.get('retry-after'),'2');const data=await response.json();assert.equal(data.request_id,response.headers.get('x-request-id'));return item;
  }));
  for(const item of results.filter(Boolean)){
    const start=performance.now(),response=await post(item);assert.equal(response.status,201);grounded(await response.json(),item);report.completed++;report.retries++;timings.push(performance.now()-start);
  }
  // A repeated request must reuse the completed run, even after the initial burst.
  const repeat=await post(items[0]);assert.equal(repeat.status,201);grounded(await repeat.json(),items[0]);
  for(const [index,user] of users.entries()){
    const list=await (await fetch(base+'/api/runs',{headers:{Authorization:`Bearer ${user.token}`}})).json();assert.equal(list.length,items.filter(item=>item.user===user).length);
    const foreign=items.find(item=>item.user!==user);assert.equal((await fetch(base+`/api/runs/${foreign.input.request_id}`,{headers:{Authorization:`Bearer ${user.token}`}})).status,404);
  }
  monitoring=false;await Promise.all([liveMonitor,readyMonitor]);
  const memory=await command('docker',['exec',name,'node','--input-type=module','-e',"import{readFile}from'node:fs/promises';const r={};for(const f of ['memory.peak','memory.max','memory.events','cpu.max'])r[f]=(await readFile('/sys/fs/cgroup/'+f,'utf8')).trim();console.log(JSON.stringify(r));"]);
  const values=JSON.parse(memory);report.container_peak_memory_bytes=Number(values['memory.peak']);assert.equal(Number(values['memory.max']),report.profile.memory_bytes);assert.equal(Number(values['memory.events'].match(/^oom_kill (\d+)$/m)?.[1]),0);
  const [quota,period]=values['cpu.max'].split(' ').map(Number);report.container_cpu_limit=quota/period;assert.equal(report.container_cpu_limit,report.profile.cpu);
  const state=JSON.parse(await command('docker',['inspect',name,'--format','{{json .State}}']));assert.equal(state.Running,true);assert.equal(state.OOMKilled,false);
  report.oom_killed=state.OOMKilled;
  assert.ok(report.container_peak_memory_bytes<=report.profile.memory_bytes);
  for(const [kind,samples] of Object.entries(report.health)){assert.ok(samples.length>0);assert.ok(samples.every(sample=>sample.status===200),`${kind} failed under analysis load`);}
  timings.sort((a,b)=>a-b);report.analysis_ms={p50:Math.round(timings[Math.floor((timings.length-1)*.5)]),p95:Math.round(timings[Math.ceil((timings.length-1)*.95)]),maximum:Math.round(timings.at(-1))};
  report.duration_ms=Math.round(performance.now()-started);report.status='passed';
  console.log('Hosting profile passed: 512 MiB / 0.1 CPU, bounded burst/retries, exact evidence, account isolation, duplicate prevention, responsive liveness/readiness, and no OOM kill.');
}catch(error){failure=error;report.status='failed';report.failure=error.message;}
finally{
  monitoring=false;await Promise.allSettled([liveMonitor,readyMonitor]);
  await mkdir(path.dirname(output),{recursive:true});
  const logs=await command('docker',['logs',name],{ignore:true,captureStderr:true}).catch(()=> '');
  const privateValues=[...users.map(user=>user.token),process.env.FLOW_TEST_DATABASE_URL,'Maya will send the report tomorrow.'];
  if(privateValues.some(value=>logs.includes(value))){failure=new Error('Private fixture data entered container logs.');report.status='failed';report.failure=failure.message;}
  await writeFile(output,JSON.stringify(report,null,2)+'\n');
  await writeFile(path.join(path.dirname(output),'hosting-container.log'),privateValues.some(value=>logs.includes(value))?'Private fixture log content suppressed.\n':logs);
  await command('docker',['rm','--force',name],{ignore:true}).catch(()=>{});
  if(provider){provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));}
  await rm(folder,{recursive:true,force:true});
}
if(failure)throw failure;
