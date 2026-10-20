import React,{useState} from 'react';
import {progressLabels} from './reviewTools.js';
const stamp=value=>new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
function humanize(events,proposals){
 const byId=new Map(proposals.map((p,i)=>[p.proposal_id,{...p,number:i+1}]));const finalTasks=new Map((events.find(e=>e.kind==='final')?.payload.tasks || []).map(t=>[t.proposal_id,t.task]));let previous=new Map(proposals.map(p=>[p.proposal_id,{...p,accept:false}])),title=events[0]?.payload.title || 'Unnamed meeting';
 return events.map(event=>{const p=event.payload,lines=[];let heading;
  if(event.kind==='extraction'){heading='Analyzed transcript';lines.push(`${p.proposals.length} proposals extracted. Original conversation and supporting evidence saved.`);}
  else if(event.kind==='manual_proposal'){heading='Added a missed action';lines.push(`Task ${byId.get(p.proposal.proposal_id)?.number}: ${p.proposal.task}`);}
  else if(event.kind==='draft'){
   heading='Saved review edits';
   for(const d of p.decisions){const before=previous.get(d.proposal_id) || byId.get(d.proposal_id),number=byId.get(d.proposal_id)?.number;if(!before)continue;
    if(before.accept!==d.accept)lines.push(`Task ${number}: ${d.accept?'selected to keep':'unselected'}.`);
    for(const field of ['task','owner','deadline'])if(before[field]!==d[field])lines.push(`Task ${number} ${field}: ${before[field] || '(empty)'} → ${d[field] || '(empty)'}`);
   }previous=new Map(p.decisions.map(d=>[d.proposal_id,d]));if(!lines.length)lines.push('Review draft saved.');
  }
  else if(event.kind==='review'){heading='Submitted review decisions';for(const d of p.decisions){lines.push(`Task ${byId.get(d.proposal_id)?.number}: ${d.accept?'kept':'rejected'}.`);for(const [field,change] of Object.entries(d.corrections || {}))lines.push(`Task ${byId.get(d.proposal_id)?.number} ${field}: ${change.before} → ${change.after}`);}}
  else if(event.kind==='plan_update_draft'){heading='Saved change review';lines.push(`${p.decisions.filter(d=>d.apply).length} proposed changes selected.`);}
  else if(event.kind==='followup_draft'){heading='Saved follow-up message';lines.push(`Draft version ${p.version}: ${p.subject}`, 'The message is saved separately from the confirmed plan.');}
  else if(event.kind==='meeting_series_link'){heading='Changed meeting series';lines.push(p.series_id?'Grouped this meeting and its follow-up versions in a recurring series.':'Removed this meeting and its follow-up versions from a series.');}
  else if(event.kind==='plan_update_review'){heading='Reviewed follow-up changes';lines.push(`${p.decisions.filter(d=>d.apply).length} changes approved. Previous plan preserved.`);}
  else if(event.kind==='plan_superseded'){heading='Replaced by a reviewed follow-up';lines.push('This version remains in history. All tasks uses its approved replacement.');}
  else if(event.kind==='final'){heading='Confirmed plan';lines.push(`${p.tasks.length} task${p.tasks.length===1?'':'s'} saved in the immutable confirmed plan.`);}
  else if(event.kind==='meeting_title'){heading='Renamed meeting';lines.push(`Meeting name: ${title} → ${p.title || 'Unnamed meeting'}`);title=p.title || 'Unnamed meeting';}
  else if(event.kind==='task_deadline'){heading='Corrected task deadline';lines.push(`${finalTasks.get(p.proposal_id) || 'Task'}: ${p.before} → ${p.after}`,`Reason: ${p.reason}`);}
  else if(event.kind==='task_progress'){heading='Updated task progress';lines.push(`${finalTasks.get(p.proposal_id) || 'Task'}: ${progressLabels[p.before] || p.before} → ${progressLabels[p.after] || p.after}`);}
  else{heading=event.kind.replaceAll('_',' ');lines.push('Saved event; inspect the raw record for details.');}
  return {...event,heading,lines};
 });
}
export function ConversationChanges({changes=[],renderEvidence}){if(!changes.length)return null;return <section className="conversation-changes" aria-label="Conversation revisions and cancellations"><h3>Conversation revisions & cancellations</h3>{changes.map((change,i)=><article key={i} className="change-record"><h4>{change.kind==='cancellation'?'Task cancelled':change.kind==='deadline_revision'?'Deadline revised':'Reference needs review'}</h4>{change.task&&<p>{change.task}</p>}{change.kind==='deadline_revision'&&<p>Deadline: {change.before} → {change.after}</p>}{change.kind==='cancellation'&&<p>Cancelled in the conversation; excluded from active proposals.</p>}{change.directive&&<p>{change.directive}</p>}{change.reason&&<p>{change.reason}</p>}{renderEvidence(change,i)}</article>)}</section>;}
export default function ActivityTimeline({run,download}){
 const [count,setCount]=useState(30),entries=humanize(run.events,run.proposals),visible=entries.slice(-count).reverse();
 return <section className="audit" aria-label="Activity timeline"><div className="section-heading"><div><h2>Activity</h2><p>Your edits and decisions, newest first.</p></div>{download}</div><ol className="activity-timeline">{visible.map(event=><li key={event.event_id}><div className="timeline-heading"><h3>{event.heading}</h3><time dateTime={event.created_at}>{stamp(event.created_at)}</time></div><ul>{event.lines.map((line,i)=><li key={i}>{line}</li>)}</ul><details className="raw-event"><summary>Raw event JSON</summary><pre className="json" tabIndex={0}>{JSON.stringify(event.payload,null,2)}</pre></details></li>)}</ol>{entries.length>count&&<button type="button" className="button secondary" onClick={()=>setCount(count+30)}>Show earlier activity ({entries.length-count})</button>}</section>;
}
