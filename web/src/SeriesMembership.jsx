import React,{useEffect,useState} from 'react';
import {api} from './api.js';
import SeriesPicker from './SeriesPicker.jsx';
import useRecoverableWrite from './useRecoverableWrite.js';
export default function SeriesMembership({run,client,disabled,onUpdate,onManage,onPrepare}){
 const saved=run.series_membership||{root_id:run.id,version:0,series:null},[selected,setSelected]=useState(saved.series?.id||''),[version,setVersion]=useState(saved.version),[refreshing,setRefreshing]=useState(false),[notice,setNotice]=useState(''),[open,setOpen]=useState(false);
 const action=useRecoverableWrite(`flow.seriesLink.${client}.${run.id}`,`/runs/${run.id}/series`,value=>{onUpdate(value);setSelected(value.series_membership.series?.id||'');setVersion(value.series_membership.version);setNotice('Meeting series saved. All reviewed follow-up versions stay together.');});
 useEffect(()=>{if(action.pending)setOpen(true);},[action.pending]);
 const locked=disabled||action.busy||!!action.pending||refreshing,stale=version!==saved.version;
 async function reload(){setRefreshing(true);try{const value=await api(`/runs/${run.id}`);onUpdate(value);setSelected(value.series_membership.series?.id||'');setVersion(value.series_membership.version);setNotice('Saved series choice loaded.');}catch(e){setNotice(e.message);}finally{setRefreshing(false);}}
 return <div className="series-membership"><details open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>Meeting series: {saved.series?.name||'Not grouped'}</summary><p>Group recurring conversations. This applies to the original meeting and all its reviewed follow-up versions, without copying or changing tasks.</p>{open&&<SeriesPicker value={action.pending?(action.pending.series_id||''):selected} onChange={setSelected} disabled={locked} onManage={onManage}/>}
  {stale&&<p className="notice" role="status">The series choice changed elsewhere. Load the saved choice before moving this meeting.</p>}
  <div className="series-actions"><button className="button secondary" type="button" disabled={locked||stale||selected===(saved.series?.id||'')} onClick={()=>action.send({series_id:selected||null,version,request_id:crypto.randomUUID().replaceAll('-','')})}>Save meeting series</button><button className="text-button" type="button" disabled={action.busy||!!action.pending||refreshing} onClick={reload}>Reload saved series choice</button></div>
  {action.error&&<p className="notice error" role="alert">{action.error}</p>}{action.pending&&<p className="notice" role="status">A series change is waiting for recovery.<button className="button secondary" type="button" disabled={disabled||action.busy} onClick={()=>action.send()}>{action.busy?'Saving series…':'Retry series change'}</button></p>}{notice&&<p role="status">{notice}</p>}
 </details>{saved.series&&<button className="text-button" type="button" disabled={disabled} onClick={()=>onPrepare(saved.series.id)}>Prepare next meeting</button>}</div>;
}
