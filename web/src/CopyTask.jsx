import React,{useEffect,useId,useRef,useState} from 'react';

export default function CopyTask({task}){
 const [busy,setBusy]=useState(false),[copied,setCopied]=useState(false),[manual,setManual]=useState(false),preview=useRef(null),previewId=useId();
 const text=`Task: ${task.task}\nOwner: ${task.owner}\nDeadline: ${task.deadline}`;
 useEffect(()=>{if(manual){preview.current?.focus();preview.current?.select();}},[manual]);
 async function copy(){
  if(busy)return;
  setBusy(true);setCopied(false);setManual(false);
  try{await navigator.clipboard.writeText(text);setCopied(true);}
  catch{setManual(true);}
  finally{setBusy(false);}
 }
 return <div className="task-copy-control">
  <button className="button secondary" type="button" aria-disabled={busy} aria-label={`${busy?'Copying…':'Copy task'}: ${task.task}`} onClick={copy}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></svg>{busy?'Copying…':'Copy task'}</button>
  {copied&&<p className="form-hint" role="status">Task copied.</p>}
  {manual&&<><p className="form-hint" role="alert">Clipboard access is unavailable. Copy the selected task text manually.</p><label className="field-label" htmlFor={previewId}>Task text to copy</label><textarea id={previewId} ref={preview} readOnly value={text} rows={5}/><button className="text-button" type="button" onClick={()=>{preview.current?.focus();preview.current?.select();}}>Select task text</button></>}
 </div>;
}
