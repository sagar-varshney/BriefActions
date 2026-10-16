import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {loadConfig} from './config.mjs';
import {accountVerifier,accountDeleter,rateLimiter,credentialKey,UUID} from './auth.mjs';
import {createTelemetry,requestId} from './telemetry.mjs';
import {createStorageProbe} from './readiness.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIST = path.join(ROOT, 'dist');
const MAX_BODY = 1_000_000;
export class HttpError extends Error {
  constructor(status, message, code='request.failed', retryAfter=null) { super(message); this.status = status; this.code=code; this.retryAfter=retryAfter; }
}
export function pythonBinary() {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
  const local = path.join(ROOT, '.venv', 'bin', 'python3');
  return existsSync(local) ? local : 'python3';
}
export function engine(request, {historyPath, databaseUrl, accountId, timeout = 60_000} = {}) {
  return new Promise((resolve, reject) => {
    const worker = spawn(pythonBinary(), ['-B', path.join(ROOT, 'web_bridge.py')], {
      cwd: ROOT, env: {...process.env, FLOW_ACCOUNT_ID:accountId || '', FLOW_DATABASE_URL:databaseUrl || '', ...(historyPath ? {FLOW_HISTORY_PATH:historyPath} : {}),
        PYTHONIOENCODING:'utf-8', LOKY_MAX_CPU_COUNT:'2'}, stdio:['pipe','pipe','pipe'],
    });
    let output = '', settled = false;
    const finish = (error, data) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      error ? reject(error) : resolve(data);
    };
    const timer = setTimeout(() => {
      worker.kill('SIGKILL'); finish(new HttpError(504, 'The analysis took too long. Try a shorter transcript.', 'worker.timeout'));
    }, timeout);
    worker.on('error', () => finish(new HttpError(503, 'Analysis is temporarily unavailable. Please try again later.', 'worker.unavailable')));
    worker.stdin.on('error', () => {}); // close/error is reported by the worker lifecycle
    worker.stdout.on('data', chunk => {
      output += chunk;
      if (Buffer.byteLength(output) > 8_000_000) {
        worker.kill('SIGKILL'); finish(new HttpError(502, 'The result is too large to return. Try a shorter transcript.', 'worker.output_limit'));
      }
    });
    // Drain stderr without retaining or logging potential private exception text.
    worker.stderr.resume();
    worker.on('close', code => {
      if (settled) return;
      try {
        const response = JSON.parse(output);
        if (!response.ok) {
          const code=['runtime.dependencies','storage.failed'].includes(response.code)?response.code:'worker.failed';
          finish(new HttpError(response.status || 500, response.status>=500?'Your request could not be completed. Please try again.':response.error, code));
        } else if (code !== 0) throw new Error('Worker exited unexpectedly');
        else finish(null, response.data);
      } catch {
        finish(new HttpError(502, 'Analysis is temporarily unavailable. Please try again later.', 'worker.invalid_response'));
      }
    });
    worker.stdin.end(JSON.stringify(request));
  });
}
function json(res, status, data) {
  if(res.destroyed || res.writableEnded)return;
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'});
  res.end(JSON.stringify(data));
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'Use application/json.');
  let size = 0, chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request is too large.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch { throw new HttpError(400, 'Request must be a JSON object.'); }
}
const TYPES = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon'};
export function createApp({historyPath, config=loadConfig(), maxWorkers=config.maxWorkers ?? 2, verifyAccount=accountVerifier(config), deleteAccount=accountDeleter(config), execute=engine, checkHealth=null, telemetry=createTelemetry({enabled:config.telemetry}), queueTimeout=15_000, healthTtl=10_000, healthNow=()=>Date.now(), maxAuthChecks=8} = {}) {
  historyPath ||= config.historyPath;
  if(!Number.isInteger(maxWorkers)||maxWorkers<1||maxWorkers>4)throw new Error('Invalid worker limit.');
  if(!Number.isInteger(maxAuthChecks)||maxAuthChecks<1||maxAuthChecks>32)throw new Error('Invalid authentication concurrency limit.');
  let authChecks=0;
  const runtime=()=>({active_workers:workers,queued_requests:waiting.length,auth_checks:authChecks,worker_limit:maxWorkers});
  let workers = 0;
  const waiting=[];
  const acquire=()=>{
    if(workers<maxWorkers){workers++;return Promise.resolve();}
    if(waiting.length>=10)throw new HttpError(503,'The engine is busy. Please try again shortly.','engine.busy',2);
    return new Promise((resolve,reject)=>{
      const wake=()=>{clearTimeout(timer);workers++;resolve();};
      const timer=setTimeout(()=>{const i=waiting.indexOf(wake);if(i>=0)waiting.splice(i,1);reject(new HttpError(503,'The engine is busy. Please try again shortly.','engine.busy',2));},queueTimeout);
      waiting.push(wake);
    });
  };
  const allow=rateLimiter(),allowAnalysis=rateLimiter({limit:10}),allowAuth=rateLimiter({limit:120});
  let healthPromise=null,healthUntil=0,deepChecked=false;
  const storageProbe=createStorageProbe({python:pythonBinary,historyPath,databaseUrl:config.databaseUrl});
  const workerOptions=accountId=>({historyPath:accountId && !config.databaseUrl ? path.join(historyPath+'.accounts',accountId+'.sqlite3') : historyPath,databaseUrl:config.databaseUrl,accountId});
  const runWorker = async (request,accountId) => {
    await acquire();
    try { return await execute(request, workerOptions(accountId)); } finally { workers--;waiting.shift()?.(); }
  };
  async function exportWorkspace(res,accountId){
    await acquire();
    const options=workerOptions(accountId);
    try{
      await new Promise((resolve,reject)=>{
        const worker=spawn(pythonBinary(),['-B',path.join(ROOT,'export_bridge.py')],{cwd:ROOT,env:{...process.env,FLOW_HISTORY_PATH:options.historyPath,FLOW_DATABASE_URL:options.databaseUrl || '',FLOW_ACCOUNT_ID:accountId || '',PYTHONIOENCODING:'utf-8'},stdio:['ignore','pipe','ignore']});
        let size=0,finished=false;
        const timer=setTimeout(()=>worker.kill('SIGKILL'),60_000);
        const disconnected=()=>{if(!finished)worker.kill('SIGKILL');};res.once('close',disconnected);
        worker.stdout.on('data',chunk=>{
          size+=chunk.length;
          if(size>75_000_000){worker.kill('SIGKILL');return;}
          if(!res.headersSent)res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Content-Disposition':'attachment; filename="flow-workspace.jsonl"','Cache-Control':'no-store'});
          if(!res.write(chunk))worker.stdout.pause();
        });
        res.on('drain',()=>worker.stdout.resume());
        const complete=(error)=>{if(finished)return;finished=true;clearTimeout(timer);res.off('close',disconnected);error?reject(error):(res.end(),resolve());};
        worker.on('error',()=>complete(new HttpError(503,'Workspace export is temporarily unavailable.','export.failed')));
        worker.on('close',code=>complete(code===0?null:new HttpError(503,'Workspace export did not finish. Retry the download.','export.failed')));
      });
    }finally{workers--;waiting.shift()?.();}
  }
  // Closing sockets does not finish async handlers: disconnected clients can leave
  // accepted writes running. Drain them before shutdown or test storage cleanup.
  const requests=new Set();
  const server=http.createServer((req,res)=>{
    const pending=handleRequest(req,res);requests.add(pending);
    pending.then(()=>requests.delete(pending),()=>{requests.delete(pending);res.destroy();});
  });
  async function handleRequest(req,res) {
    const id=requestId(),started=performance.now();let failureCode='request.failed',recorded=false;
    res.setHeader('X-Request-ID',id);
    const record=aborted=>{if(recorded)return;recorded=true;telemetry.observe({id,route:req.url,method:req.method,status:aborted?499:res.statusCode,duration:performance.now()-started,code:aborted?'request.aborted':failureCode,aborted});};
    res.once('finish',()=>record(false));res.once('close',()=>record(!res.writableFinished));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ${config.authMode==='supabase'?new URL(config.supabaseUrl).origin:''}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`);
    if(config.production)res.setHeader('Strict-Transport-Security','max-age=31536000');
    try {
      const url = new URL(req.url, 'http://localhost'),pathname=url.pathname;
      // Browser writes must originate from this app. No permissive CORS.
      if (req.method === 'POST' && req.headers.origin) {
        let origin;try{origin=new URL(req.headers.origin);}catch{throw new HttpError(403,'Invalid request origin.');}
        const expected=config.publicOrigin || `http://${req.headers.host}`;
        const localDev=config.authMode==='local' && ['127.0.0.1','localhost'].includes(origin.hostname) && origin.hostname===new URL(expected).hostname && origin.port==='5173';
        if(origin.origin!==expected && !localDev)throw new HttpError(403,'Origin does not match this app.');
      }
      if(req.method==='GET' && pathname==='/api/auth-config')return json(res,200,{mode:config.authMode,url:config.supabaseUrl,key:config.supabaseKey,emailEnabled:config.emailEnabled});
      if(req.method==='GET' && pathname==='/api/live')return json(res,200,{status:'alive'});
      if(req.method==='GET' && pathname==='/api/health') {
        // One independent probe: busy analysis queues cannot starve host checks.
        // After the initial ML dependency check, storage probes avoid heavy imports.
        if(!healthPromise || healthNow()>healthUntil){
          healthUntil=Infinity;
          const deep=!deepChecked,options={...workerOptions(config.databaseUrl?'00000000-0000-0000-0000-000000000000':null),timeout:deep?60_000:5_000};
          healthPromise=Promise.resolve().then(async()=>{
            if(checkHealth)return checkHealth(deep,options);
            if(deep)await engine({operation:'health'},options);
            try{await storageProbe.check();}catch{throw new HttpError(503,'Workspace storage is temporarily unavailable. Please try again.','storage.failed',2);}
          }).then(()=>{deepChecked=true;healthUntil=healthNow()+healthTtl;return {status:'ready'};}).catch(e=>{healthPromise=null;throw e;});
        }
        return json(res,200,await healthPromise);
      }
      let accountId=null;
      if(pathname.startsWith('/api/') && config.authMode==='supabase') {
        const token=req.headers.authorization?.match(/^Bearer ([^\s]{1,8192})$/)?.[1];
        if(!token)throw new HttpError(401,'Sign in to use your workspace.','auth.invalid');
        // Credential hashes guard provider checks; account UUIDs guard app usage.
        // Neither socket addresses nor caller-supplied proxy headers select limits.
        if(!allowAuth(credentialKey(token)))throw new HttpError(429,'Too many sign-in checks. Try again in a minute.','auth.throttled',60);
        if(authChecks>=maxAuthChecks)throw new HttpError(503,'Sign-in verification is busy. Please try again shortly.','auth.busy',2);
        authChecks++;
        try{accountId=await verifyAccount(token);}catch{throw new HttpError(503,'Authentication is temporarily unavailable.','auth.unavailable',2);}finally{authChecks--;}
        if(!UUID.test(accountId || ''))throw new HttpError(401,'Your session has expired. Sign in again.','auth.invalid');
        if(!allow(accountId))throw new HttpError(429,'Too many requests. Try again in a minute.','account.throttled',60);
        if(req.method==='POST' && pathname==='/api/runs' && !allowAnalysis(accountId))throw new HttpError(429,'Analysis limit reached. Try again in a minute.','analysis.throttled',60);
      }
      const call=request=>runWorker(request,accountId);
      let match;
      if(req.method==='GET' && pathname==='/api/account')return json(res,200,{...await call({operation:'account_status'}),can_delete_account:!!accountId && !!deleteAccount});
      if(req.method==='GET' && pathname==='/api/account/export')return await exportWorkspace(res,accountId);
      if(req.method==='POST' && pathname==='/api/account/delete'){
        const input=await body(req);
        if(input.confirmation!=='DELETE MY ACCOUNT')throw new HttpError(400,'Type DELETE MY ACCOUNT to confirm.');
        if(!accountId || !deleteAccount)throw new HttpError(503,'Account deletion is not configured for this workspace.');
        await call({operation:'account_erase'});
        try{await deleteAccount(accountId);}catch{throw new HttpError(503,'Your workspace data was erased. Sign-in account deletion is pending; retry from Data & account.');}
        return json(res,200,{deleted:true});
      }
      if(req.method==='POST' && (match=pathname.match(/^\/api\/(runs|annotations)\/([a-f0-9]{32})\/delete$/))){
        const input=await body(req);
        if(input.confirmation!=='DELETE TRANSCRIPT')throw new HttpError(400,'Type DELETE TRANSCRIPT to confirm.');
        return json(res,200,await call({operation:'delete_input',run_id:match[2],kind:match[1]==='runs'?'extraction':'annotation_input'}));
      }
      if (req.method === 'GET' && pathname === '/api/config') return json(res, 200, await call({operation:'config'}));
      if(req.method==='GET' && pathname==='/api/tasks'){
        const keys=new Set(['today','view','status','query','page','page_size']);
        for(const key of url.searchParams.keys())if(!keys.has(key) || url.searchParams.getAll(key).length!==1)throw new HttpError(400,'Invalid task search parameter.');
        const input=Object.fromEntries(url.searchParams);
        if(!input.today)throw new HttpError(400,'A device date is required for task filters.');
        for(const key of ['page','page_size'])if(key in input){if(!/^\d{1,6}$/.test(input[key]))throw new HttpError(400,'Invalid task page or page size.');input[key]=Number(input[key]);}
        return json(res,200,await call({...input,operation:'task_search'}));
      }
      if(req.method==='GET' && pathname==='/api/runs/search'){
        const keys=new Set(['query','status','date_from','date_to','page','page_size']);
        for(const key of url.searchParams.keys())if(!keys.has(key) || url.searchParams.getAll(key).length!==1)throw new HttpError(400,'Invalid history search parameter.');
        const input=Object.fromEntries(url.searchParams);
        for(const key of ['page','page_size'])if(key in input){if(!/^\d{1,6}$/.test(input[key]))throw new HttpError(400,'Invalid history page or page size.');input[key]=Number(input[key]);}
        return json(res,200,await call({...input,operation:'meeting_search'}));
      }
      if (req.method === 'GET' && pathname === '/api/runs') return json(res, 200, await call({operation:'runs'}));
      if (req.method === 'POST' && pathname === '/api/runs') {
        const input = await body(req);
        return json(res, 201, await call({transcript:input.transcript,reference_date:input.reference_date,clusters:input.clusters ?? 3,request_id:input.request_id,title:input.title ?? '',operation:'analyze'}));
      }
      if ((match = pathname.match(/^\/api\/runs\/([a-f0-9]{32})(?:\/(finalize|draft|title|progress|manual-actions|history.json|tasks.csv))?$/))) {
        const [, run_id, action] = match;
        if(action==='progress' && req.method!=='POST')throw new HttpError(405,'Task progress requires POST.');
        if(req.method==='POST' && action==='progress'){const input=await body(req);return json(res,200,await call({operation:'task_progress',run_id,proposal_id:input.proposal_id,status:input.status,version:input.version,request_id:input.request_id}));}
        if(req.method==='POST' && action==='title'){const input=await body(req);return json(res,200,await call({operation:'meeting_title',run_id,title:input.title,version:input.version}));}
        if (req.method === 'POST' && action === 'manual-actions') {
          const input=await body(req);
          return json(res,200,await call({operation:'manual_action',run_id,item:input.item,request_id:input.request_id}));
        }
        if (req.method === 'POST' && action === 'draft') {
          const input=await body(req);
          return json(res,200,await call({operation:'draft',run_id,decisions:input.decisions,version:input.version,client_id:input.client_id,edit_id:input.edit_id}));
        }
        if (req.method === 'POST' && action === 'finalize') {
          const input = await body(req);
          return json(res, 200, await call({operation:'finalize',run_id,decisions:input.decisions}));
        }
        if (req.method === 'GET' && action === 'tasks.csv') {
          const csv = await call({operation:'csv',run_id});
          res.writeHead(200, {'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="flow-${run_id.slice(0,8)}.csv"`,'Cache-Control':'no-store'});
          return res.end(csv);
        }
        if (req.method === 'GET') {
          const run = await call({operation:'run',run_id});
          if (action === 'history.json') res.setHeader('Content-Disposition', `attachment; filename="flow-history-${run_id.slice(0,8)}.json"`);
          return json(res, 200, action ? run.events : run);
        }
      }
      if (pathname === '/api/annotations' && req.method === 'GET') return json(res,200,await call({operation:'annotation_list'}));
      if (pathname === '/api/annotations' && req.method === 'POST') return json(res,201,await call({...await body(req),operation:'annotation_create'}));
      if (pathname === '/api/annotations/corpora' && req.method === 'GET') return json(res,200,await call({operation:'annotation_corpora'}));
      if (pathname === '/api/annotations/import-corpus' && req.method === 'POST') return json(res,200,await call({...await body(req),operation:'annotation_import'}));
      if (pathname === '/api/annotations/freeze' && req.method === 'POST') return json(res,200,await call({...await body(req),operation:'annotation_freeze'}));
      if ((match=pathname.match(/^\/api\/annotations\/([a-f0-9]{32})(?:\/(submit|export|draft))?$/))) {
        const [,case_id,action]=match;
        if(action==='draft' && req.method==='GET') {
          const params=new URL(req.url,'http://localhost').searchParams;
          return json(res,200,await call({operation:'annotation_draft_get',case_id,reviewer:params.get('reviewer'),mode:params.get('mode') || 'review'}));
        }
        if(action==='draft' && req.method==='POST') return json(res,200,await call({...await body(req),operation:'annotation_draft_save',case_id}));
        if(req.method==='GET') return json(res,200,await call(action==='export'?{operation:'annotation_export',snapshot:case_id}:{operation:'annotation_get',case_id}));
        if(req.method==='POST' && action==='submit') return json(res,200,await call({...await body(req),operation:'annotation_submit',case_id}));
      }
      if(req.method==='GET' && pathname==='/api/reviewed-snapshots') return json(res,200,await call({operation:'reviewed_snapshots'}));
      if(req.method==='GET' && pathname==='/api/reviewed-benchmarks') return json(res,200,await call({operation:'reviewed_reports'}));
      if(req.method==='POST' && pathname==='/api/reviewed-benchmarks') return json(res,200,await call({...await body(req),operation:'reviewed_run'}));
      if(req.method==='GET' && (match=pathname.match(/^\/api\/reviewed-benchmarks\/([a-f0-9]{32})$/))) return json(res,200,await call({operation:'reviewed_report',report_id:match[1]}));
      if (req.method === 'GET' && pathname === '/api/benchmarks') return json(res, 200, await call({operation:'benchmarks'}));
      if (req.method === 'GET' && (match = pathname.match(/^\/api\/benchmarks\/([a-f0-9]{16})$/)))
        return json(res, 200, await call({operation:'benchmark',report_id:match[1]}));
      if (pathname.startsWith('/api/')) throw new HttpError(404, 'API route not found.');
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
      let file = path.resolve(DIST, '.' + decodeURIComponent(pathname));
      if (!file.startsWith(DIST + path.sep)) file = path.join(DIST, 'index.html');
      let info = await stat(file).catch(() => null);
      if (!info?.isFile()) {
        if (path.extname(pathname)) throw new HttpError(404, 'File not found.');
        file = path.join(DIST, 'index.html');
        info = await stat(file).catch(() => null);
      }
      if (!info?.isFile()) throw new HttpError(503, config.production?'Workspace is temporarily unavailable. Please try again.':'Build the React app first with pnpm build, or use pnpm dev.', 'web.assets_unavailable');
      res.writeHead(200, {'Content-Type':TYPES[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-cache'});
      if (req.method === 'HEAD') return res.end();
      createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch (error) {
      const expected=error instanceof HttpError;failureCode=expected?error.code:'request.failed';
      if(!res.headersSent && expected && error.retryAfter)res.setHeader('Retry-After',String(error.retryAfter));
      if (!res.headersSent) json(res, expected?error.status:500, {error: expected?error.message:'Something went wrong. Please try again.',request_id:id});
      else res.destroy();
    }
  }
  const metrics=setInterval(()=>{void telemetry.sample(runtime());},60_000);metrics.unref();
  server.once('close',()=>{clearInterval(metrics);storageProbe.stop();void telemetry.sample(runtime());});
  let shutdown;
  server.shutdown=()=>shutdown ||= (async()=>{
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    await Promise.allSettled([...requests]);
    await storageProbe.stop();
  })();
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
  const config=loadConfig(),{port,host}=config;
  const server = createApp({config});
  server.on('error', error => { console.error(JSON.stringify({event:'server_start_failed',code:['EADDRINUSE','EACCES'].includes(error.code)?error.code:'START_FAILED'})); process.exitCode = 1; });
  server.listen(port, host, () => console.log(JSON.stringify({event:'server_started',mode:config.production?'production':'local',port,worker_limit:config.maxWorkers})));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => void server.shutdown().then(()=>process.exit(0)));
  }catch{console.error(JSON.stringify({event:'server_config_failed',code:'CONFIG_INVALID'}));process.exitCode=1;}
}
