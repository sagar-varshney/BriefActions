import React,{useEffect,useState} from 'react';
import accountStorage from './accountStorage.js';
import {api,downloadFile} from './api.js';
import ConfirmErasure from './ConfirmErasure.jsx';
import StorageUsage from './StorageUsage.jsx';

export default function DataControls({completeAccountDeletion,onClosing}){
  const [status,setStatus]=useState(null),[entries,setEntries]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[target,setTarget]=useState(null),[page,setPage]=useState(0);
  async function refresh(){setError('');try{const value=await api('/account');setStatus(value);if(value.state==='active'){const [runs,cases]=await Promise.all([api('/runs'),api('/annotations')]);setEntries([...runs.map(r=>({...r,kind:'extraction',label:`Meeting ${r.reference_date}`,preview:r.preview})),...cases.map(c=>({...c,kind:'annotation_input',label:c.group,preview:`${c.source} annotation · ${c.status}`}))]);}else setEntries([]);return value;}catch(e){setError(e.message);}}
  useEffect(()=>{refresh();},[]);
  async function erase(confirmation){
    if(target.account){try{await api('/account/delete',{method:'POST',body:JSON.stringify({confirmation})});}catch(e){const value=await refresh();if(value?.state==='deleting'){accountStorage.clearWorkspace();onClosing();}throw e;}accountStorage.clearWorkspace();await completeAccountDeletion();return;}
    const result=await api(`/${target.kind==='extraction'?'runs':'annotations'}/${target.id}/delete`,{method:'POST',body:JSON.stringify({confirmation})});
    const ids=result.deleted_ids||[target.id];ids.forEach(id=>accountStorage.forgetInput(id,false));accountStorage.broadcastErasure(ids,target.id);location.hash='data';location.reload();
  }
  return <section aria-label="Data and account controls"><div className="page-intro"><div><div className="eyebrow accent">YOUR WORKSPACE, YOUR CONTROL</div><h1 tabIndex={-1}>Data & account.</h1><p>Export your workspace or permanently erase saved transcripts.</p></div></div>
    {error&&<div className="notice error" role="alert">{error}<button className="text-button" onClick={refresh}>Retry loading</button></div>}
    {status?.state==='deleting'&&<div className="notice warning" role="status">Your stored workspace data was erased. Sign-in account deletion is still pending. Retry below to finish.</div>}
    <StorageUsage storage={status?.storage} onRefresh={refresh}/>
    <section className="panel data-panel"><h2>Export my workspace</h2><p>Includes original inputs, extracted proposals, corrections, confirmed plans, annotation reviews, frozen splits, comparison reports, and server-saved drafts. Save unfinished browser edits before exporting.</p><button className="button secondary" disabled={!status || status.state!=='active' || busy} onClick={async()=>{setBusy(true);setError('');try{await downloadFile('/api/account/export');}catch(e){setError(e.message);}finally{setBusy(false);}}}>{busy?'Preparing export…':'Download workspace JSONL'}</button></section>
    {status?.state==='active'&&<section className="panel data-panel"><h2>Saved transcripts <span className="count">{entries.length}</span></h2><p>Deleting an extraction removes its plan, history, and all follow-up versions containing its transcript. Deleting an annotation also removes frozen datasets and comparisons containing it.</p>
      {!entries.length&&<p className="empty-state">No saved transcripts.</p>}{entries.slice(page*12,(page+1)*12).map(item=><article className="data-entry" key={item.id}><div><strong>{item.label}</strong><span className="badge neutral">{item.kind==='extraction'?'Extraction':'Annotation'}</span><p>{item.preview}</p><small>Input {item.id.slice(0,8)}</small></div><button className="button secondary" aria-label={`Delete ${item.kind==='extraction'?'extraction':'annotation'} ${item.id.slice(0,8)}`} onClick={()=>setTarget(item)}>Delete</button></article>)}
      {entries.length>12&&<div className="annotation-pagination"><button className="button secondary" disabled={!page} onClick={()=>setPage(p=>p-1)}>Previous inputs</button><span>Page {page+1} of {Math.ceil(entries.length/12)}</span><button className="button secondary" disabled={(page+1)*12>=entries.length} onClick={()=>setPage(p=>p+1)}>Next inputs</button></div>}
    </section>}
    {status?.can_delete_account&&<section className="panel data-panel"><h2>Delete my account</h2><p>Permanently erase this workspace and remove the account used to sign in. Download an export first if you want to keep your work.</p><button className="button danger" onClick={()=>setTarget({account:true})}>{status.state==='deleting'?'Retry account deletion':'Delete my account'}</button></section>}
    {target&&<ConfirmErasure key={target.id || 'account'} target={target} onCancel={()=>setTarget(null)} onConfirm={erase}/>}
  </section>;
}
