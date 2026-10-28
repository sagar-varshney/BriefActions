import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {api} from './api.js';
import Icon from './Icon.jsx';
import LoadingState from './LoadingState.jsx';
import Evidence from './Evidence.jsx';
import SourceTranscript from './SourceTranscript.jsx';
import TaskFollowThrough from './TaskFollowThrough.jsx';
import {progressLabels} from './reviewTools.js';
import './task-details.css';

function TaskHistory({run,task}){
 const [count,setCount]=useState(20);
 const events=run.events.filter(event=>['task_deadline','task_progress'].includes(event.kind)&&event.payload.proposal_id===task.proposal_id).slice().reverse();
 const original=task.deadline_correction?.confirmed_deadline??run.final_tasks.find(item=>item.proposal_id===task.proposal_id)?.deadline;
 return <section className="task-detail-history" aria-labelledby="task-detail-history-title"><h3 id="task-detail-history-title">Deadline &amp; progress history</h3><p className="form-hint">Originally confirmed deadline: <strong>{original || 'Unknown'}</strong>. Updates keep the confirmed plan and original conversation unchanged.</p>
  {!events.length?<p className="form-hint">No deadline or progress changes recorded for this task.</p>:<ol className="activity-timeline">{events.slice(0,count).map(event=>{const deadline=event.kind==='task_deadline',p=event.payload;return <li key={event.event_id}><div className="timeline-heading"><h4>{deadline?'Deadline corrected':'Progress updated'}</h4><time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}</time></div><p>{deadline?p.before:progressLabels[p.before]||p.before} → {deadline?p.after:progressLabels[p.after]||p.after}</p>{deadline&&<p>Reason: {p.reason}</p>}</li>;})}</ol>}
  {events.length>count&&<button className="button secondary" type="button" onClick={()=>setCount(value=>value+20)}>Show earlier task updates ({events.length-count})</button>}
 </section>;
}

export default function TaskDetails({runId,taskId,onClose,onOpenMeeting,onMutationSettled,closeGuard}){
 const dialog=useRef(null),heading=useRef(null),confirmation=useRef(null),evidenceTrigger=useRef(null),pendingNavigation=useRef(null);
 const [run,setRun]=useState(null),[error,setError]=useState(''),[loaded,setLoaded]=useState(false),[retry,setRetry]=useState(0),[passage,setPassage]=useState(null),[saving,setSaving]=useState(false),[dirty,setDirty]=useState(false),[requested,setRequested]=useState(null),[closeNotice,setCloseNotice]=useState('');
 useEffect(()=>{
  const element=dialog.current,trigger=document.activeElement,root=document.documentElement,overflow=root.style.overflow,main=document.getElementById('workspace-main'),position={x:window.scrollX,y:window.scrollY,top:main?.scrollTop||0,left:main?.scrollLeft||0},url=location.pathname+location.search;
  root.style.overflow='hidden';element.showModal();heading.current.focus({preventScroll:true});
  return()=>{element.close();root.style.overflow=overflow;if(location.pathname+location.search!==url)return;const target=trigger?.isConnected&&trigger!==document.body?trigger:main?.querySelector('h1');target?.focus({preventScroll:true});main?.scrollTo({top:position.top,left:position.left,behavior:'instant'});window.scrollTo({top:position.y,left:position.x,behavior:'instant'});};
 },[]);
 useEffect(()=>{let alive=true;setLoaded(false);setRun(null);setError('');setPassage(null);setDirty(false);api(`/runs/${runId}`).then(value=>{if(alive){setRun(value);const task=(value.current_tasks||value.final_tasks||[]).find(item=>item.proposal_id===taskId);setPassage(task?.evidence?.[0]||null);}}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setLoaded(true);});return()=>{alive=false;};},[runId,taskId,retry]);
 useEffect(()=>{if(requested)confirmation.current?.focus({preventScroll:true});},[requested]);
 useEffect(()=>{if(!saving)setCloseNotice('');},[saving]);
 useLayoutEffect(()=>{if(!closeGuard)return;closeGuard.current=action=>{if(!dirty&&!saving)return true;pendingNavigation.current=action;attempt('navigation');return false;};return()=>{closeGuard.current=null;};},[closeGuard,dirty,saving]);
 useEffect(()=>{if(pendingNavigation.current&&!saving&&!dirty)perform('navigation');},[saving,dirty]);
 const task=run&&(run.current_tasks||run.final_tasks||[]).find(item=>item.proposal_id===taskId);
 function perform(action){setRequested(null);setDirty(false);if(action==='refresh'){setRetry(value=>value+1);return;}dialog.current.close();if(action==='meeting')onOpenMeeting(runId,taskId);else if(action==='latest')onOpenMeeting(run.superseded_by);else{onClose();if(action==='navigation'){const resume=pendingNavigation.current;pendingNavigation.current=null;resume?.();}}}
 function attempt(action='close'){if(saving){setCloseNotice('Your update is saving. You can close the panel when it finishes.');return;}if(dirty)setRequested(action);else perform(action);}
 function keepEditing(){setRequested(null);pendingNavigation.current=null;dialog.current.querySelector('.deadline-editor :is(input:not(:disabled),textarea)')?.focus({preventScroll:true});}
 function keys(event){
  if(event.key==='Escape'&&requested){event.preventDefault();event.stopPropagation();keepEditing();return;}
  if(event.key!=='Tab')return;
  const controls=[...dialog.current.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')].filter(element=>element.getClientRects().length),first=controls[0],last=controls.at(-1);
  if(event.shiftKey&&(document.activeElement===first||document.activeElement===heading.current||document.activeElement===confirmation.current)){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
 }
 function inspect(value,trigger){evidenceTrigger.current=trigger;setPassage({...value});requestAnimationFrame(()=>{const source=dialog.current?.querySelector('#saved-source');if(!source)return;source.closest('details').open=true;source.focus({preventScroll:true});(source.querySelector('mark')||source).scrollIntoView({block:'center',behavior:'instant'});});}
 return <dialog ref={dialog} className="task-details-dialog" aria-labelledby="task-details-title" onKeyDown={keys} onCancel={event=>{event.preventDefault();attempt();}} onClick={event=>{const box=event.currentTarget.getBoundingClientRect();if(event.target===event.currentTarget&&(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom))attempt();}}>
  <header className="task-details-heading"><div><p className="eyebrow accent">KEEP YOUR PLACE. CHECK THE CONTEXT.</p><h2 ref={heading} id="task-details-title" tabIndex={-1}>Task details</h2></div><button type="button" className="shell-icon-button" aria-label="Close task details" title="Close task details" disabled={saving} onClick={()=>attempt()}><Icon name="cancelled" size={22}/></button></header>
  <div className="task-details-body">
   {requested&&<section ref={confirmation} tabIndex={-1} className="notice warning" role="alert" aria-label="Unsaved deadline correction"><strong>Your deadline correction has unsaved edits.</strong><p>Keep editing to save them, or discard the edits before leaving.</p><div className="task-details-actions"><button type="button" className="button primary" onClick={keepEditing}>Keep editing</button><button type="button" className="button secondary" onClick={()=>perform(requested)}>Discard edits and continue</button></div></section>}
   {closeNotice&&<p className="notice" role="status">{closeNotice}</p>}
   {!loaded?<LoadingState label="Loading task details…" requestKey={`${runId}-${taskId}-${retry}`}/>:error?<div className="notice error" role="alert">{error}<button type="button" className="text-button" onClick={()=>perform('refresh')}>Retry task details</button></div>:run&&<>
    <div className="task-details-meeting"><strong>{run.title||`Meeting ${run.reference_date}`}</strong><span>Meeting date: {run.reference_date}</span></div>
    {run.superseded_by&&<div className="notice warning" role="status">A reviewed follow-up replaced this plan. This version is read-only.<button className="text-button" type="button" onClick={()=>attempt('latest')}>Open current plan</button></div>}
    {run.status!=='confirmed'?<p className="notice">This meeting is still awaiting review. Open the full meeting to review and confirm its tasks.</p>:!task?<p className="notice" role="status">This task is no longer in this plan. Open the full meeting to inspect its available tasks and history.</p>:<>
     <TaskFollowThrough key={run.id} run={run} onlyTaskId={taskId} onBusyChange={setSaving} onDirtyChange={setDirty} onUpdate={value=>{setRun(value);setDirty(false);}} onMutationSettled={onMutationSettled} renderEvidence={(item,index)=>item.evidence?.length?<Evidence passages={item.evidence} onInspect={inspect} label={`confirmed task ${index+1}`}/>:<p className="form-hint">No supporting passage was saved for this task.</p>}/>
     <SourceTranscript compact run={run} passage={passage} onReturn={evidenceTrigger.current?()=>evidenceTrigger.current?.isConnected&&evidenceTrigger.current.focus({preventScroll:true}):undefined}/>
     <TaskHistory run={run} task={task}/>
    </>}
   </>}
  </div>
  <footer className="task-details-footer"><button type="button" className="button secondary" disabled={saving} onClick={()=>attempt('close')}>Back to your view</button><div className="task-details-actions"><button className="text-button" type="button" disabled={!loaded||saving} onClick={()=>attempt('refresh')}>Refresh task details</button><button className="button primary" type="button" disabled={saving} onClick={()=>attempt('meeting')}>Open full meeting<Icon name="external" size={16}/></button></div></footer>
 </dialog>;
}
