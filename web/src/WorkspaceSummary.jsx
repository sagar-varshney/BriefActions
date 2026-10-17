import React from 'react';
export default function WorkspaceSummary({run,drafts,selected}){
  if(!run)return null;
  const confirmed=run.status==='confirmed',items=confirmed?run.final_tasks:drafts;
  const missing=items.filter(item=>!item.owner?.trim() || item.owner.trim()==='Unknown' || !item.deadline?.trim() || item.deadline.trim()==='Unknown').length;
  const cards=[
    [run.settings?.plan_update?'Compared tasks':'Proposed actions',run.proposals.length,run.settings?.plan_update?'Tasks in the follow-up comparison':'Extracted and user-added proposals'],
    [confirmed?'Confirmed tasks':'Selected tasks',confirmed?run.final_tasks.length:selected,confirmed?'Saved in your final plan':'You choose what makes the plan'],
    ['Need owner or date',missing,confirmed?'Across confirmed tasks':'Across all review proposals'],
    ['Supporting passages',run.proposals.reduce((n,p)=>n+p.evidence.length,0),'Attached to the original proposals'],
  ];
  return <section className="workspace-summary" aria-label="Current meeting summary">{cards.map(([label,value,note])=><div className="metric-card" key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>)}</section>;
}
