import React from 'react';
import Icon from './Icon.jsx';

export function focusMeetingStep(run){
 const id=!run?'transcript':run.status==='confirmed'?'confirmed-plan-title':run.settings?.plan_update?'plan-comparison-title':'task-review-title';
 const target=document.getElementById(id);
 if(target&&!target.disabled&&target.getClientRects().length){target.focus({preventScroll:true});target.scrollIntoView({block:'center',behavior:'instant'});}else document.querySelector('.help-entry')?.focus({preventScroll:true});
}

export default function MeetingTips({run,disabled,onHide,onHelp}){
 const step=!run?0:run.status==='confirmed'?2:1;
 const tips=[
  {title:'Add your conversation.',text:'Paste a transcript or import a file, then choose the meeting date. Analyze transcript saves it and finds suggestions for you to review.',action:'Go to transcript'},
  run?.settings?.plan_update?{title:'Review changes to your existing plan.',text:'Compare the follow-up conversation with your previous plan. Check the supporting words and approve the changes you want. Existing tasks stay unless you approve a change and confirm the updated plan.',action:'Go to plan changes'}:{title:'Check the suggestions before keeping them.',text:'A proposal is a suggested task. Check its original words, correct the owner or deadline if needed, and choose which tasks to keep. Unknown details are allowed.',action:'Go to task review'},
  {title:'Your plan is confirmed.',text:run?.final_tasks?.length===0?'You confirmed an empty plan, so no tasks were added. Check the conversation if you expected work to keep.':'Your selected tasks are saved. Update their progress here, find work in All tasks, or check deadlines in Calendar.',action:'Go to confirmed plan'}
 ],current=tips[step];
 return <section className="meeting-tips" aria-labelledby="meeting-tips-title"><div className="meeting-tips-heading"><p className="eyebrow accent" role="status">MEETING TIPS · STEP {step+1} OF 3</p><button className="text-button" type="button" onClick={onHide}>Hide meeting tips<Icon name="cancelled" size={14}/></button></div><h2 id="meeting-tips-title" tabIndex={-1}>{current.title}</h2><p>{current.text}</p><div className="meeting-tips-actions"><button className="button secondary" type="button" disabled={disabled} onClick={()=>focusMeetingStep(run)}>{current.action}<Icon name="arrow" size={16}/></button><button className="text-button" type="button" onClick={onHelp}>Read the walkthrough</button><small>Optional. Reopen these tips from Help.</small></div></section>;
}
