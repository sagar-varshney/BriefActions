import React,{useEffect,useId,useRef,useState} from 'react';
import {api} from './api.js';
import accountStorage from './accountStorage.js';
import {followupMessage,followupText} from './followupMessage.js';

const clean=d=>d && typeof d.subject==='string' && d.subject.length<=300 && !/[\r\n]/.test(d.subject) && typeof d.body==='string' && d.body.length<=100_000 && Number.isInteger(d.version) && d.version>=0 && /^[a-f0-9]{64}$/.test(d.source_revision);
export default function FollowupDraft({run,client,onUpdate,disabled}){
 const key=`flow.followupDraft.${client}.${run.id}`,id=useId(),manualRef=useRef(null),alive=useRef(true);
 const [initial]=useState(()=>{try{const cached=JSON.parse(accountStorage.getItem(key)||'null');if(clean(cached?.draft)){
   if(cached.pending?.request_id===run.followup_draft?.request_id)return {draft:run.followup_draft,pending:null};
   return {draft:cached.draft,pending:cached.pending && /^[a-f0-9]{32}$/.test(cached.pending.request_id)?cached.pending:null};
  }}catch{}return {draft:run.followup_draft,pending:null};});
 const [draft,setDraft]=useState(initial.draft),[pending,setPending]=useState(initial.pending),[open,setOpen]=useState(!!initial.pending),[saving,setSaving]=useState(false),[checking,setChecking]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[replace,setReplace]=useState(false),[manual,setManual]=useState(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(manual){manualRef.current?.focus();manualRef.current?.select();}},[manual]);
 const saved=run.followup_draft,conflict=!!draft && draft.version!==(saved?.version || 0),stale=!!draft && draft.source_revision!==run.followup_revision,locked=disabled||saving||checking||!!pending||!!run.superseded_by;
 const dirty=!!draft && ['subject','body','source_revision'].some(k=>draft[k]!==saved?.[k]);
 function cache(value,request=null){try{accountStorage.setItem(key,JSON.stringify({draft:value,pending:request}));return true;}catch{setError('Browser storage is unavailable. Keep this page open and copy your edits before leaving.');return false;}}
 function change(patch){const value={...draft,...patch};setDraft(value);setError('');setNotice('');setManual(false);cache(value);}
 function generate(){try{const value=followupMessage(run);setDraft(value);setPending(null);setReplace(false);setError('');setNotice('Draft prepared from the current confirmed tasks. Check it before sharing.');setManual(false);cache(value);}catch(e){setError(e.message);}}
 async function refresh(){setChecking(true);setError('');try{const value=await api(`/runs/${run.id}`);if(alive.current){onUpdate(value);setNotice('Meeting refreshed. Your message edits are preserved.');}}catch(e){if(alive.current)setError(e.message);}finally{if(alive.current)setChecking(false);}}
 async function save(request=pending){
  if(saving || disabled)return;
  const payload=request || {...draft,request_id:crypto.randomUUID().replaceAll('-','')};
  if(!cache(draft,payload))return;
  setPending(payload);setSaving(true);setError('');setNotice('');
  try{const value=await api(`/runs/${run.id}/followup-draft`,{method:'POST',body:JSON.stringify(payload)});if(alive.current){setDraft(value.followup_draft);setPending(null);cache(value.followup_draft);onUpdate(value);setNotice('Follow-up draft saved to your workspace.');}}
  catch(e){if(alive.current){setError(e.message);if(!e.retryable){setPending(null);cache(draft);}}}
  finally{if(alive.current)setSaving(false);}
 }
 async function copy(){
  if(locked || stale || conflict)return;
  setChecking(true);setError('');setNotice('');setManual(false);
  try{
   const value=await api(`/runs/${run.id}`);if(!alive.current)return;
   onUpdate(value);
   if(value.superseded_by || value.followup_revision!==draft.source_revision || (value.followup_draft?.version || 0)!==draft.version){setError('The meeting or saved draft changed. Check the refreshed details before copying.');return;}
   try{await navigator.clipboard.writeText(followupText(draft));if(alive.current)setNotice('Follow-up copied. Review recipients and text in the app where you share it.');}
   catch{if(alive.current){setManual(true);setNotice('Clipboard access is unavailable. Select and copy the follow-up text below.');}}
  }catch(e){if(alive.current)setError(e.message);}finally{if(alive.current)setChecking(false);}
 }
 return <details className="panel followup-message" open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary>Draft follow-up</summary>
  <p>Prepare an editable message from confirmed tasks, current progress, and corrected deadlines. Missing details stay Unknown. Save it to your workspace or copy it when ready.</p>
  {run.superseded_by?<p className="notice">This is an earlier plan. Open its latest version to prepare a follow-up.</p>:!draft?<button className="button secondary" disabled={disabled} type="button" onClick={generate}>Create follow-up draft</button>:null}
  {draft&&<>
   {conflict&&<div className="notice" role="alert"><p>A newer saved draft is available. Compare it before choosing which text to keep.</p><details><summary>Read saved follow-up</summary><pre className="followup-saved">{saved?followupText(saved):'No saved draft.'}</pre></details><div className="followup-actions"><button className="button secondary" type="button" disabled={locked} onClick={()=>{setDraft(saved);cache(saved);setManual(false);setError('');}}>Use saved draft</button><button className="button secondary" type="button" disabled={locked} onClick={()=>change({version:saved?.version || 0})}>Keep my edits</button></div></div>}
   {stale&&!run.superseded_by&&<div className="notice" role="status"><p>Task details changed since this draft was prepared. Check the current tasks below, then update the message or regenerate it.</p><button type="button" className="button secondary" disabled={locked} onClick={()=>change({source_revision:run.followup_revision})}>I’ve checked the current tasks</button></div>}
   <label className="field-label" htmlFor={`${id}-subject`}>Follow-up subject</label><input id={`${id}-subject`} aria-label="Follow-up subject" value={draft.subject} maxLength={300} disabled={locked} onChange={event=>change({subject:event.target.value.replace(/[\r\n]/g,' ')})}/>
   <label className="field-label" htmlFor={`${id}-body`}>Follow-up message</label><textarea id={`${id}-body`} aria-label="Follow-up message" value={draft.body} maxLength={100_000} rows={14} disabled={locked} onChange={event=>change({body:event.target.value})}/>
   {!run.superseded_by&&<div className="followup-actions"><button className="button primary" type="button" disabled={locked||stale||conflict||!draft.subject.trim()||!draft.body.trim()||!dirty} onClick={()=>save(null)}>Save follow-up draft</button><button className="button secondary" type="button" disabled={locked||stale||conflict||!draft.subject.trim()||!draft.body.trim()} onClick={copy}>Copy follow-up</button><button className="text-button" type="button" disabled={locked} onClick={()=>setReplace(true)}>Regenerate from current tasks</button><button className="text-button" type="button" disabled={saving||checking||!!pending} onClick={refresh}>Refresh meeting details</button></div>}
   {replace&&<div className="notice" role="status"><p>Replace the message you’re editing with a new draft from current tasks? Previously saved versions stay in Activity.</p><div className="followup-actions"><button className="button secondary" type="button" disabled={locked} onClick={generate}>Replace message</button><button className="text-button" type="button" onClick={()=>setReplace(false)}>Keep editing</button></div></div>}
   <p className="form-hint">{dirty?'Unsaved edits are kept in this browser and tab; choose Save follow-up draft to sync them to your workspace.':'The saved draft is available on your other devices.'} Message edits do not change the plan.</p>
  </>}
  {pending&&<div className="notice" role="status"><p>A draft save is waiting for recovery. Retry the same request to check its result.</p><button className="button secondary" type="button" disabled={saving||disabled} onClick={()=>save(pending)}>{saving?'Saving follow-up…':'Retry follow-up save'}</button></div>}
  {error&&<p className="notice error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {manual&&draft&&<><label className="field-label" htmlFor={`${id}-copy`}>Follow-up text to copy</label><textarea id={`${id}-copy`} aria-label="Follow-up text to copy" ref={manualRef} readOnly rows={12} value={followupText(draft)}/><button className="text-button" type="button" onClick={()=>{manualRef.current?.focus();manualRef.current?.select();}}>Select follow-up text</button></>}
 </details>;
}
