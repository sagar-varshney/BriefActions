import React from 'react';
export default function WorkspaceSummary({run,drafts,selected}){
  if(!run)return null;
  const confirmed=run.status==='confirmed',items=confirmed?run.final_tasks:drafts;
  const missing=items.filter(item=>!item.owner?.trim() || item.owner.trim()==='Unknown' || !item.deadline?.trim() || item.deadline.trim()==='Unknown').length;
  const cards=[
    ['Proposed actions',run.proposals.length,'Extracted and user-added proposals','mint'],
    [confirmed?'Confirmed tasks':'Selected tasks',confirmed?run.final_tasks.length:selected,confirmed?'Saved in your final plan':'You choose what makes the plan','peach'],
    ['Need owner or date',missing,confirmed?'Across confirmed tasks':'Across all review proposals','lilac'],
    ['Supporting passages',run.proposals.reduce((n,p)=>n+p.evidence.length,0),'Attached to the original proposals','mint'],
  ];
  return <section className="workspace-summary" aria-label="Current meeting summary">{cards.map(([label,value,note,tone])=><div className={`metric-card ${tone}`} key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small><div className="metric-rule" aria-hidden="true"/></div>)}</section>;
}
