import React,{useEffect,useRef,useState} from 'react';
import {api} from './api.js';
import accountStorage from './accountStorage.js';
import {reviewError} from './reviewTools.js';
import useAfterRender from './useAfterRender.js';
const labels={added:'Added',changed:'Changed',cancelled:'Cancelled',unchanged:'Unchanged'};
const fields=['task','owner','deadline'];
const read=key=>{try{return JSON.parse(accountStorage.getItem(key)||'null');}catch{return null;}};

export function FollowupForm({run,client,busy,onStart}){
 const key=`flow.planUpdateInput.${run.id}.${client}`;
 const [input,setInput]=useState(()=>read(key)||{transcript:'',reference_date:'',request_id:null});
 const [error,setError]=useState('');
 function change(patch){const value={...input,...patch,request_id:null};setInput(value);try{accountStorage.setItem(key,JSON.stringify(value));setError('');}catch{setError('Browser storage is unavailable. Copy your follow-up text before leaving.');}}
 async function submit(event){event.preventDefault();const value={...input,request_id:input.request_id||crypto.randomUUID().replaceAll('-','')};try{accountStorage.setItem(key,JSON.stringify(value));setInput(value);setError('');await onStart(value);accountStorage.removeItem(key);}catch(e){setError(e.message);}}
 return <details className="panel followup-panel"><summary>Review a follow-up conversation</summary><div className="followup-content"><h3>What changed since this plan?</h3><p>Add the next conversation to compare it with your confirmed tasks. Unmentioned tasks stay unchanged. You decide which changes to apply.</p>
  <form onSubmit={submit}><label className="field-label">Follow-up transcript<textarea aria-label="Follow-up transcript" value={input.transcript} onChange={e=>change({transcript:e.target.value})} maxLength={100000} rows={6} disabled={busy} required placeholder="Maya: Move the report to Monday.&#10;Jon: Cancel the notes.&#10;Ada: I will review the budget tomorrow."/></label>
  <label className="field-label">Follow-up meeting date<input aria-label="Follow-up meeting date" type="date" min={run.reference_date} value={input.reference_date} onChange={e=>change({reference_date:e.target.value})} required disabled={busy}/></label>
  <p className="form-hint">Use the follow-up date for “tomorrow” and weekdays. Comparison saves a separate draft; your current plan stays active until you confirm.</p>
  {error&&<p className="notice error" role="alert">{error} Retry the same input to recover a completed comparison.</p>}
  <button className="button primary" disabled={busy}>{busy?'Comparing…':input.request_id?'Retry comparison':'Compare with this plan'}</button></form>
 </div></details>;
}

function defaults(rows,decisions=[]){const saved=new Map(decisions.map(d=>[d.change_id,d]));return rows.filter(r=>r.kind!=='unchanged').map(r=>saved.get(r.change_id)||{change_id:r.change_id,apply:false,...Object.fromEntries(fields.map(k=>[k,(r.after||r.before)[k]]))});}
function FieldSummary({task}){return <><p className="plan-task-name">{task.task}</p><dl className="plan-change-meta"><div><dt>Owner</dt><dd>{task.owner}</dd></div><div><dt>Deadline</dt><dd>{task.deadline}</dd></div></dl></>;}
export default function PlanChangeReview({run,client,busy,onConfirm,renderEvidence,onOpen,onViewChange=()=>{}}){
 const update=run.settings.plan_update,rows=update.rows,confirmed=run.status==='confirmed';
 const confirmedDecisions=run.events.find(e=>e.kind==='plan_update_review')?.payload.decisions;
 const key=`flow.planUpdateReview.${run.id}.${client}`,server=run.update_draft||{version:0,decisions:[]},cached=useRef(read(key));
 const initial=confirmed?confirmedDecisions:cached.current?.dirty&&cached.current.version===server.version?cached.current.decisions:server.decisions;
 const [decisions,setDecisions]=useState(()=>defaults(rows,initial)),current=useRef(decisions),version=useRef(server.version);
 const [status,setStatus]=useState(cached.current?.dirty?'Recovered your browser review.':'Choose which changes to apply. Nothing is applied automatically.');
 const [error,setError]=useState(''),[filter,setFilter]=useState('all'),[blocked,setBlocked]=useState(!!cached.current?.dirty&&cached.current.version!==server.version&&!confirmed);
 const timer=useRef(null),queue=useRef(Promise.resolve()),alive=useRef(true),edit=useRef(0);
 const afterRef=useRef(null),afterRender=useAfterRender(!busy);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;clearTimeout(timer.current);};},[]);
 function cache(value,dirty){accountStorage.setItem(key,JSON.stringify({version:version.current,decisions:value,dirty}));}
 async function save(value,epoch){
  if(blocked)return;
  try{const snapshot=await api(`/runs/${run.id}/update-draft`,{method:'POST',body:JSON.stringify({decisions:value,version:version.current})});version.current=snapshot.update_draft.version;cache(current.current,epoch!==edit.current);if(alive.current&&epoch===edit.current){setStatus('Review saved to history.');setError('');}}
  catch(e){if(alive.current){setError(e.message);setStatus('Your browser review is kept. Retry saving or reload the saved review.');if(e.status===409)setBlocked(true);}throw e;}
 }
 function schedule(value,epoch){clearTimeout(timer.current);timer.current=setTimeout(()=>{queue.current=queue.current.catch(()=>{}).then(()=>save(value,epoch));queue.current.catch(()=>{});},400);}
 useEffect(()=>{if(!confirmed&&cached.current?.dirty&&cached.current.version===server.version)schedule(current.current,edit.current);if(confirmed)accountStorage.removeItem(key);},[]);
 function change(id,patch){const value=current.current.map(d=>d.change_id===id?{...d,...patch}:d);current.current=value;setDecisions(value);const epoch=++edit.current;try{cache(value,true);setError('');setStatus('Review saved in this browser; saving to history…');schedule(value,epoch);}catch{setError('Browser storage is unavailable. Keep this page open until you can save.');}}
 async function retrySave(){clearTimeout(timer.current);queue.current=queue.current.catch(()=>{}).then(()=>save(current.current,edit.current));await queue.current.catch(()=>{});}
 async function reload(){try{clearTimeout(timer.current);await queue.current.catch(()=>{});const snapshot=await api(`/runs/${run.id}`);if(snapshot.status==='confirmed'){location.reload();return;}const saved=snapshot.update_draft||{version:0,decisions:[]};clearTimeout(timer.current);await queue.current.catch(()=>{});version.current=saved.version;const value=defaults(rows,saved.decisions);current.current=value;setDecisions(value);cache(value,false);setBlocked(false);setError('');setStatus('Loaded the saved review; browser edits were replaced.');}catch(e){setError(e.message);}}
 async function submit(event){event.preventDefault();clearTimeout(timer.current);await queue.current.catch(()=>{});if(blocked)return;const chosen=rows.filter(r=>r.after&&current.current.some(d=>d.change_id===r.change_id&&d.apply)).map(r=>({row:r,...current.current.find(d=>d.change_id===r.change_id)}));const invalid=reviewError(chosen);if(invalid){const target=chosen[invalid.index];setFilter('all');setError(`Check the approved change: ${invalid.message}`);afterRender(()=>document.getElementById(`change-${target.change_id}-${invalid.field}`)?.focus());return;}try{await onConfirm({decisions:current.current,version:version.current});accountStorage.removeItem(key);}catch(e){setError(e.message);if(e.status===409)setBlocked(true);afterRef.current?.focus();}}
 const byId=new Map(decisions.map(d=>[d.change_id,d])),counts=Object.fromEntries(Object.keys(labels).map(kind=>[kind,rows.filter(r=>r.kind===kind).length]));
 const selected=decisions.filter(d=>d.apply).length,visible=rows.filter(r=>filter==='all'||r.kind===filter);
 return <section className="plan-comparison" aria-labelledby="plan-comparison-title">
  <div className="section-heading"><div><div className="eyebrow accent">A PLAN THAT KEEPS THE CONVERSATION</div><h2 id="plan-comparison-title" tabIndex={-1} ref={afterRef}>{confirmed?'Reviewed plan changes':'Review plan changes'}</h2><p>{confirmed?'Your choices are saved below.':'Compare the previous plan with this follow-up. Existing tasks stay unless you approve a change.'}</p></div></div>
  <button type="button" className="text-button" disabled={busy} onClick={()=>onOpen(update.base_run_id)}>Open previous plan</button>
  <div className="plan-change-filters" role="group" aria-label="Plan change types"><button type="button" className="button secondary" aria-pressed={filter==='all'} onClick={()=>{onViewChange();setFilter('all');}}>All ({rows.length})</button>{Object.entries(labels).map(([kind,label])=><button type="button" className="button secondary" key={kind} aria-pressed={filter===kind} onClick={()=>{onViewChange();setFilter(kind);}}>{label} ({counts[kind]})</button>)}</div>
  {update.warnings.map((warning,i)=><div className="notice warning" key={i}><p>{warning.message}</p>{renderEvidence(warning,`unresolved change ${i+1}`)}</div>)}
  {blocked&&<p className="notice warning" role="alert">This comparison changed in another tab. Your browser copy is preserved. Reload the saved review before continuing.</p>}
  <form onSubmit={submit} noValidate>
   {!visible.length&&<p className="notice">No tasks in this change category.</p>}
   {visible.map((row,index)=>{const d=byId.get(row.change_id),number=rows.indexOf(row)+1,disabled=busy||blocked||confirmed;return <article className={`panel plan-change-card plan-change-${row.kind}`} key={row.change_id} aria-label={`${labels[row.kind]} task ${number}`}>
    <div className="plan-change-heading"><span className="badge neutral">{labels[row.kind]}</span><h3>{(row.after||row.before).task}</h3></div>
    {row.kind==='unchanged'?<><p className="form-hint">Kept from the previous plan. No approved change is needed.</p><FieldSummary task={row.before}/></>:<>
     <label className="plan-change-choice"><input type="checkbox" aria-label={`Apply ${row.kind} change for task ${number}`} checked={!!d?.apply} onChange={e=>change(row.change_id,{apply:e.target.checked})} disabled={disabled}/><span>{row.kind==='cancelled'?'Approve cancellation':row.kind==='added'?'Add this task':'Apply this update'}{confirmed?(d?.apply?' · Applied':' · Not applied'):''}</span></label>
     <div className="plan-change-columns">{row.before&&<div><h4>Previous plan</h4><FieldSummary task={row.before}/></div>}
      <div><h4>{row.kind==='cancelled'?'Proposed cancellation':'Proposed update'}</h4>{row.after?fields.map(field=><label key={field} className="field-label">{field==='task'?'Task':field==='owner'?'Owner':'Deadline'}<input id={`change-${row.change_id}-${field}`} aria-label={`${field[0].toUpperCase()+field.slice(1)} for change ${number}`} value={d?.[field]??row.after[field]} disabled={disabled} maxLength={10000} onChange={e=>change(row.change_id,{[field]:e.target.value})}/></label>):<p>Remove this task from the current plan. Leave unchecked to keep it.</p>}</div>
     </div>
    </>}
    <details className="plan-change-evidence"><summary>Check supporting passages</summary>{row.before&&<div><h4>Previous conversation</h4>{renderEvidence(row.before,`previous task ${number}`)}</div>}{!!row.evidence.length&&<div><h4>Follow-up conversation</h4>{renderEvidence({evidence:row.evidence},`follow-up task ${number}`)}</div>}</details>
   </article>;})}
   {!confirmed&&<><p className="form-hint" role="status">{status}</p>{error&&<p className="notice error" role="alert">{error}</p>}{(error||blocked)&&<div className="plan-change-actions"><button className="button secondary" type="button" onClick={retrySave} disabled={busy||blocked}>Retry saving review</button><button className="button secondary" type="button" onClick={reload} disabled={busy}>Use saved review</button></div>}
    <div className="plan-confirmation"><p><strong>{selected} of {decisions.length} changes approved.</strong> Unapproved changes keep the previous task, or skip a new task. Confirmation replaces the previous version in All tasks and carries over progress for retained tasks.</p><button className="button primary" disabled={busy||blocked}>{busy?'Saving…':'Confirm updated plan'}</button></div>
   </>}
  </form>
 </section>;
}
