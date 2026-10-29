import Icon from './Icon.jsx';
import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {api} from './api.js';
import accountStorage from './accountStorage.js';
import {dueMatches,localToday,progressLabels} from './reviewTools.js';
import useAfterRender from './useAfterRender.js';
import CopyTask from './CopyTask.jsx';
import TaskDeadline from './TaskDeadline.jsx';
import {validDeadline} from './reviewTools.js';
export default function TaskFollowThrough({run,onUpdate,onViewChange=()=>{},renderEvidence,targetId,onlyTaskId,onBusyChange,onDirtyChange,onMutationSettled}){
 const key=`flow.taskProgress.${run.id}`,deadlineKey=`flow.taskDeadline.${run.id}`,tasks=run.current_tasks || run.final_tasks;
 const [feedback,setFeedback]=useState('');
 const [status,setStatus]=useState('all'),[due,setDue]=useState('all'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState(()=>{try{for(const [cache,kind] of [[deadlineKey,'deadline'],[key,'progress']]){const p=JSON.parse(accountStorage.getItem(cache)||'null');if(p && p.run_id===run.id && /^[a-f0-9]{32}$/.test(p.request_id) && tasks.some(t=>t.proposal_id===p.proposal_id) && Number.isInteger(p.version) && p.version>=0 && (kind==='progress'?Object.hasOwn(progressLabels,p.status):validDeadline(p.deadline) && typeof p.reason==='string' && p.reason.trim().length>0 && p.reason.length<=500))return {...p,kind};}return null;}catch{return null;}}),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useLayoutEffect(()=>{onBusyChange?.(busy);},[busy,onBusyChange]);
 const afterRender=useAfterRender(!busy);
 useEffect(()=>{if(targetId){setStatus('all');setDue('all');afterRender(()=>{const target=document.getElementById(`confirmed-task-${targetId}`);target?.focus({preventScroll:true});target?.scrollIntoView({block:'center',behavior:'instant'});});}},[targetId]);
 function clearPendingCache(kind){try{accountStorage.removeItem(kind==='deadline'?deadlineKey:key);}catch{/* A retained request can still be retried safely after storage recovers. */}}
 async function send(payload,kind='progress'){
  setError('');setFeedback('');
  try{accountStorage.setItem(kind==='deadline'?deadlineKey:key,JSON.stringify(payload));}catch{setError('Browser storage is unavailable. Enable storage before making a recoverable task update.');return;}
  setBusy(true);setPending({...payload,kind});
  let updated;
  try{const value=await api(`/runs/${run.id}/${kind}`,{method:'POST',body:JSON.stringify(payload)});updated=value;clearPendingCache(kind);if(alive.current){setPending(null);onUpdate(value);setFeedback(kind==='deadline'?'Deadline corrected. Calendar, My day, and task views use the updated date.':'Task progress saved.');}return true;}
  catch(e){if(alive.current){setError(e.message);if(!e.retryable){clearPendingCache(kind);setPending(null);}}}
  finally{if(alive.current)setBusy(false);onMutationSettled?.(updated);}
 }
 async function refresh(){setBusy(true);setError('');try{const value=await api(`/runs/${run.id}`);if(alive.current)onUpdate(value);}catch(e){if(alive.current)setError(e.message);}finally{if(alive.current)setBusy(false);}}
 const today=localToday(),state=id=>run.task_progress?.[id] || {status:'todo',version:0};
 const visible=tasks.map((task,index)=>({task,index})).filter(({task})=>onlyTaskId?task.proposal_id===onlyTaskId:(status==='all' || state(task.proposal_id).status===status) && dueMatches(task,state(task.proposal_id).status,due,today));
 const completed=tasks.filter(t=>state(t.proposal_id).status==='done').length;
 return <section aria-label="Task follow-through">{!onlyTaskId&&<><div className="follow-through-heading"><h3>Follow through</h3><span role="status">{completed} of {tasks.length} done</span></div><details className="progress-help"><summary>About task progress</summary><p>Progress updates and deadline corrections are saved separately from your confirmed plan and its supporting evidence. Overdue, due-today, and upcoming views exclude completed tasks.</p></details></>}
  {!!tasks.length&&!onlyTaskId&&<div className="review-toolbar"><label className="field-label">Task progress<select aria-label="Filter task progress" value={status} onChange={e=>{onViewChange();setStatus(e.target.value);}}><option value="all">All statuses</option>{Object.entries(progressLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label className="field-label">Due date<select aria-label="Filter tasks by due date" value={due} onChange={e=>{onViewChange();setDue(e.target.value);}}><option value="all">All dates</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="upcoming">Next 7 days</option><option value="unknown">Date unknown</option></select></label><button type="button" className="text-button" disabled={busy} onClick={refresh}>Refresh task progress</button></div>}
  {!!tasks.length&&!onlyTaskId&&<p className="form-hint">Date filters use your device’s date ({today}).</p>}
  {error&&<p role="alert" className="notice error">{error}</p>}{feedback&&<p role="status" className="notice">{feedback}</p>}
  {targetId&&!tasks.some(task=>task.proposal_id===targetId)&&<p className="notice" role="status">This task is not in the confirmed plan. You can review the available tasks below.</p>}
  {pending&&<div className="notice" role="status">{busy?'Saving your task update to the workspace…':`${pending.kind==='deadline'?'A deadline correction':'A progress update'} is saved in this browser. Retry the same request to recover its result.`}<p>{tasks.find(task=>task.proposal_id===pending.proposal_id)?.task} → {pending.kind==='deadline'?pending.deadline:progressLabels[pending.status]}{pending.kind==='deadline'&&`. Reason: ${pending.reason}`}</p><button type="button" className="button secondary" disabled={busy} onClick={()=>send(pending,pending.kind)}>{busy?'Saving task update…':pending.kind==='deadline'?'Retry deadline correction':'Retry progress update'}</button></div>}
  {!!tasks.length&&!visible.length&&!onlyTaskId&&<div className="notice">No tasks match these filters.<button type="button" className="text-button" onClick={()=>{onViewChange();setStatus('all');setDue('all');}}>Show all tasks</button></div>}
  {visible.map(({task,index})=><article id={`confirmed-task-${task.proposal_id}`} tabIndex={-1} className={`panel confirmed-card ${targetId===task.proposal_id?'task-link-target':''}`} key={task.proposal_id}><span className="check-circle" aria-hidden="true">{state(task.proposal_id).status==='done'?<Icon name="check" size={18}/>:String(index+1).padStart(2,'0')}</span><div className="confirmed-content"><h3>{task.task}</h3>{task.source==='manual'&&<span className="badge purple">User added</span>}<div className="task-meta"><span>Owner: <strong>{task.owner}</strong></span><span>Deadline: <strong>{task.deadline}</strong></span></div><label className="field-label task-progress-field">Progress for task {index+1}<select aria-label={`Progress for task ${index+1}`} disabled={busy || !!pending || !!run.superseded_by} value={state(task.proposal_id).status} onChange={e=>send({run_id:run.id,proposal_id:task.proposal_id,status:e.target.value,version:state(task.proposal_id).version,request_id:crypto.randomUUID().replaceAll('-','')})}>{Object.entries(progressLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><TaskDeadline run={run} task={task} index={index} disabled={busy || !!pending} onDirtyChange={onlyTaskId?onDirtyChange:undefined} onSave={payload=>send(payload,'deadline')}/><CopyTask task={task}/>{renderEvidence(task,index)}</div></article>)}
 </section>;
}
