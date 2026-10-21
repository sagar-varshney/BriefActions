import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const MAX_OUTPUT=8_000_000;

/** Workers process one request at a time. Only trusted API code supplies scope. */
export function createEnginePool({python,size=1,databaseUrl,historyPath,error,bridge=path.join(ROOT,'web_bridge.py')}){
 const workers=new Set(),exits=new Set();let stopped=false,sequence=0,spawned=0;
 const unavailable=()=>error(503,'Analysis is temporarily unavailable. Please try again later.','worker.unavailable');
 function start(){
  const child=spawn(python(),['-B',bridge,'--serve'],{cwd:ROOT,env:{...process.env,FLOW_ACCOUNT_ID:'',FLOW_DATABASE_URL:databaseUrl||'',...(historyPath?{FLOW_HISTORY_PATH:historyPath}:{}),PYTHONIOENCODING:'utf-8',LOKY_MAX_CPU_COUNT:'2'},stdio:['pipe','pipe','pipe']});
  const worker={child,pending:null,buffer:'',closing:false};workers.add(worker);spawned++;
  const exited=new Promise(resolve=>child.once('close',()=>{workers.delete(worker);resolve();}));
  exits.add(exited);void exited.then(()=>exits.delete(exited));
  child.stdout.setEncoding('utf8');child.stderr.resume();
  const fail=cause=>{
   if(worker.closing)return;
   worker.closing=true;worker.buffer='';child.kill('SIGKILL');
   if(worker.pending){const current=worker.pending;worker.pending=null;clearTimeout(current.timer);current.reject(cause);}
  };
  worker.fail=fail;
  child.on('error',()=>fail(unavailable()));
  child.stdin.on('error',()=>fail(unavailable()));
  child.on('close',()=>fail(error(502,'Your request could not be completed. Please try again.','worker.invalid_response')));
  child.stdout.on('data',chunk=>{
   if(worker.closing)return;
   worker.buffer+=chunk;
   const invalid=()=>fail(error(502,'Analysis is temporarily unavailable. Please try again later.','worker.invalid_response'));
   if(Buffer.byteLength(worker.buffer)>MAX_OUTPUT){fail(error(502,'The result is too large to return. Try a shorter transcript.','worker.output_limit'));return;}
   const end=worker.buffer.indexOf('\n');if(end<0)return;
   const line=worker.buffer.slice(0,end);worker.buffer=worker.buffer.slice(end+1);
   let result;try{result=JSON.parse(line);}catch{invalid();return;}
   const current=worker.pending;
   if(!current||result?.id!==current.id||worker.buffer||typeof result.ok!=='boolean'){invalid();return;}
   worker.pending=null;clearTimeout(current.timer);
   if(result.timings && current.onMetrics){
    const metrics=Object.fromEntries(['storage_scope','analysis_compute'].filter(key=>Number.isFinite(result.timings[key])&&result.timings[key]>=0).map(key=>[key,result.timings[key]]));
    try{current.onMetrics(metrics);}catch{/* Diagnostics cannot change a saved result. */}
   }
   if(result.ok){current.resolve(result.data);return;}
   const status=Number.isInteger(result.status)&&result.status>=400&&result.status<=599?result.status:500;
   const code=['runtime.dependencies','storage.failed'].includes(result.code)?result.code:'worker.failed';
   current.reject(error(status,status>=500?'Your request could not be completed. Please try again.':typeof result.error==='string'?result.error:'Your request could not be completed.',code));
  });
  return worker;
 }
 function execute(request,{accountId,historyPath:requestHistoryPath,timeout=60_000,onMetrics}={}){
  if(stopped)return Promise.reject(unavailable());
  let worker=[...workers].find(w=>!w.closing&&!w.pending);
  if(!worker){
   if(workers.size>=size)return Promise.reject(unavailable());
   worker=start();
  }
  return new Promise((resolve,reject)=>{
   const id=++sequence;
   worker.pending={id,resolve,reject,onMetrics,timer:setTimeout(()=>worker.fail(error(504,'The analysis took too long. Try a shorter transcript.','worker.timeout')),timeout)};
   try{worker.child.stdin.write(JSON.stringify({id,request,account_id:accountId||null,history_path:requestHistoryPath||historyPath})+'\n');}
   catch{worker.fail(unavailable());}
  });
 }
 async function stop(){stopped=true;for(const worker of workers)worker.fail(unavailable());await Promise.allSettled([...exits]);}
 return {execute,stop,stats:()=>({processes:workers.size,spawned})};
}
