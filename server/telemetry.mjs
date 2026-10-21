import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const BOUNDS=[50,100,250,500,1000,2500,5000,10000,30000,60000,90000];
const PHASES=new Set(['auth','queue.analysis','queue.interactive','worker.analysis','worker.interactive','storage_scope','analysis_compute']);
const ROUTES=new Map([
  ['/api/series','series.list'],
  ['/api/weekly-review','weekly.review'],
  ['/api/owners','owners.search'],['/api/today','today.overview'],
  ['/api/calendar','calendar.search'],
  ['/api/live','live'],['/api/health','readiness'],['/api/auth-config','auth.config'],
  ['/api/config','workspace.config'],['/api/account','account.status'],['/api/account/export','account.export'],['/api/account/delete','account.delete'],
  ['/api/runs','runs'],['/api/runs/search','runs.search'],['/api/tasks','tasks.search'],['/api/annotations','annotations'],['/api/annotations/corpora','annotations.corpora'],['/api/annotations/import-corpus','annotations.import'],['/api/annotations/freeze','annotations.freeze'],
  ['/api/benchmarks','benchmarks'],['/api/reviewed-snapshots','reviewed.snapshots'],['/api/reviewed-benchmarks','reviewed.reports'],
]);
const ACTIONS=new Set(['series','updates','update-draft','update-confirm','progress','deadline','title','finalize','draft','followup-draft','manual-actions','history.json','tasks.csv','delete','submit','export']);
const CODES=new Set(['request.failed','request.aborted','worker.unavailable','worker.timeout','worker.output_limit','worker.invalid_response','worker.failed','runtime.dependencies','storage.failed','engine.busy','auth.busy','auth.unavailable','auth.invalid','auth.throttled','account.throttled','analysis.throttled','export.failed','web.assets_unavailable']);
export const requestId=()=>randomUUID();
export function routeName(url){
  let pathname;try{pathname=new URL(url,'http://localhost').pathname;}catch{return 'unknown';}
  if(ROUTES.has(pathname))return ROUTES.get(pathname);
  if(/^\/api\/series\/[a-f0-9]{32}(?:\/(preparation|name|agenda|delete|agendas\/\d{1,7}))?$/.test(pathname))return 'series.item';
  const match=/^\/api\/(runs|annotations|benchmarks|reviewed-benchmarks)\/[a-f0-9]{16,32}(?:\/([^/]+))?$/.exec(pathname);
  if(match && (!match[2] || ACTIONS.has(match[2])))return `${match[1]}.item${match[2]?'.'+match[2]:''}`;
  return pathname.startsWith('/api/')?'api.unknown':'web';
}
export async function memorySnapshot(){
  const result={node_rss_bytes:process.memoryUsage.rss()};
  for(const [name,file] of [['container_memory_bytes','memory.current'],['container_memory_limit_bytes','memory.max']]){
    try{const value=(await readFile('/sys/fs/cgroup/'+file,'utf8')).trim();if(/^\d+$/.test(value))result[name]=Number(value);}catch{}
  }
  return result;
}
export function createTelemetry({enabled=false,write=value=>console.log(JSON.stringify(value)),now=()=>Date.now()}={}){
  let requests=0,failures=0,suppressed=0,detailCount=0,windowStart=now();
  const statuses={},routes={},histogram=Array(BOUNDS.length+1).fill(0),routeHistograms={},phaseHistograms={};
  function phase(route,name,duration){
    if(!PHASES.has(name)||!Number.isFinite(duration)||duration<0)return;
    const groups=phaseHistograms[routeName(route)] ||= {},counts=groups[name] ||= Array(BOUNDS.length+1).fill(0);
    const index=BOUNDS.findIndex(bound=>duration<=bound);counts[index<0?BOUNDS.length:index]++;
  }
  const emit=value=>{if(enabled){try{write(value);}catch{/* Logging must not fail a request. */}}};
  function observe({id,route,method,status,duration,code,aborted=false}){
    // Every field is generated or reduced to a fixed vocabulary. No raw URLs,
    // bodies, exception messages, credentials, addresses, or account IDs.
    const safeRoute=routeName(route),safeMethod=['GET','HEAD','POST'].includes(method)?method:'OTHER';
    const safeStatus=Number.isInteger(status)&&status>=100&&status<=599?status:500;
    const ms=Math.max(0,Number.isFinite(duration)?duration:0);
    requests++;statuses[safeStatus]=(statuses[safeStatus] || 0)+1;routes[safeRoute]=(routes[safeRoute] || 0)+1;
    const bucket=BOUNDS.findIndex(bound=>ms<=bound);histogram[bucket<0?BOUNDS.length:bucket]++;
    const routeBuckets=routeHistograms[safeRoute] ||= Array(BOUNDS.length+1).fill(0);
    routeBuckets[bucket<0?BOUNDS.length:bucket]++;
    if(safeStatus<400 && !aborted)return;
    failures++;
    if(now()-windowStart>=60_000){windowStart=now();detailCount=0;}
    if(detailCount++>=200){suppressed++;return;}
    emit({event:'request_failure',time:new Date(now()).toISOString(),request_id:/^[a-f0-9-]{36}$/.test(id)?id:requestId(),route:safeRoute,method:safeMethod,status:safeStatus,duration_ms:Math.round(ms),code:CODES.has(code)?code:'request.failed'});
  }
  function snapshot(runtime={}){
    return {event:'runtime_metrics',time:new Date(now()).toISOString(),requests,failures,suppressed_failure_logs:suppressed,statuses:{...statuses},routes:{...routes},duration_histogram:{upper_bounds_ms:BOUNDS,counts:[...histogram]},route_duration_histograms:Object.fromEntries(Object.entries(routeHistograms).map(([route,counts])=>[route,[...counts]])),phase_duration_histograms:structuredClone(phaseHistograms),...Object.fromEntries(['active_workers','queued_requests','auth_checks','worker_limit','analysis_active','interactive_active','analysis_queued','interactive_queued'].filter(key=>Number.isInteger(runtime[key])).map(key=>[key,runtime[key]]))};
  }
  let sampling=false;
  async function sample(runtime){if(sampling || !enabled)return;sampling=true;try{emit({...snapshot(runtime),...await memorySnapshot()});}finally{sampling=false;}}
  return {observe,phase,snapshot,sample};
}
