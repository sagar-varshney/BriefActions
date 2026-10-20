import accountStorage from './accountStorage.js';
import React,{useEffect,useRef,useState} from 'react';
const fresh=()=>({task:'',owner:'Unknown',deadline:'Unknown',evidence:[],selection:null,request_id:crypto.randomUUID().replaceAll('-','')});

export default function MissedActionForm({run,busy,onAdd}) {
  const key=`flow.missedAction.${run.id}`;
  const load=()=>{try{return JSON.parse(accountStorage.getItem(key)||'null')||fresh();}catch{return fresh();}};
  const [entry,setEntry]=useState(load),[error,setError]=useState(''),[saving,setSaving]=useState(false),[notice,setNotice]=useState('');
  const current=useRef(entry);
  useEffect(()=>{const value=load();current.current=value;setEntry(value);setError('');setNotice('');},[run.id]);
  function update(patch){const value={...current.current,...patch,request_id:crypto.randomUUID().replaceAll('-','')};current.current=value;setEntry(value);try{accountStorage.setItem(key,JSON.stringify(value));setNotice('Unfinished entry saved in this browser.');}catch{setNotice('Browser storage unavailable. Keep this page open until the action is added.');}}
  function selected(e){const el=e.currentTarget;if(el.selectionStart===el.selectionEnd)return;update({selection:{text:el.value.slice(el.selectionStart,el.selectionEnd),start:Array.from(el.value.slice(0,el.selectionStart)).length,end:Array.from(el.value.slice(0,el.selectionEnd)).length}});}
  const support=[...entry.evidence,...(entry.selection?[entry.selection]:[])].filter((e,i,a)=>a.findIndex(v=>v.start===e.start&&v.end===e.end)===i);
  async function submit(e){e.preventDefault();setError('');setSaving(true);try{
    await onAdd({item:{task:entry.task,owner:entry.owner,deadline:entry.deadline,evidence:support},request_id:entry.request_id});
    accountStorage.removeItem(key);const value=fresh();current.current=value;setEntry(value);setNotice('User-added proposal saved. Select it above to keep it in the plan.');
  }catch(e){setError(e.message);}finally{setSaving(false);}}
  return <form id="missed-action-form" className="panel annotation-panel missed-action-panel" onSubmit={submit} aria-label="Add a missed action">
    <h2 tabIndex={-1}>Add a missed action</h2><p>Highlight the words in the saved conversation that support the task, then describe the agreed work. It becomes an unchecked proposal; select it above to include it in your plan.</p>
    {error&&<div className="notice error" role="alert">{error}</div>}
    <label className="field-label">Saved transcript for missed action<textarea aria-label="Saved transcript for missed action" readOnly value={run.transcript} className="transcript" disabled={busy||saving} onSelect={selected}/></label>
    {entry.selection&&<blockquote>{entry.selection.text}</blockquote>}
    <button type="button" className="button secondary" disabled={busy||saving||!entry.selection||entry.evidence.length>=20} onClick={()=>update({evidence:support,selection:null})}>Attach selected passage</button>
    {entry.evidence.map((e,i)=><div key={i}><blockquote>{e.text}</blockquote><button type="button" className="text-button" disabled={busy||saving} onClick={()=>update({evidence:entry.evidence.filter((_,n)=>n!==i)})}>Remove passage {i+1}</button></div>)}
    <label className="field-label">Missed action task<input aria-label="Missed action task" required maxLength={10000} value={entry.task} disabled={busy||saving} onChange={e=>update({task:e.target.value})}/></label>
    <div className="field-row"><label className="field-label">Missed action owner<input aria-label="Missed action owner" required value={entry.owner} disabled={busy||saving} onChange={e=>update({owner:e.target.value})}/></label><label className="field-label">Missed action deadline<input aria-label="Missed action deadline" required value={entry.deadline} placeholder="YYYY-MM-DD or Unknown" disabled={busy||saving} onChange={e=>update({deadline:e.target.value})}/></label></div>
    <p className="field-hint">Use Unknown for missing owners or exact dates. Evidence quotes must come from the saved input; human review decides whether they support the action.</p>
    <button className="button primary" disabled={busy||saving||!support.length}>{saving?'Adding…':'Add action proposal'}</button>{notice&&<p role="status" className="form-hint">{notice}</p>}
  </form>;
}
