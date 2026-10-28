import React,{useEffect,useRef} from 'react';

export default function ReviewSelectionDialog({drafts,total,onClose,onConfirm}){
 const dialog=useRef(null),selected=drafts.filter(task=>task.accept);
 useEffect(()=>{const element=dialog.current,trigger=document.activeElement;element.showModal();element.querySelector('h2').focus();return()=>{element.close();if(trigger?.isConnected)trigger.focus({preventScroll:true});};},[]);
 function containFocus(event){
  if(event.key!=='Tab')return;
  const buttons=[...dialog.current.querySelectorAll('button:not(:disabled)')],first=buttons[0],last=buttons.at(-1);
  if(event.shiftKey&&(document.activeElement===first||document.activeElement.tagName==='H2')){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
 }
 return <dialog ref={dialog} className="selection-dialog" aria-labelledby="selection-dialog-title" onKeyDown={containFocus} onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{const box=event.currentTarget.getBoundingClientRect();if(event.target===event.currentTarget&&(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom))onClose();}}>
  <div className="eyebrow accent">BEFORE YOU CONFIRM</div><h2 id="selection-dialog-title" tabIndex={-1}>Review your selection</h2>
  <p>{selected.length} of {total} suggested tasks will enter your plan. {total-selected.length} will be excluded.</p>
  {selected.length?<ol className="selection-task-list">{selected.map(task=><li key={task.proposal_id}><strong>{task.task||'Untitled task'}</strong><span>Owner: {task.owner||'Not provided'} <span aria-hidden="true">·</span> Deadline: {task.deadline||'Not provided'}</span></li>)}</ol>:<p className="notice warning">No tasks are selected. Confirming will save an empty plan.</p>}
  <p className="form-hint">Unknown owners and deadlines are allowed. Your corrections and the original supporting conversation stay in the meeting history.</p>
  <div className="selection-dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Back to review</button><button type="button" className="button primary" onClick={onConfirm}>{selected.length?'Confirm selected tasks':'Confirm empty plan'}</button></div>
 </dialog>;
}
