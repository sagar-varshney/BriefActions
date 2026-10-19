import useAfterRender from './useAfterRender.js';
import React,{useEffect,useRef,useState} from 'react';
const guides={
 meetings:{label:'Meeting tasks',page:'extract',steps:[
  ['Add a conversation','Paste a transcript, import a file, or use Try an example. Choose the meeting date so words like “tomorrow” can be understood.','The example is invented. Loading it does not start analysis.'],
  ['Check suggested tasks','Click Analyze transcript to save the input and get suggestions. Open Edit & evidence to correct a task, owner, or date. Locate passage shows the original words.','Unknown means no value was identified. Check the source before filling it in.'],
  ['Choose what to keep','Select the tasks you want, then confirm your selection. Unselected suggestions are rejected. Review edits save automatically before confirmation.','Confirmation locks this plan. Editing the transcript later creates a separate analysis when you submit it.'],
  ['Follow through','Set tasks to To do, In progress, or Done. Correct deadline changes a date with a required reason while Activity keeps its history. Use All tasks to see confirmed work across meetings, or Meeting history to return to one conversation. Copy or download your confirmed action plan, and use Activity to see what changed.','Progress updates preserve the confirmed task and its original evidence.']
 ]},
 today:{label:'My day',page:'today',steps:[
  ['Choose your next step','My day brings together overdue tasks, today’s deadlines, the next seven days, and saved reviews waiting for confirmation. It includes every named owner in your private workspace.','Completed tasks are excluded. Dates use your device’s calendar day.'],
  ['Open the complete list','Each section previews a few items. View all opens the corresponding task filter or the meetings awaiting review. Open task & evidence goes straight to the saved task and its supporting conversation.','A task without a deadline stays Unknown. Calendar’s Unscheduled list keeps that work visible.'],
  ['Pick up where you left off','Continue review opens your saved proposals and corrections. Add a conversation starts the transcript workflow. Return to My day or use Refresh My day to see the latest saved changes.','Reading this overview does not confirm a review or change any task.']
 ]},
 calendar:{label:'Calendar',page:'calendar',steps:[
  ['Find a date','Open a month and select a date. Meeting cards use the conversation date; task cards use confirmed deadlines. On small screens, the agenda lists dates with events.','The calendar does not schedule a time of day or send reminders.'],
  ['Inspect the conversation','Open a meeting to see its transcript, or open a task to inspect its confirmed plan and supporting passage. Use browser Back to return to the same calendar view.','Task status filters affect tasks only. Earlier meetings remain visible, while task deadlines follow the current confirmed plan.'],
  ['Check unscheduled work','The Unscheduled list shows confirmed tasks whose deadline is Unknown, across all months. Use the status filter and page controls to find more work.','Viewing the calendar never assigns dates or changes your plan.']
 ]},
 annotations:{label:'Label examples',page:'annotations',steps:[
  ['Choose an example','Add practice examples or a conversation you have permission to use. An example is one conversation with a meeting date.','Practice imports exclude the original answers, so a reviewer can start independently.'],
  ['Write the expected tasks','Open an example and start a review with your reviewer name. Select the exact words in the conversation, enter the task, owner, and date, then add the action.','Select text using a mouse, touch selection, or Shift + Left/Right arrow keys in the conversation box. Leave missing information Unknown.'],
  ['Review and lock the answers','Submit your review before comparing answers. Ask a separate person to review independently. Resolve disagreements, then lock the agreed example set for comparison.','Using a different reviewer name does not make your own second review independent. Locked answers cannot be edited.']
 ]},
 benchmark:{label:'Compare methods',page:'benchmark',steps:[
  ['Choose examples to test','The bundled datasets contain invented conversations with expected tasks. Practice examples help improve a method; reserved test examples are kept separate to check it afterwards.','An extraction method is the approach that finds tasks, such as rules or a language model.'],
  ['Read the counts first','Compare tasks found, extra suggestions, owner/date matches, response time, fees, and failures. Click a method name to inspect individual examples.','An extra suggestion did not match an expected task. That alone does not prove the transcript cannot support it.'],
  ['Inspect before choosing','Compare expected tasks with the method’s suggestions and the original conversation. Detailed scores explain matching and passage checks. You can also compare your own locked, reviewed example sets.','These measurements describe the selected examples. They do not establish accuracy on all real meetings.']
 ]}
};
export default function HelpGuide({initialTopic='meetings',onClose,onNavigate,navigationDisabled}){
 const [topic,setTopic]=useState(initialTopic),[step,setStep]=useState(0),ref=useRef(null),heading=useRef(null),close=useRef(null);
 useEffect(()=>{const dialog=ref.current,previous=document.activeElement;dialog.showModal();close.current.focus();return()=>{dialog.close();if(previous?.isConnected)previous.focus();};},[]);
 function move(index){setStep(index);afterRender(()=>{heading.current?.focus();heading.current?.scrollIntoView({block:'nearest'});});}
 const afterRender=useAfterRender();
 const guide=guides[topic],current=guide.steps[step];
 return <dialog ref={ref} className="help-dialog" aria-labelledby="help-title" onKeyDown={event=>{if(event.key!=='Tab')return;const controls=[...ref.current.querySelectorAll('button:not(:disabled),select:not(:disabled),summary,a[href],[tabindex="0"]')].filter(el=>el.getClientRects().length);const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}} onCancel={event=>{event.preventDefault();onClose();}}>
  <div className="help-header"><div><div className="eyebrow accent">A QUICK WALKTHROUGH</div><h2 id="help-title">Help & getting started</h2></div><button ref={close} className="text-button" type="button" onClick={onClose}>Close guide</button></div>
  <p>Choose a guide. Reading it does not change your meetings or start any work.</p>
  <label className="field-label">Walkthrough<select aria-label="Walkthrough" value={topic} onChange={event=>{setTopic(event.target.value);setStep(0);}}>{Object.entries(guides).map(([key,g])=><option key={key} value={key}>{g.label}</option>)}</select></label>
  <section className="guide-step" aria-labelledby="guide-step-title"><p className="eyebrow" role="status">Step {step+1} of {guide.steps.length}</p><h3 id="guide-step-title" ref={heading} tabIndex={-1}>{current[0]}</h3><p>{current[1]}</p><p className="guide-example">{current[2]}</p></section>
  <div className="guide-actions"><button type="button" className="button secondary" disabled={step===0} onClick={()=>move(step-1)}>Previous step</button>{step<guide.steps.length-1?<button type="button" className="button primary" onClick={()=>move(step+1)}>Next step</button>:<button type="button" className="button primary" onClick={onClose}>Finish guide</button>}<button type="button" className="text-button" onClick={onClose}>Skip walkthrough</button></div>
  <button type="button" className="text-button guide-open" disabled={navigationDisabled} onClick={()=>{onClose();onNavigate(guide.page);}}>Open {guide.label.toLowerCase()} workspace</button>
  <details className="guide-glossary"><summary>Words used in this app</summary><dl>
   <dt>Supporting passage (evidence)</dt><dd>The exact words linked to a suggested task. Your correction is recorded separately from the original passage.</dd>
   <dt>Example dataset (corpus)</dt><dd>A collection of conversations used to check extraction, with expected answers where available.</dd>
   <dt>Expected tasks (gold labels)</dt><dd>The reference answers used for comparison. Draft answers can contain mistakes; independent reviews help check them.</dd>
   <dt>Practice / reserved test examples (development / held out)</dt><dd>Improve a method using practice examples. Keep test examples separate until checking the result. Repeatedly tuning on them makes them less useful as an independent check.</dd>
   <dt>Instructions version (prompt)</dt><dd>The instructions given to a language model. Changing them can change its suggestions.</dd>
   <dt>Detection score (F1)</dt><dd>A combined score for finding expected tasks and avoiding extra suggestions. Higher is better on the tested examples; it is not a guarantee of correctness.</dd>
   <dt>Typical / slower response time (p50 / p95)</dt><dd>Half the measured requests finish within p50; 95% finish within p95. Lower is faster.</dd>
   <dt>Expected passage match (support proxy)</dt><dd>Checks task, owner, date, and annotated passage matches. It is an approximate check, not a judgement that the conversation logically supports the task.</dd>
  </dl></details>
 </dialog>;
}
