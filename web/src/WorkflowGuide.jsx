import React from 'react';
export function jumpTo(id){const target=document.getElementById(id);target?.focus({preventScroll:true});target?.scrollIntoView({block:'start',behavior:'instant'});}
export default function WorkflowGuide({id,title,description,steps,onHelp,children}){
 return <section className="workflow-guide" aria-labelledby={id}><div className="workflow-guide-heading"><div><h2 id={id}>{title}</h2><p>{description}</p></div><button type="button" className="text-button" onClick={onHelp}>Walk me through this</button></div><ol>{steps.map(step=><li key={step.title}><strong>{step.title}</strong><p>{step.text}</p>{step.target&&<button className="text-button" type="button" onClick={()=>jumpTo(step.target)}>{step.action}</button>}</li>)}</ol>{children}</section>;
}
