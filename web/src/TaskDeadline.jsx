import React,{useId,useRef,useState} from 'react';
import {validDeadline} from './reviewTools.js';
import useAfterRender from './useAfterRender.js';

export default function TaskDeadline({run,task,index,disabled,onSave}){
 const id=useId(),trigger=useRef(null),dateField=useRef(null),unknownField=useRef(null),afterRender=useAfterRender(!disabled);
 const [open,setOpen]=useState(false),[date,setDate]=useState(''),[unknown,setUnknown]=useState(false),[reason,setReason]=useState('');
 const correction=task.deadline_correction,version=run.task_deadlines?.[task.proposal_id]?.version || 0;
 const [baseVersion,setBaseVersion]=useState(version);
 function edit(){setBaseVersion(version);setDate(task.deadline==='Unknown'?'':task.deadline);setUnknown(task.deadline==='Unknown');setReason('');setOpen(true);afterRender(()=>(task.deadline==='Unknown'?unknownField:dateField).current?.focus());}
 function close(){setOpen(false);afterRender(()=>trigger.current?.focus());}
 const value=unknown?'Unknown':date;
 async function submit(event){event.preventDefault();if(disabled || value===task.deadline || !validDeadline(value) || !reason.trim())return;
  if(await onSave({run_id:run.id,proposal_id:task.proposal_id,deadline:value,reason:reason.trim(),version:baseVersion,request_id:crypto.randomUUID().replaceAll('-','')}))close();
 }
 return <div className="deadline-control">
  {correction&&<div className="deadline-correction"><strong>Deadline corrected</strong><p>Originally confirmed: {correction.confirmed_deadline}. Reason: {correction.reason}</p><p>The supporting transcript is unchanged. Activity and plan history keep the previous dates.</p></div>}
  {!run.superseded_by&&<><button ref={trigger} className="text-button" type="button" disabled={disabled} aria-expanded={open} aria-controls={id} onClick={()=>open?close():edit()}>{open?'Close deadline correction':'Correct deadline'}<span className="sr-only"> for task {index+1}</span></button>
  {open&&<form id={id} className="deadline-editor" aria-label={`Correct deadline for task ${index+1}`} onSubmit={submit}><p>Current deadline: <strong>{task.deadline}</strong>. This correction updates your task views and keeps the confirmed plan and source unchanged.</p><fieldset disabled={disabled}><legend className="sr-only">Deadline correction</legend><label className="field-label">New deadline<input ref={dateField} type="date" aria-label={`New deadline for task ${index+1}`} disabled={unknown} required={!unknown} value={date} onChange={event=>setDate(event.target.value)}/></label><label className="deadline-unknown"><input ref={unknownField} type="checkbox" checked={unknown} onChange={event=>setUnknown(event.target.checked)}/> No known deadline</label><label className="field-label">Reason for correction<textarea aria-label={`Reason for correction for task ${index+1}`} value={reason} required maxLength={500} rows={3} onChange={event=>setReason(event.target.value)} placeholder="Why is this date changing?"/></label><p className="form-hint">Required · up to 500 characters. Uncertain dates can stay Unknown.</p><div className="deadline-actions"><button className="button primary" disabled={value===task.deadline || !validDeadline(value) || !reason.trim()}>Save deadline correction</button><button className="button secondary" type="button" onClick={close}>Cancel correction</button></div></fieldset></form>}</>}
 </div>;
}
