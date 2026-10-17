import React,{useEffect,useRef,useState} from 'react';
export default function ConfirmErasure({target,onCancel,onConfirm}){
  const ref=useRef(null),cancelRef=useRef(null),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const phrase=target.account?'DELETE MY ACCOUNT':'DELETE TRANSCRIPT';
  useEffect(()=>{const dialog=ref.current,previous=document.activeElement;dialog.showModal();cancelRef.current.focus();return()=>{dialog.close();if(previous?.isConnected)previous.focus();};},[]);
  return <dialog ref={ref} className="erasure-dialog" aria-labelledby="erase-title" aria-describedby="erase-details" onCancel={e=>{if(busy)e.preventDefault();else onCancel();}}>
    <h2 id="erase-title">{target.account?'Delete your account?':'Delete this transcript?'}</h2>
    <p id="erase-details">{target.account?'Your stored transcripts, reviews, drafts, and comparison reports will be erased, and your sign-in account removed. If sign-in removal fails, the workspace stays paused until you retry.':target.kind==='annotation_input'?'This annotation input and its reviews will be erased. Frozen snapshots and saved comparisons containing it will also be removed. Other annotation cases are kept.':'This extraction, its supporting transcript, drafts, review decisions, and confirmed plan will be permanently erased. All follow-up versions containing a copy of this transcript will also be erased.'}</p>
    {!target.account&&<p className="erasure-target"><strong>{target.label}</strong><br/>{target.preview}<br/><small>Input {target.id.slice(0,8)}</small></p>}
    <p>Downloaded exports and previous backups are separate copies. This action cannot be undone in the app.</p>
    {error&&<div className="notice error" role="alert">{error}</div>}
    <form onSubmit={async e=>{e.preventDefault();if(text!==phrase)return;setBusy(true);setError('');try{await onConfirm(phrase);}catch(error){setError(error.message);setBusy(false);}}}>
      <label className="field-label">Type {phrase}<input aria-label="Deletion confirmation" autoComplete="off" value={text} onChange={e=>setText(e.target.value)} disabled={busy}/></label>
      <div className="dialog-actions"><button ref={cancelRef} type="button" className="button secondary" disabled={busy} onClick={onCancel}>Cancel</button><button className="button danger" disabled={busy || text!==phrase}>{busy?'Deleting…':target.account?'Delete my account':'Delete transcript'}</button></div>
    </form>
  </dialog>;
}
