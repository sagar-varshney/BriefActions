import React,{useEffect,useRef,useState} from 'react';
import {api} from './api.js';
import accountStorage from './accountStorage.js';
import {dueMatches,localToday,progressLabels} from './reviewTools.js';
import useAfterRender from './useAfterRender.js';
export default function TaskFollowThrough({run,onUpdate,onViewChange=()=>{},renderEvidence,targetId}){
 const key=`flow.taskProgress.${run.id}`;
 const [status,setStatus]=useState('all'),[due,setDue]=useState('all'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState(()=>{try{const p=JSON.parse(accountStorage.getItem(key)||'null');return p && p.run_id===run.id && /^[a-f0-9]{32}$/.test(p.request_id) && run.final_tasks.some(t=>t.proposal_id===p.proposal_id) && Object.hasOwn(progressLabels,p.status) && Number.isInteger(p.version)?p:null;}catch{return null;}}),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const afterRender=useAfterRender(!busy);
 useEffect(()=>{if(targetId){setStatus('all');setDue('all');afterRender(()=>{const target=document.getElementById(`confirmed-task-${targetId}`);target?.focus({preventScroll:true});target?.scrollIntoView({block:'center',behavior:'instant'});});}},[targetId]);
 function clearPendingCache(){try{accountStorage.removeItem(key);}catch{/* A retained request can still be retried safely after storage recovers. */}}
 async function send(payload){
  setError('');
  try{accountStorage.setItem(key,JSON.stringify(payload));}catch{setError('Browser storage is unavailable. Enable storage before making a recoverable progress update.');return;}
  setBusy(true);setPending(payload);
  try{const value=await api(`/runs/${run.id}/progress`,{method:'POST',body:JSON.stringify(payload)});clearPendingCache();if(alive.current){setPending(null);onUpdate(value);}}
  catch(e){if(alive.current){setError(e.message);if(!e.retryable){clearPendingCache();setPending(null);}}}
  finally{if(alive.current)setBusy(false);}
 }
 async function refresh(){setBusy(true);setError('');try{const value=await api(`/runs/${run.id}`);if(alive.current)onUpdate(value);}catch(e){if(alive.current)setError(e.message);}finally{if(alive.current)setBusy(false);}}
 const today=localToday(),state=id=>run.task_progress?.[id] || {status:'todo',version:0};
 const visible=run.final_tasks.map((task,index)=>({task,index})).filter(({task})=>(status==='all' || state(task.proposal_id).status===status) && dueMatches(task,state(task.proposal_id).status,due,today));
 const completed=run.final_tasks.filter(t=>state(t.proposal_id).status==='done').length;
 return <section aria-label="Task follow-through"><div className="follow-through-heading"><h3>Follow through</h3><span role="status">{completed} of {run.final_tasks.length} done</span></div><details className="progress-help"><summary>About task progress</summary><p>Progress updates are saved separately from your confirmed plan and its supporting evidence. Overdue, due-today, and upcoming views exclude completed tasks.</p></details>
  {!!run.final_tasks.length&&<div className="review-toolbar"><label className="field-label">Task progress<select aria-label="Filter task progress" value={status} onChange={e=>{onViewChange();setStatus(e.target.value);}}><option value="all">All statuses</option>{Object.entries(progressLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label className="field-label">Due date<select aria-label="Filter tasks by due date" value={due} onChange={e=>{onViewChange();setDue(e.target.value);}}><option value="all">All dates</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="upcoming">Next 7 days</option><option value="unknown">Date unknown</option></select></label><button type="button" className="text-button" disabled={busy} onClick={refresh}>Refresh task progress</button></div>}
  {!!run.final_tasks.length&&<p className="form-hint">Date filters use your device’s date ({today}).</p>}
  {error&&<p role="alert" className="notice error">{error}</p>}
  {targetId&&!run.final_tasks.some(task=>task.proposal_id===targetId)&&<p className="notice" role="status">This task is not in the confirmed plan. You can review the available tasks below.</p>}
  {pending&&<div className="notice" role="status">A progress update is saved in this browser. Retry the same request to recover its result.<button type="button" className="button secondary" disabled={busy} onClick={()=>send(pending)}>{busy?'Saving progress…':'Retry progress update'}</button></div>}
  {!!run.final_tasks.length&&!visible.length&&<div className="notice">No tasks match these filters.<button type="button" className="text-button" onClick={()=>{onViewChange();setStatus('all');setDue('all');}}>Show all tasks</button></div>}
  {visible.map(({task,index})=><article id={`confirmed-task-${task.proposal_id}`} tabIndex={-1} className={`panel confirmed-card ${targetId===task.proposal_id?'task-link-target':''}`} key={task.proposal_id}><span className="check-circle" aria-hidden="true">{state(task.proposal_id).status==='done'?<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 12 4 4L19 6"/></svg>:String(index+1).padStart(2,'0')}</span><div className="confirmed-content"><h3>{task.task}</h3>{task.source==='manual'&&<span className="badge purple">User added</span>}<div className="task-meta"><span>Owner: <strong>{task.owner}</strong></span><span>Deadline: <strong>{task.deadline}</strong></span></div><label className="field-label task-progress-field">Progress for task {index+1}<select aria-label={`Progress for task ${index+1}`} disabled={busy || !!pending} value={state(task.proposal_id).status} onChange={e=>send({run_id:run.id,proposal_id:task.proposal_id,status:e.target.value,version:state(task.proposal_id).version,request_id:crypto.randomUUID().replaceAll('-','')})}>{Object.entries(progressLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>{renderEvidence(task,index)}</div></article>)}
 </section>;
}
