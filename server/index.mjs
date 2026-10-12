import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {loadConfig} from './config.mjs';
import {accountVerifier,rateLimiter,UUID} from './auth.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIST = path.join(ROOT, 'dist');
const MAX_BODY = 1_000_000;
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
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
    let output = '', diagnostics = '', settled = false;
    const finish = (error, data) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      error ? reject(error) : resolve(data);
    };
    const timer = setTimeout(() => {
      worker.kill('SIGKILL'); finish(new HttpError(504, 'The extraction engine timed out. Try a shorter transcript.'));
    }, timeout);
    worker.on('error', () => finish(new HttpError(503, 'Python could not start. Install requirements.txt and configure PYTHON_BIN.')));
    worker.stdin.on('error', () => {}); // close/error is reported by the worker lifecycle
    worker.stdout.on('data', chunk => {
      output += chunk;
      if (Buffer.byteLength(output) > 8_000_000) {
        worker.kill('SIGKILL'); finish(new HttpError(502, 'Engine response exceeded the size limit.'));
      }
    });
    worker.stderr.on('data', chunk => { if (diagnostics.length < 4000) diagnostics += chunk; });
    worker.on('close', code => {
      if (settled) return;
      try {
        const response = JSON.parse(output);
        if (!response.ok) {
          if (response.status >= 500) console.error(diagnostics);
          finish(new HttpError(response.status || 500, response.error));
        } else if (code !== 0) throw new Error('Worker exited unexpectedly');
        else finish(null, response.data);
      } catch {
        console.error(diagnostics || 'Invalid Python worker response');
        finish(new HttpError(502, 'The extraction engine returned an invalid response. Check Python dependencies.'));
      }
    });
    worker.stdin.end(JSON.stringify(request));
  });
}
function json(res, status, data) {
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
export function createApp({historyPath, maxWorkers = 2, config=loadConfig(), verifyAccount=accountVerifier(config)} = {}) {
  historyPath ||= config.historyPath;
  let workers = 0;
  const waiting=[];
  const acquire=()=>{
    if(workers<maxWorkers){workers++;return Promise.resolve();}
    if(waiting.length>=10)throw new HttpError(503,'The engine is busy. Please try again shortly.');
    return new Promise((resolve,reject)=>{
      const wake=()=>{clearTimeout(timer);workers++;resolve();};
      const timer=setTimeout(()=>{const i=waiting.indexOf(wake);if(i>=0)waiting.splice(i,1);reject(new HttpError(503,'The engine is busy. Please try again shortly.'));},15_000);
      waiting.push(wake);
    });
  };
  const allow=rateLimiter(),allowAnalysis=rateLimiter({limit:10}),allowAuth=rateLimiter({limit:120});
  let healthPromise=null,healthUntil=0;
  const runWorker = async (request,accountId) => {
    await acquire();
    const scopedPath=accountId && !config.databaseUrl ? path.join(historyPath+'.accounts',accountId+'.sqlite3') : historyPath;
    try { return await engine(request, {historyPath:scopedPath,databaseUrl:config.databaseUrl,accountId}); } finally { workers--;waiting.shift()?.(); }
  };
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ${config.authMode==='supabase'?new URL(config.supabaseUrl).origin:''}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`);
    if(config.production)res.setHeader('Strict-Transport-Security','max-age=31536000');
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      // Browser writes must originate from this app. No permissive CORS.
      if (req.method === 'POST' && req.headers.origin) {
        let origin;try{origin=new URL(req.headers.origin);}catch{throw new HttpError(403,'Invalid request origin.');}
        const expected=config.publicOrigin || `http://${req.headers.host}`;
        const localDev=config.authMode==='local' && ['127.0.0.1','localhost'].includes(origin.hostname) && origin.hostname===new URL(expected).hostname && origin.port==='5173';
        if(origin.origin!==expected && !localDev)throw new HttpError(403,'Origin does not match this app.');
      }
      if(req.method==='GET' && pathname==='/api/auth-config')return json(res,200,{mode:config.authMode,url:config.supabaseUrl,key:config.supabaseKey,emailEnabled:config.emailEnabled});
      if(req.method==='GET' && pathname==='/api/health') {
        if(!healthPromise || Date.now()>healthUntil){healthUntil=Date.now()+10_000;healthPromise=runWorker({operation:'health'},config.databaseUrl?'00000000-0000-0000-0000-000000000000':null).then(()=>({status:'ready'})).catch(e=>{healthPromise=null;throw e;});}
        return json(res,200,await healthPromise);
      }
      let accountId=null;
      if(pathname.startsWith('/api/') && config.authMode==='supabase') {
        if(!allowAuth(req.socket.remoteAddress || 'unknown'))throw new HttpError(429,'Too many requests. Try again in a minute.');
        const token=req.headers.authorization?.match(/^Bearer ([^\s]{1,8192})$/)?.[1];
        if(!token)throw new HttpError(401,'Sign in to use your workspace.');
        try{accountId=await verifyAccount(token);}catch{throw new HttpError(503,'Authentication is temporarily unavailable.');}
        if(!UUID.test(accountId || ''))throw new HttpError(401,'Your session has expired. Sign in again.');
        if(!allow(accountId))throw new HttpError(429,'Too many requests. Try again in a minute.');
        if(req.method==='POST' && pathname==='/api/runs' && !allowAnalysis(accountId))throw new HttpError(429,'Analysis limit reached. Try again in a minute.');
      }
      const call=request=>runWorker(request,accountId);
      let match;
      if (req.method === 'GET' && pathname === '/api/config') return json(res, 200, await call({operation:'config'}));
      if (req.method === 'GET' && pathname === '/api/runs') return json(res, 200, await call({operation:'runs'}));
      if (req.method === 'POST' && pathname === '/api/runs') {
        const input = await body(req);
        return json(res, 201, await call({transcript:input.transcript,reference_date:input.reference_date,clusters:input.clusters ?? 3,operation:'analyze'}));
      }
      if ((match = pathname.match(/^\/api\/runs\/([a-f0-9]{32})(?:\/(finalize|draft|manual-actions|history.json|tasks.csv))?$/))) {
        const [, run_id, action] = match;
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
      if (!info?.isFile()) throw new HttpError(503, 'Build the React app first with pnpm build, or use pnpm dev.');
      res.writeHead(200, {'Content-Type':TYPES[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-cache'});
      if (req.method === 'HEAD') return res.end();
      createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, {error: error.status ? error.message : 'Unexpected server error.'});
      else res.destroy();
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config=loadConfig(),{port,host}=config;
  const server = createApp({config});
  server.on('error', error => { console.error(`Server could not start: ${error.message}`); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`Productivity Flow Engine listening on ${host}:${port}`));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
