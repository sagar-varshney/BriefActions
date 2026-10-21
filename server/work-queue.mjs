// Known lightweight operations get a reserved lane. Unknown/research/export
// operations retain the analysis budget; clients cannot choose their priority.
const INTERACTIVE=new Set(['config','runs','run','draft','finalize','manual_action',
 'task_progress','task_deadline','meeting_title','meeting_search','task_search',
 'daily_overview','calendar_search','owner_search','weekly_review','followup_draft',
 'series_list','series_get','series_create','series_name','series_assign',
 'series_preparation','series_agenda','series_agenda_version','csv']);
export const operationLane=operation=>INTERACTIVE.has(operation)?'interactive':'analysis';
export function createWorkQueue({limit,timeout,error}){
 let active=0;const waiting=[];
 function acquire(){
  if(active<limit){active++;return Promise.resolve();}
  if(waiting.length>=10)throw error();
  return new Promise((resolve,reject)=>{
   const wake=()=>{clearTimeout(timer);active++;resolve();};
   const timer=setTimeout(()=>{const i=waiting.indexOf(wake);if(i>=0)waiting.splice(i,1);reject(error());},timeout);
   waiting.push(wake);
  });
 }
 async function run(action,observe=()=>{}){
  const start=performance.now();
  try{await acquire();}finally{observe('queue',performance.now()-start);}
  const began=performance.now();
  try{return await action();}finally{active--;waiting.shift()?.();observe('worker',performance.now()-began);}
 }
 return {run,stats:()=>({active,queued:waiting.length,limit})};
}
