import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
export function engine(request, {historyPath, timeout = 60_000} = {}) {
  return new Promise((resolve, reject) => {
    const worker = spawn(pythonBinary(), ['-B', path.join(ROOT, 'web_bridge.py')], {
      cwd: ROOT, env: {...process.env, ...(historyPath ? {FLOW_HISTORY_PATH:historyPath} : {}),
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
export function createApp({historyPath, maxWorkers = 4} = {}) {
  let workers = 0;
  const call = async request => {
    if (workers >= maxWorkers) throw new HttpError(503, 'The engine is busy. Please try again shortly.');
    workers++;
    try { return await engine(request, {historyPath}); } finally { workers--; }
  };
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      // Browser writes must originate from this app. No permissive CORS.
      if (req.method === 'POST' && req.headers.origin) {
        const origin = new URL(req.headers.origin);
        if (!['127.0.0.1','localhost'].includes(origin.hostname) || !['http:','https:'].includes(origin.protocol))
          throw new HttpError(403, 'Use the local app to save changes.');
        const host = req.headers.host?.split(':')[0];
        if (origin.hostname !== host) throw new HttpError(403, 'Origin does not match this app.');
      }
      let match;
      if (req.method === 'GET' && pathname === '/api/health') return json(res, 200, await call({operation:'health'}));
      if (req.method === 'GET' && pathname === '/api/config') return json(res, 200, await call({operation:'config'}));
      if (req.method === 'GET' && pathname === '/api/runs') return json(res, 200, await call({operation:'runs'}));
      if (req.method === 'POST' && pathname === '/api/runs') {
        const input = await body(req);
        return json(res, 201, await call({transcript:input.transcript,reference_date:input.reference_date,clusters:input.clusters ?? 3,operation:'analyze'}));
      }
      if ((match = pathname.match(/^\/api\/runs\/([a-f0-9]{32})(?:\/(finalize|draft|history.json|tasks.csv))?$/))) {
        const [, run_id, action] = match;
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
      if (pathname === '/api/annotations/freeze' && req.method === 'POST') return json(res,200,await call({...await body(req),operation:'annotation_freeze'}));
      if ((match=pathname.match(/^\/api\/annotations\/([a-f0-9]{32})(?:\/(submit|export))?$/))) {
        const [,case_id,action]=match;
        if(req.method==='GET') return json(res,200,await call(action==='export'?{operation:'annotation_export',snapshot:case_id}:{operation:'annotation_get',case_id}));
        if(req.method==='POST' && action==='submit') return json(res,200,await call({...await body(req),operation:'annotation_submit',case_id}));
      }
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
  const port = Number(process.env.PORT || 3001);
  const server = createApp();
  server.on('error', error => { console.error(`Server could not start: ${error.message}`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Productivity Flow Engine → http://127.0.0.1:${port}`));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
