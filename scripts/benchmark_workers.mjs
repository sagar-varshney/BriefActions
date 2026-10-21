// Local synthetic benchmark. No production credentials, accounts, or data.
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {engine,pythonBinary,HttpError} from '../server/index.mjs';
import {createEnginePool} from '../server/engine-pool.mjs';

const samples=5,folder=await mkdtemp(path.join(tmpdir(),'flow-worker-benchmark-'));
const pool=createEnginePool({python:pythonBinary,size:1,error:(status,message,code)=>new HttpError(status,message,code)});
const report={scope:'Local SQLite synthetic workflow; not a hosted latency guarantee.',samples,one_shot:[],reused:[]};
async function measure(execute,label){
 const options={historyPath:path.join(folder,label+'.sqlite3')};
 for(let i=0;i<samples;i++){
  const start=performance.now();
  const run=await execute({operation:'analyze',transcript:'Maya will send the report tomorrow. Arjun will review the onboarding flow by Friday.',reference_date:'2026-10-21',request_id:randomUUID().replaceAll('-','')},options);
  const analysis=performance.now()-start,loadStart=performance.now();
  await execute({operation:'run',run_id:run.id},options);const load=performance.now()-loadStart;
  const confirmStart=performance.now();
  await execute({operation:'finalize',run_id:run.id,decisions:run.proposals.map(p=>({...p,accept:true}))},options);
  report[label].push({analysis_ms:Math.round(analysis),load_ms:Math.round(load),confirm_ms:Math.round(performance.now()-confirmStart)});
 }
}
try{
 await measure(engine,'one_shot');await measure(pool.execute,'reused');
 report.worker_processes=pool.stats().spawned;
 for(const label of ['one_shot','reused']){
  const warm=report[label].slice(1);
  report[label+'_warm_median_ms']=Object.fromEntries(['analysis_ms','load_ms','confirm_ms'].map(key=>[key,warm.map(x=>x[key]).sort((a,b)=>a-b)[Math.floor(warm.length/2)]]));
 }
 const output=process.argv[2];if(output)await writeFile(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
}finally{await pool.stop();await rm(folder,{recursive:true,force:true});}
