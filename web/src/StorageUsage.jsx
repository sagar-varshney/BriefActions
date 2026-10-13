import React from 'react';

const size=bytes=>bytes===0?'0 B':bytes<1000?`${bytes} B`:`${(bytes/1_000_000).toLocaleString(undefined,{maximumFractionDigits:3})} MB`;
export default function StorageUsage({storage,onRefresh}){
  if(!storage)return null;
  return <section className="panel data-panel" aria-labelledby="storage-heading">
    <div className="panel-heading"><h2 id="storage-heading">Workspace storage</h2><button className="text-button" onClick={onRefresh}>Refresh usage</button></div>
    <p>History includes saved transcripts, proposals, review versions, confirmed plans, and evaluations. Drafts below are unfinished annotation reviews.</p>
    <div className="storage-grid">{[['history','Saved history'],['drafts','Annotation drafts']].map(([key,label])=>{
      const {used_bytes:used,limit_bytes:limit}=storage[key],near=limit && used>=limit*.8;
      return <div className="storage-item" key={key}><h3>{label}</h3><p>{size(used)}{limit?` of ${size(limit)} (${Math.min(100,used/limit*100).toFixed(1)}%)`:' used'}</p>
        {limit?<><meter aria-label={`${label} usage`} min={0} max={limit} low={limit*.8} high={limit*.9} optimum={0} value={used}/><p>{size(Math.max(0,limit-used))} remaining</p></>:<p>No account quota is enforced in local mode.</p>}
        {near&&<p className="notice warning" role="status">{used>=limit?'Storage limit reached.':'Storage is getting full.'} Export work you want to keep, then delete saved transcripts to free space. New work and review versions also use storage.</p>}
      </div>;
    })}</div>
    <p className="form-hint">1 MB = 1,000,000 bytes. Measures saved text payloads, excluding database overhead, browser copies, exports, and backups. Usage is checked when this page opens or you refresh it.</p>
  </section>;
}
