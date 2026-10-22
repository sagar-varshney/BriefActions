import React,{useEffect,useRef,useState} from 'react';
import Icon from './Icon.jsx';

const examples=[
 {id:'checklist',task:'Share the launch checklist',owner:'Maya',deadline:'2026-10-17',speaker:'Maya',quote:'I’ll share the launch checklist tomorrow.'},
 {id:'notes',task:'Review the release notes',owner:'',deadline:'',speaker:'Alex',quote:'Please review the release notes.'}
];
const initialDrafts=()=>examples.map(({id,owner,deadline})=>({id,owner,deadline,keep:true}));
function dateLabel(value){
 if(!value)return 'Unknown';
 const date=new Date(`${value}T00:00:00Z`);
 return Number.isNaN(date.getTime())?value:new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(date);
}
const steps=['Transcript','Review','Action plan'];

function TaskDetails({task}){
 return <dl><div><dt><Icon name="owner" size={14}/>Owner</dt><dd>{task.owner.trim()||'Unknown'}</dd></div><div><dt><Icon name="calendar" size={14}/>Deadline</dt><dd>{dateLabel(task.deadline)}</dd></div></dl>;
}

export default function LandingDemo({href}){
 const [step,setStep]=useState(0),[drafts,setDrafts]=useState(initialDrafts),[active,setActive]=useState('checklist'),[editing,setEditing]=useState(null),[plan,setPlan]=useState(null);
 const heading=useRef(null),sourceHeading=useRef(null),focusHeading=useRef(false);
 const selected=drafts.filter(task=>task.keep).length;
 useEffect(()=>{if(focusHeading.current){(step===0?sourceHeading:heading).current?.focus();focusHeading.current=false;}},[step]);
 function goTo(next,focus=false){
  if(next===step){if(focus)(next===0?sourceHeading:heading).current?.focus();return;}
  focusHeading.current=focus;setStep(next);
 }
 function change(id,patch){setDrafts(items=>items.map(item=>item.id===id?{...item,...patch}:item));setPlan(null);}
 function reset(){setDrafts(initialDrafts());setActive('checklist');setEditing(null);setPlan(null);goTo(0,true);}
 function confirm(){if(!selected)return;setPlan(drafts.filter(task=>task.keep).map(task=>({...task,owner:task.owner.trim()})));goTo(2,true);}
 return <section className="landing-demo landing-light" id="product-demo" aria-labelledby="demo-title">
  <div className="landing-demo-bar"><div><span className="demo-dot" aria-hidden="true"/><h2 id="demo-title">Try a conversation. See the plan.</h2></div><span className="badge neutral">Interactive example</span></div>
  <div className="demo-stepbar"><ol aria-label="Demo steps">{steps.map((label,index)=><li key={label}><button type="button" aria-current={step===index?'step':undefined} disabled={index===2&&!plan} aria-controls="demo-stage" onClick={()=>goTo(index,true)}><span className="demo-step-number" aria-hidden="true">{index+1}</span>{label}</button></li>)}</ol><button type="button" className="text-button demo-reset" onClick={reset}>Reset demo</button></div>
  <div className="landing-demo-grid">
   <div className="landing-demo-source"><div className="eyebrow">THE ORIGINAL WORDS</div><h3 ref={sourceHeading} tabIndex={-1}>Product check-in</h3><p className="form-hint">Sample meeting · 16 October 2026</p><div className="demo-conversation">{examples.map(item=><p key={item.id} className={step>0&&active===item.id?'demo-source-active':''}><strong>{item.speaker}</strong><span>{item.quote}</span></p>)}</div><div className="demo-context"><Icon name="calendar" size={18}/><p><strong>The date gives context.</strong> “Tomorrow” means 17 October in this meeting.</p></div><p className="demo-source-note">Alex asks for a review, but doesn’t name a person or a deadline. Those details stay Unknown.</p></div>
   <div className="landing-demo-tasks" id="demo-stage">
    <div className="demo-stage-content" key={step}>
     <p className="eyebrow accent">STEP {step+1} OF 3</p>
     <h3 ref={heading} tabIndex={-1}>{['Start with what was said.','Check the details. Make the call.','Your plan, ready to use.'][step]}</h3>
     {step===0&&<><p className="demo-stage-intro">A short conversation can hold several next steps. See how the words become a plan you control.</p><ul className="demo-preview"><li><span><Icon name="extract"/></span><div><strong>Find the proposed tasks</strong><p>Two possible actions in this conversation.</p></div></li><li><span><Icon name="quote"/></span><div><strong>Check against the source</strong><p>Owners and dates need supporting words.</p></div></li><li><span><Icon name="check"/></span><div><strong>Choose what goes into the plan</strong><p>Keep, correct, or leave out a task.</p></div></li></ul><button type="button" className="button primary demo-next" onClick={()=>goTo(1,true)}>See suggested tasks<Icon name="arrow" size={17}/></button><p className="demo-small-note">A prepared example, not a live analysis.</p></>}
     {step===1&&<><p className="demo-stage-intro">Try changing a detail or unchecking a task. Unknown values are fine to keep.</p><div className="demo-task-list">{examples.map((item,index)=>{
      const draft=drafts[index],open=editing===item.id;
      return <article className={`demo-task ${active===item.id?'demo-task-active':''}`} key={item.id} aria-label={item.task}>
       <div className="demo-task-title"><span aria-hidden="true">0{index+1}</span><h4>{item.task}</h4></div><label className="demo-keep"><input type="checkbox" checked={draft.keep} onChange={event=>change(item.id,{keep:event.target.checked})}/>Keep task {index+1}</label>
       <TaskDetails task={draft}/>
       <div className="demo-task-actions"><button type="button" className="text-button" aria-expanded={open} aria-controls={`demo-edit-${item.id}`} onClick={()=>setEditing(open?null:item.id)}>{open?'Close details':'Edit details'}<span className="sr-only"> for {item.task}</span><Icon name="changed" size={14}/></button><button type="button" className="text-button" aria-pressed={active===item.id} aria-controls={`demo-evidence-${item.id}`} onClick={()=>setActive(item.id)}>Show supporting passage<span className="sr-only"> for {item.task}</span><Icon name="quote" size={14}/></button></div>
       <div className="demo-edit" id={`demo-edit-${item.id}`} hidden={!open}><label>Owner<input type="text" aria-label={`Demo owner for ${item.task}`} value={draft.owner} placeholder="Unknown" maxLength={60} onChange={event=>change(item.id,{owner:event.target.value})}/></label><label>Deadline<input type="date" aria-label={`Demo deadline for ${item.task}`} value={draft.deadline} onChange={event=>change(item.id,{deadline:event.target.value})}/></label><p>Your edits change this demo plan. The original conversation stays unchanged.</p></div>
       <blockquote className="demo-evidence" id={`demo-evidence-${item.id}`} hidden={active!==item.id}><p>“{item.quote}”</p><cite>{item.speaker} · original transcript</cite></blockquote>
      </article>;
     })}</div><div className="demo-review-footer"><p role="status">{selected} of 2 tasks selected</p><button type="button" className="button primary demo-next" disabled={!selected} onClick={confirm}>Build sample plan<Icon name="arrow" size={17}/></button></div>{!selected&&<p className="demo-small-note">Keep at least one task to build the sample plan.</p>}</>}
     {step===2&&plan&&<><p className="demo-stage-intro">{plan.length} selected {plan.length===1?'task':'tasks'} from Product check-in. Here’s the plan you just reviewed.</p><ol className="demo-plan-list">{plan.map(task=>{
      const original=examples.find(item=>item.id===task.id),corrected=task.owner!==original.owner||task.deadline!==original.deadline;
      return <li className="demo-plan-task" key={task.id}><div className="demo-task-title"><Icon name="check" size={19}/><h4>{original.task}</h4></div><TaskDetails task={task}/>{corrected&&<p className="demo-correction"><Icon name="changed" size={14}/>Details changed during this demo review.</p>}<details><summary>Supporting passage<span className="sr-only"> for {original.task}</span></summary><blockquote className="demo-evidence"><p>“{original.quote}”</p><cite>{original.speaker} · original transcript</cite></blockquote></details></li>;
     })}</ol><p className="demo-plan-note"><Icon name="check" size={17}/>Only the tasks you kept appear in this plan.</p><div className="demo-complete-actions"><a className="button primary demo-next" href={href}>Try with your meeting<Icon name="arrow" size={17}/></a><button type="button" className="text-button" onClick={()=>goTo(1,true)}>Back to review</button></div></>}
    </div>
   </div>
  </div>
  <p className="landing-demo-caption">Invented meeting. Demo edits are cleared on reload. Nothing is saved to your workspace.</p>
 </section>;
}
