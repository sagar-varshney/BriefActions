import React,{useEffect,useState} from 'react';
import {api} from './api.js';
const stamp=value=>new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
export default function MeetingHistory({onOpen,busy}){
  const [query,setQuery]=useState(''),[status,setStatus]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[page,setPage]=useState(0),[result,setResult]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    let alive=true;setLoading(true);setError('');
    const timer=setTimeout(()=>{api('/runs/search?'+new URLSearchParams({query,status,date_from:from,date_to:to,page:String(page),page_size:'12'})).then(value=>{if(alive)setResult(value);}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setLoading(false);});},250);
    return()=>{alive=false;clearTimeout(timer);};
  },[query,status,from,to,page,retry]);
  const change=setter=>e=>{setter(e.target.value);setPage(0);};
  const filtered=!!(query || status || from || to);
  return <>
    <div className="page-intro"><div><div className="eyebrow accent">EVERY DECISION, PRESERVED</div><h1 tabIndex={-1}>Your meeting history.</h1><p>Find saved meetings by name, transcript text, date, or review status.</p></div></div>
    <form className="panel history-filters" role="search" aria-label="Search saved meetings" onSubmit={e=>e.preventDefault()}>
      <label className="field-label">Search meetings<input type="search" aria-label="Search meetings" placeholder="Meeting name or transcript text" maxLength={200} value={query} onChange={change(setQuery)}/></label>
      <label className="field-label">Review status<select aria-label="Review status" value={status} onChange={change(setStatus)}><option value="">All meetings</option><option value="review">Awaiting review</option><option value="confirmed">Confirmed</option></select></label>
      <label className="field-label">From meeting date<input type="date" aria-label="From meeting date" value={from} onChange={change(setFrom)}/></label>
      <label className="field-label">To meeting date<input type="date" aria-label="To meeting date" value={to} onChange={change(setTo)}/></label>
      <button type="button" className="button secondary" disabled={!filtered} onClick={()=>{setQuery('');setStatus('');setFrom('');setTo('');setPage(0);}}>Clear filters</button>
    </form>
    {error?<div className="notice error" role="alert">{error}<button className="text-button" onClick={()=>setRetry(x=>x+1)}>Retry history search</button></div>:loading?<p className="empty-state" role="status">Loading history…</p>:!result?.total?<div className="empty-state"><h3>{filtered?'No meetings match your search.':'No saved meetings yet.'}</h3><p>{filtered?'Try different words or clear the filters.':'Analyze your first transcript to start a history.'}</p></div>:<>
      <p className="form-hint" role="status">{result.total} meeting{result.total===1?'':'s'} · Page {result.page+1} of {Math.ceil(result.total/result.page_size)}</p>
      <div className="history-list">{result.items.map(r=><article className="panel history-card" key={r.id}><div className="history-copy"><div className="history-title"><h3>{r.title || `Meeting ${r.reference_date}`}</h3><span className={`badge ${r.status==='confirmed'?'green':'purple'}`}>{r.status==='confirmed'?'Confirmed':'Awaiting review'}</span></div><p>{r.preview}</p><small>Meeting {r.reference_date} · {r.proposal_count} proposals · Saved {stamp(r.created_at)}</small></div><button className="button secondary" disabled={busy} onClick={()=>onOpen(r.id)}>Open meeting</button></article>)}</div>
      {result.total>result.page_size&&<div className="annotation-pagination"><button className="button secondary" disabled={loading || result.page===0} onClick={()=>setPage(result.page-1)}>Previous meetings</button><span>Page {result.page+1} of {Math.ceil(result.total/result.page_size)}</span><button className="button secondary" disabled={loading || (result.page+1)*result.page_size>=result.total} onClick={()=>setPage(result.page+1)}>Next meetings</button></div>}
    </>}
  </>;
}
