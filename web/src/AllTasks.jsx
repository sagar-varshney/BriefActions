import React,{useEffect,useState} from 'react';
import {api} from './api.js';
import useReadContext from './useReadContext.js';
import LoadingState from './LoadingState.jsx';
import {localToday,progressLabels} from './reviewTools.js';
import CopyTask from './CopyTask.jsx';

const views={all:'All tasks',today:'Today',overdue:'Overdue',upcoming:'Upcoming',unassigned:'Unassigned'};
export const initialTaskFilters={query:'',status:'open',view:'all',owner:'',page:0};

export default function AllTasks({filters,onFilters,onOpen,onStart,busy,refreshToken=0}){
 const [result,setResult]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0),[today,setToday]=useState(localToday),[loadedKey,setLoadedKey]=useState('');
 const requestKey=JSON.stringify([filters,today,retry]),waiting=loadedKey!==requestKey,captureReadContext=useReadContext(result);
 // Refresh calendar filters when a long-lived tab crosses midnight or regains focus.
 useEffect(()=>{const refresh=()=>setToday(localToday()),timer=setInterval(refresh,60_000);window.addEventListener('focus',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};},[]);
 useEffect(()=>{
  let alive=true;setLoading(true);setError('');
  const timer=setTimeout(()=>{api('/tasks?'+new URLSearchParams({...filters,today,page_size:'12'})).then(value=>{if(alive){if(loadedKey===requestKey)captureReadContext();setResult(value);}}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive){setLoading(false);setLoadedKey(requestKey);}});},200);
  return()=>{alive=false;clearTimeout(timer);};
 },[filters,today,retry,refreshToken]);
 const change=patch=>onFilters({...filters,...patch,page:0});
 function searchKey(event){if(event.key==='Escape'&&!event.nativeEvent.isComposing&&filters.query){event.preventDefault();event.stopPropagation();change({query:''});}}
 return <>
  <div className="page-intro"><div><div className="eyebrow accent">EVERY MEETING. ONE CLEAR NEXT STEP.</div><h1 tabIndex={-1}>All tasks</h1><p>Your confirmed tasks across meetings. Open a task to update its progress or check the original conversation.</p></div></div>
  <section className="panel task-dashboard-filters" aria-label="Find confirmed tasks">
   <div className="task-dashboard-search"><label className="field-label">Search tasks<input type="search" aria-label="Search tasks" aria-keyshortcuts="Escape" title="Press Esc to clear the search text" onKeyDown={searchKey} placeholder="Task, owner, or meeting name" maxLength={200} value={filters.query} onChange={e=>change({query:e.target.value})}/></label><label className="field-label">Task status<select aria-label="Task status" value={filters.status} onChange={e=>change({status:e.target.value})}><option value="open">Open tasks</option><option value="">All statuses</option>{Object.entries(progressLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label><button className="button secondary" type="button" disabled={waiting||loading} aria-busy={waiting||loading} onClick={()=>{setToday(localToday());setRetry(n=>n+1);}}>Refresh tasks</button></div>
   {filters.owner&&<div className="task-owner-filter"><p>Owner: <strong>{filters.owner==='Unknown'?'Unassigned (Unknown owner)':filters.owner}</strong> · Exact owner group</p><button className="text-button" type="button" onClick={()=>change({owner:''})}>Show all owners</button></div>}
   <div className="task-views" role="group" aria-label="Task views">{Object.entries(views).map(([value,label])=><button className="task-view" key={value} type="button" aria-pressed={filters.view===value} onClick={()=>change({view:value})}>{label}{!waiting&&!error&&result&&<span>{result.counts[value]}</span>}</button>)}</div>
   <p className="form-hint">Counts follow your search and status filter. Today is {today}, using your device’s date. Upcoming means the next 7 days; completed tasks are excluded from date views.</p>
  </section>
  {!waiting&&error?<div className="notice error" role="alert">{error}<button className="text-button" type="button" onClick={()=>setRetry(n=>n+1)}>Retry task search</button></div>:waiting?<LoadingState label="Loading tasks…" requestKey={requestKey}/>:!result?.total?<section className="empty-state"><h2>No tasks in this view</h2><p>{filters.query||filters.owner||filters.view!=='all'||filters.status!=='open'?'Try another view or show all confirmed tasks.':'Review and confirm a meeting’s tasks to track them here. Completed tasks are available under All statuses.'}</p><div className="empty-state-actions"><button className="button primary" type="button" disabled={busy} onClick={onStart}>Add a meeting</button><button className="button secondary" type="button" onClick={()=>onFilters({...initialTaskFilters,status:''})}>Show all confirmed tasks</button></div></section>:<>
   <p className="form-hint" role="status">{result.total} task{result.total===1?'':'s'} · Page {result.page+1} of {Math.ceil(result.total/result.page_size)}</p>
   <div className="task-dashboard-list">{result.items.map(item=><article className="panel dashboard-task" key={`${item.run_id}-${item.proposal_id}`}><div className="dashboard-task-copy"><div className="dashboard-task-heading"><h2>{item.task}</h2><span className={`badge ${item.status==='done'?'green':'neutral'}`}>{progressLabels[item.status]}</span></div><div className="task-meta"><span>Owner: <strong>{item.owner}</strong></span><span>Deadline: <strong>{item.deadline}</strong></span></div><p className="form-hint">{item.title || `Meeting ${item.reference_date}`} · Meeting date {item.reference_date}</p></div><div className="dashboard-task-actions"><CopyTask task={item}/><button className="button secondary" disabled={busy} type="button" onClick={()=>onOpen(item)}>Open task &amp; evidence<span className="sr-only">: {item.task}</span></button></div></article>)}</div>
   {result.total>result.page_size&&<div className="annotation-pagination"><button className="button secondary" disabled={result.page===0} onClick={()=>onFilters({...filters,page:result.page-1})}>Previous tasks</button><span>Page {result.page+1} of {Math.ceil(result.total/result.page_size)}</span><button className="button secondary" disabled={(result.page+1)*result.page_size>=result.total} onClick={()=>onFilters({...filters,page:result.page+1})}>Next tasks</button></div>}
  </>}
 </>;
}
