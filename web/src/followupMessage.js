import {progressLabels} from './reviewTools.js';
const inline=value=>String(value || 'Unknown').replace(/\r\n?/g,'\n').split('\n').join(' ');
const unknown=value=>!value?.trim() || value.trim().toLowerCase()==='unknown';

export function followupMessage(run){
 if(run?.status!=='confirmed' || run.superseded_by)throw new Error('Open the current confirmed plan to draft a follow-up.');
 const tasks=run.current_tasks || run.final_tasks,open=[],done=[],missing=[];
 for(const task of tasks){
  const status=run.task_progress?.[task.proposal_id]?.status || 'todo';
  const line=`• ${inline(task.task)} — Owner: ${unknown(task.owner)?'Unknown':inline(task.owner)}; deadline: ${unknown(task.deadline)?'Unknown':inline(task.deadline)}; ${progressLabels[status]}.`;
  (status==='done'?done:open).push(line);
  if(status!=='done' && (unknown(task.owner) || unknown(task.deadline)))missing.push(`• ${inline(task.task)} — ${[unknown(task.owner)&&'owner Unknown',unknown(task.deadline)&&'deadline Unknown'].filter(Boolean).join('; ')}.`);
 }
 const title=inline(run.title || `Meeting ${run.reference_date}`),lines=[`Here is the confirmed action plan from ${title} (${run.reference_date}).`,'','Next steps',...(open.length?open:['No open tasks.'])];
 if(done.length)lines.push('','Completed',...done);
 if(missing.length)lines.push('','Details to confirm',...missing);
 lines.push('','Please review the details above and flag any changes.');
 const body=lines.join('\n');
 if(body.length>100_000)throw new Error('This plan is too long for one follow-up. Copy selected tasks from the plan instead.');
 return {subject:`Follow-up: ${title}`,body,version:run.followup_draft?.version || 0,source_revision:run.followup_revision};
}

export const followupText=draft=>`Subject: ${draft.subject}\n\n${draft.body}`;

export function weeklySummary(result){
 return [`Weekly review · ${result.period_start} to ${result.period_end}`,`Completion dates: ${result.time_zone}`,'',
  `Currently done, completed in this period: ${result.counts.completed}`,`Overdue now: ${result.counts.overdue}`,
  `Open tasks due ${result.today} through ${result.upcoming_through}: ${result.counts.upcoming}`,
  `Unfinished reviews: ${result.counts.reviews}`,`Open tasks without a deadline: ${result.counts.undated}`,'',
  'Counts reflect current plans and progress. Earlier plan versions and reopened tasks are excluded.'].join('\n');
}
