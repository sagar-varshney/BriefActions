import {api,downloadFile} from './api.js';
import AuthShell from './AuthShell.jsx';
import ThemeControl from './ThemeControl.jsx';
import accountStorage from './accountStorage.js';
import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import './styles.css';
import AnnotationReviewer from './AnnotationReviewer.jsx';
import ReviewedBenchmarks from './ReviewedBenchmarks.jsx';
import MissedActionForm from './MissedActionForm.jsx';
import DataControls from './DataControls.jsx';
import TranscriptImport from './TranscriptImport.jsx';

function loadPending(){try{const value=JSON.parse(accountStorage.getItem('flow.pendingAnalysis') || 'null');return value && /^[a-f0-9]{32}$/.test(value.request_id) && typeof value.transcript==='string'?value:null;}catch{return null;}}

function reviewDrafts(proposals,decisions=[]){const byId=new Map(decisions.map(d=>[d.proposal_id,d]));return proposals.map(p=>byId.get(p.proposal_id)||{proposal_id:p.proposal_id,task:p.task,owner:p.owner,deadline:p.deadline,accept:false});}

const pct = value => value == null ? 'Unknown' : `${(value*100).toFixed(1)}%`;
const duration = value => value == null ? 'Unknown' : value < 1000 ? `${value.toFixed(1)} ms` : `${(value/1000).toFixed(2)} s`;
const stamp = value => new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
function Icon({name, size = 20}) {
  const paths = {
    flow:<path d="m14 2-8 11h6l-2 9 8-11h-6z"/>,
    extract:<><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h5M8 16h8"/></>,
    history:<><path d="M3 11a9 9 0 1 1 2.5 7M3 4v7h7"/><path d="M12 7v5l3 2"/></>,
    chart:<><path d="M4 3v17h17M8 15v-4M13 15V7M18 15V4"/></>,
    arrow:<path d="M5 12h14m-5-5 5 5-5 5"/>,
    check:<path d="m5 12 4 4L19 6"/>,
    download:<><path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/></>,
    quote:<><path d="M5 6h5v7H5zm9 0h5v7h-5zM10 13c0 3-2 5-5 5M19 13c0 3-2 5-5 5"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function Json({value}) { return <pre className="json" tabIndex={0}>{JSON.stringify(value,null,2)}</pre>; }
function Evidence({passages = []}) {
  return <div className="evidence"><div className="eyebrow"><Icon name="quote" size={15}/> Supporting transcript</div>{passages.map((e,i)=><div key={i}><blockquote>{e.text}</blockquote><span className="span-note">Characters {e.start}–{e.end} in the saved input</span></div>)}</div>;
}
function Download({href, children}) { const [error,setError]=useState('');return <span><button type="button" className="button secondary" onClick={()=>downloadFile(href).catch(e=>setError(e.message))}><Icon name="download" size={16}/>{children}</button>{error&&<small role="alert">{error}</small>}</span>; }
function downloadJson(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
  const link = document.createElement('a'); link.href=url; link.download=filename; link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const pages = [{id:'extract',name:'Extract & review',icon:'extract'},{id:'history',name:'Run history',icon:'history'},{id:'benchmark',name:'Evaluation lab',icon:'chart'},{id:'annotations',name:'Annotation reviewer',icon:'quote'},{id:'data',name:'Data & account',icon:'history'}];

function App({account,signOut,completeAccountDeletion,authError}) {
  const [page,setPage] = useState(location.hash==='#data'?'data':'extract');
  const [closing,setClosing]=useState(false);
  const [restoring,setRestoring]=useState(true);
  const [pending,setPending]=useState(loadPending),[analysisStatus,setAnalysisStatus]=useState('');
  const analysisBusy=useRef(false);
  const [config,setConfig] = useState(null);
  const [transcript,setTranscript] = useState('');
  const [meetingDate,setMeetingDate] = useState('');
  const [clusters,setClusters] = useState(3);
  const [run,setRun] = useState(null);
  const [drafts,setDrafts] = useState([]);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [runs,setRuns] = useState([]);
  const [historyLoading,setHistoryLoading] = useState(false);
  const [bench,setBench] = useState(null);
  const [report,setReport] = useState(null);
  const [reportId,setReportId] = useState('');
  const [split,setSplit] = useState('test.jsonl');
  const [caseId,setCaseId] = useState('');
  const reportEpoch = useRef(0);
  const historyEpoch = useRef(0);
  const [saveStatus,setSaveStatus]=useState('');
  const saveQueue=useRef(Promise.resolve()),saveTimer=useRef(null),draftVersions=useRef({}),activeRun=useRef(null);
  const [draftClient]=useState(()=>{const value=sessionStorage.getItem('flow.draftClient')||crypto.randomUUID();sessionStorage.setItem('flow.draftClient',value);return value;});
  const editEpoch=useRef(0);
  const draftKey=id=>`flow.draft.${id}.${draftClient}`;
  function cacheDraft(id,value){try{accountStorage.setItem(draftKey(id),JSON.stringify(value));}catch{setSaveStatus('Browser storage unavailable; keep this page open until saved to history.');}}
  function scheduleSave(id,decisions,edit_id=++editEpoch.current){
    clearTimeout(saveTimer.current);
    setSaveStatus('Draft saved in this browser; saving to history…');
    saveTimer.current=setTimeout(()=>{
      saveQueue.current=saveQueue.current.catch(()=>{}).then(async()=>{
        try{
          const result=await api(`/runs/${id}/draft`,{method:'POST',body:JSON.stringify({decisions,version:draftVersions.current[id] || 0,client_id:draftClient,edit_id})});
          draftVersions.current[id]=result.version;
          const cached=JSON.parse(accountStorage.getItem(draftKey(id))||'null');
          if(cached)cacheDraft(id,{...cached,version:result.version,dirty:JSON.stringify(cached.decisions)!==JSON.stringify(decisions)});
          if(activeRun.current===id)setSaveStatus('Draft saved to history.');
        }catch(e){if(activeRun.current===id)setSaveStatus(`Draft kept in this browser. History save failed: ${e.message}`);throw e;}
      });
      saveQueue.current.catch(()=>{});
    },400);
  }


  function adopt(snapshot) {
    setRun(snapshot);
    clearTimeout(saveTimer.current);activeRun.current=snapshot.id;
    const saved=snapshot.draft;
    draftVersions.current[snapshot.id]=saved?.version || 0;
    let cached=null;try{cached=JSON.parse(accountStorage.getItem(draftKey(snapshot.id))||'null');}catch{}
    const compatible=cached && (cached.version===(saved?.version || 0) || saved?.client_id===draftClient && (saved?.edit_id || 0)<=(cached.edit_id || 0));
    const restored=compatible ? cached.decisions : saved?.decisions;
    editEpoch.current=Math.max(editEpoch.current,cached?.edit_id || 0,saved?.edit_id || 0);
    const merged=reviewDrafts(snapshot.proposals,restored);
    setDrafts(merged);
    setSaveStatus(restored?'Restored unfinished review.':'');
    if(snapshot.status==='confirmed')accountStorage.removeItem(draftKey(snapshot.id));
    else if(cached?.dirty && restored===cached.decisions){const edit_id=++editEpoch.current;cacheDraft(snapshot.id,{...cached,decisions:merged,edit_id});scheduleSave(snapshot.id,merged,edit_id);}
    else if(cached?.dirty && !compatible)setSaveStatus('History changed in another tab. Your browser copy is preserved; use Restore browser copy to recover it.');
    accountStorage.setItem('flow.activeRun',snapshot.id);
  }
  useEffect(()=>{
    let alive=true;
    (async()=>{
      try {
        const status=await api('/account');
        if(!alive)return;
        if(status.state==='deleting'){setClosing(true);setPage('data');return;}
        const value=await api('/config');
        if(!alive)return;
        setConfig(value);setTranscript(value.sample_transcript);setMeetingDate(value.sample_reference_date);
        const saved=accountStorage.getItem('flow.activeRun');
        if(saved) {
          try {
            const snapshot=await api(`/runs/${saved}`);
            if(alive){adopt(snapshot);setTranscript(snapshot.transcript);setMeetingDate(snapshot.reference_date);setClusters(snapshot.settings?.clusters || 3);}
          } catch(e){if([404,410].includes(e.status))accountStorage.removeItem('flow.activeRun');else throw e;}
        }
        const unfinished=loadPending();
        if(unfinished && alive){
          setTranscript(unfinished.transcript);setMeetingDate(unfinished.reference_date);setClusters(unfinished.clusters);
          try{const saved=await api(`/runs/${unfinished.request_id}`);if(alive){adopt(saved);accountStorage.removeItem('flow.pendingAnalysis');setPending(null);setAnalysisStatus('Recovered your saved analysis.');}}
          catch(e){if(alive)setAnalysisStatus('An unfinished analysis is saved. Retry it to recover or finish the same request.');}
        }
      } catch(e){if(alive)setError(e.message);}finally{if(alive)setRestoring(false);}
    })();
    return ()=>{alive=false;};
  },[]);
  useEffect(()=>{
    const erased=e=>{if(e.key!==accountStorage.erasureKey() || !e.newValue)return;try{const value=JSON.parse(e.newValue);value.account?accountStorage.clearWorkspace(false):accountStorage.forgetInput(value.id,false);}finally{location.reload();}};
    window.addEventListener('storage',erased);return()=>window.removeEventListener('storage',erased);
  },[]);
  useEffect(()=>{
    if(page==='history') {
      const epoch=++historyEpoch.current;
      setHistoryLoading(true);
      api('/runs').then(value=>{if(epoch===historyEpoch.current)setRuns(value);})
        .catch(e=>setError(e.message)).finally(()=>{if(epoch===historyEpoch.current)setHistoryLoading(false);});
    }
    if(page==='benchmark' && !bench) api('/benchmarks').then(setBench).catch(e=>setError(e.message));
  },[page,bench]);
  async function analyze(event) {
    event.preventDefault();
    const input={transcript,reference_date:meetingDate,clusters};
    const saved=loadPending();
    const same=saved && saved.transcript===transcript && saved.reference_date===meetingDate && saved.clusters===clusters;
    await submitAnalysis(same?saved:{...input,request_id:crypto.randomUUID().replaceAll('-','')});
  }
  async function submitAnalysis(input){
    if(analysisBusy.current)return;
    try{accountStorage.setItem('flow.pendingAnalysis',JSON.stringify(input));}catch{setError('Browser storage is unavailable. Enable storage before starting a recoverable analysis.');return;}
    analysisBusy.current=true;setPending(input);setError('');setBusy(true);setAnalysisStatus('Analyzing your saved request…');
    setTranscript(input.transcript);setMeetingDate(input.reference_date);setClusters(input.clusters);
    const finish=value=>{adopt(value);accountStorage.removeItem('flow.pendingAnalysis');setPending(null);setAnalysisStatus('Analysis saved. Review the proposals below.');};
    try{finish(await api('/runs',{method:'POST',body:JSON.stringify(input)}));}
    catch(e){
      if(e.retryable){
        setAnalysisStatus('Connection interrupted. Checking for a saved result…');
        try{finish(await api(`/runs/${input.request_id}`));}
        catch{setError(e.message);setAnalysisStatus('Your input and request ID are saved. Retry the same analysis below; a completed result will be reused.');}
      }else{
        setError(e.message);setAnalysisStatus('');
        accountStorage.removeItem('flow.pendingAnalysis');setPending(null);
      }
    }finally{analysisBusy.current=false;setBusy(false);}
  }
  async function finalize(event) {
    event.preventDefault();setError('');setBusy(true);
    clearTimeout(saveTimer.current);
    try {await saveQueue.current.catch(()=>{});adopt(await api(`/runs/${run.id}/finalize`,{method:'POST',body:JSON.stringify({decisions:drafts})}));}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function addMissed(payload){
    setBusy(true);clearTimeout(saveTimer.current);
    try{await saveQueue.current.catch(()=>{});adopt(await api(`/runs/${run.id}/manual-actions`,{method:'POST',body:JSON.stringify(payload)}));}
    finally{setBusy(false);}
  }
  async function openRun(id) {
    setError('');setBusy(true);
    try {
      const value=await api(`/runs/${id}`);adopt(value);
      setTranscript(value.transcript);setMeetingDate(value.reference_date);setClusters(value.settings?.clusters || 3);setPage('extract');
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function inspect(id) {
    const epoch=++reportEpoch.current;
    setReportId(id);setReport(null);setCaseId('');setError('');
    if (!id) return;
    try {const value=await api(`/benchmarks/${id}`);if(epoch===reportEpoch.current){setReport(value);setCaseId(value.report.runs[0]?.id || '');}}
    catch(e){if(epoch===reportEpoch.current)setError(e.message);}
  }
  function edit(index,field,value) {
    const next=drafts.map((d,i)=>i===index?{...d,[field]:value}:d);
    const edit_id=++editEpoch.current;setDrafts(next);cacheDraft(run.id,{version:draftVersions.current[run.id] || 0,decisions:next,dirty:true,edit_id});scheduleSave(run.id,next,edit_id);
  }
  const selected=drafts.filter(d=>d.accept).length;
  const inputChanged=run && (run.transcript!==transcript || run.reference_date!==meetingDate || (run.settings?.clusters || 3)!==clusters);
  const activeCase=report?.cases.find(c=>c.id===caseId);
  const prediction=report?.report.runs.find(c=>c.id===caseId);
  const caseScore=report?.report.details.find(c=>c.id===caseId);

  return <div className="app-shell">
    <a className="skip-link" href="#workspace-main">Skip to workspace</a>
    <aside className="sidebar">
      <a href="#" className="brand" onClick={e=>{e.preventDefault();setPage('extract');}}><span className="brand-mark"><Icon name="flow" size={25}/></span><span>Productivity<span className="brand-sub">FLOW ENGINE</span></span></a>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="Main navigation">{pages.map(p=><button key={p.id} disabled={closing && p.id!=='data'} className={`nav-item ${page===p.id?'active':''}`} aria-current={page===p.id?'page':undefined} onClick={e=>{setPage(p.id);location.hash=p.id==='data'?'data':'';setError('');if(e.detail===0)requestAnimationFrame(()=>document.querySelector('main h1')?.focus());}}><Icon name={p.icon}/>{p.name}{page===p.id&&<span className="nav-dot"/>}</button>)}</nav>
      <div className="sidebar-bottom"><span className="engine-status"><span/> Evidence-backed extraction</span><p>Review your proposals.<br/>You make the final call.</p></div>
    </aside>
    <main id="workspace-main" tabIndex={-1}>
      <header className="topbar"><span>Workspace <span className="slash">/</span> {pages.find(p=>p.id===page).name}</span><div className="topbar-actions"><ThemeControl/>{account&&<><span className="account-name" title={account.email}>{account.email || 'Signed in'}</span><button className="text-button" onClick={signOut}>Sign out</button></>}<span className="local-badge"><span/> {account?'Private account':'Local workspace'}</span></div></header>
      <div className="content">
        {authError&&<div className="notice error" role="alert">{authError}</div>}{error&&<div className="notice error" role="alert">{error}{!config&&<button className="text-button" onClick={()=>location.reload()}>Retry workspace loading</button>}<button aria-label="Dismiss error" onClick={()=>setError('')}>×</button></div>}
        {page==='extract'&&<>
          <div className="page-intro"><div><div className="eyebrow accent">FROM CONVERSATION TO ACTION</div><h1 tabIndex={-1}>Make your next move clear.</h1><p>Extract action items, check the evidence, and confirm your plan.</p></div><span className="intro-icon"><Icon name="flow" size={38}/></span></div>
          <div className="steps"><span className="current"><b>1</b> Add transcript</span><span className={run?'current':''}><b>2</b> Review proposals</span><span className={run?.status==='confirmed'?'current':''}><b>3</b> Confirm plan</span></div>
          <form className="panel transcript-panel" onSubmit={analyze}>
            <div className="panel-heading"><div><h2>Meeting transcript</h2><p>Paste the conversation. Keep speaker names where available.</p></div><button type="button" className="text-button" disabled={!config || busy || restoring} onClick={()=>{setTranscript(config.sample_transcript);setMeetingDate(config.sample_reference_date);}}>Load example</button></div>
            <TranscriptImport disabled={busy || restoring} onUse={value=>{setTranscript(value);setMeetingDate('');setAnalysisStatus('Transcript imported. Choose the meeting date, then analyze.');document.getElementById('meeting-date').focus();}}/>
            <label className="sr-only" htmlFor="transcript">Meeting transcript</label><textarea id="transcript" className="transcript" disabled={busy || restoring} value={transcript} onChange={e=>setTranscript(e.target.value)} maxLength={config?.max_transcript || 100000} required placeholder="Maya: I’ll send the report tomorrow…"/>
            <div className="input-footer"><div className="settings"><label>Meeting date<input id="meeting-date" type="date" disabled={busy || restoring} value={meetingDate} onChange={e=>setMeetingDate(e.target.value)} required/></label><label>Maximum groups<select aria-label="Maximum groups" disabled={busy || restoring} value={clusters} onChange={e=>setClusters(Number(e.target.value))}>{[1,2,3,4,5,6].map(n=><option key={n}>{n}</option>)}</select></label></div><button className="button primary" disabled={busy || !config || restoring}>{busy?'Working…':'Analyze transcript'}{!busy&&<Icon name="arrow" size={17}/>}</button></div>
            <div className="form-hint">Relative deadlines use the meeting date. Missing people and exact dates stay <strong>Unknown</strong>.</div>
          </form>
          {analysisStatus&&<p className="notice" role="status">{analysisStatus}</p>}
          {pending&&!busy&&!restoring&&<button className="button secondary" onClick={()=>submitAnalysis(pending)}>Retry saved analysis</button>}
          {!run&&<div className="empty-state"><span className="empty-icon"><Icon name="extract" size={28}/></span><h3>Your action plan starts here.</h3><p>Analyze a transcript to see proposals with their supporting passages.</p></div>}
          {run&&<section aria-label="Extraction result">
            {inputChanged&&<div className="notice warning">These proposals belong to the saved input. Analyze your edited transcript or settings to create a new run.</div>}
            <div className="result-meta"><span>Run <code>{run.id.slice(0,8)}</code> · Meeting {run.reference_date}</span><span className={`badge ${run.status==='confirmed'?'green':'purple'}`}>{run.status==='confirmed'?'Confirmed':'Needs your review'}</span></div>
            {run.summary&&<div className="summary"><div className="eyebrow accent">MEETING SUMMARY</div><p>{run.summary}</p></div>}
            <details className="disclosure"><summary>Saved input & extraction settings</summary><pre className="saved-transcript">{run.transcript}</pre><p>Extractor: {run.settings?.extractor || 'rules'} · Maximum groups: {run.settings?.clusters || 3}</p><small>Extractor fingerprint: {run.settings?.extractor_sha256 || 'Unavailable for this run'}</small></details>
            {run.status==='confirmed'?<>
              <div className="section-heading"><div><h2>Your confirmed plan</h2><p>{run.final_tasks.length} task{run.final_tasks.length===1?'':'s'} saved. This result is immutable.</p></div><Download href={`/api/runs/${run.id}/tasks.csv`}>Export CSV</Download></div>
              {run.final_tasks.length===0&&<div className="notice">You confirmed a plan with no tasks. All proposals were rejected.</div>}
              {run.final_tasks.map((task,i)=><article className="panel confirmed-card" key={task.proposal_id}><span className="check-circle"><Icon name="check" size={18}/></span><div className="confirmed-content"><h3>{task.task}</h3>{task.source==='manual'&&<span className="badge purple">User added</span>}<div className="task-meta"><span>Owner: <strong>{task.owner}</strong></span><span>Deadline: <strong>{task.deadline}</strong></span></div><Evidence passages={task.evidence}/></div></article>)}
            </>:<form onSubmit={finalize}>
              <div className="section-heading"><div><h2>Review action proposals <span className="count">{run.proposals.length}</span></h2><p>Correct the fields and select each task to keep. Nothing is accepted by default.</p></div></div>
              <p role="status" className="form-hint">{saveStatus}</p><button type="button" className="text-button" onClick={()=>{try{const cached=JSON.parse(accountStorage.getItem(draftKey(run.id))||'null');if(cached){const merged=reviewDrafts(run.proposals,cached.decisions);setDrafts(merged);scheduleSave(run.id,merged);}}catch{setError('Browser draft could not be restored.');}}}>Restore browser copy</button>
              <div className="review-note">Supporting passages describe the original proposal. Your corrections are recorded separately.</div>
              {run.proposals.length===0&&<div className="notice">No committed actions or direct requests detected. You can confirm an empty plan or analyze another transcript.</div>}
              {run.proposals.map((p,i)=><article className={`panel proposal-card ${drafts[i]?.accept?'selected':''}`} key={p.proposal_id}>
                <div className="proposal-heading"><span className="proposal-number">{String(i+1).padStart(2,'0')}</span><span className="badge neutral">{p.category || 'Action'}</span><label className="keep"><input type="checkbox" checked={drafts[i]?.accept || false} disabled={busy} onChange={e=>edit(i,'accept',e.target.checked)}/>Keep task {i+1}</label></div>
                <label className="field-label">Task {i+1}<textarea aria-label={`Task ${i+1}`} className="task-input" required value={drafts[i]?.task || ''} disabled={busy} onChange={e=>edit(i,'task',e.target.value)}/></label>
                <div className="field-row"><label className="field-label">Owner {i+1}<input aria-label={`Owner ${i+1}`} required value={drafts[i]?.owner || ''} disabled={busy} onChange={e=>edit(i,'owner',e.target.value)}/></label><label className="field-label">Deadline {i+1}<input aria-label={`Deadline ${i+1}`} required placeholder="YYYY-MM-DD or Unknown" value={drafts[i]?.deadline || ''} disabled={busy} onChange={e=>edit(i,'deadline',e.target.value)}/><span className="field-hint">YYYY-MM-DD or Unknown</span></label></div>
                <Evidence passages={p.evidence}/>
                {p.source!=='manual'&&<details className="suggestions"><summary>Proposal suggestions · {p.priority} priority · Group {p.cluster}</summary><p>Suggested slot: {p.suggested_slot || 'Unknown'}<br/>Workstream classifier probability: {p['confidence_%'] ?? 'Unknown'}%</p><p>Priority and scheduling use heuristics. Classifier probability is not extraction confidence. These suggestions are not included in the confirmed plan.</p></details>}
              </article>)}
              <div className="confirm-bar"><div><strong>{selected} of {run.proposals.length} selected</strong><span>{run.proposals.length-selected} proposal{run.proposals.length-selected===1?'':'s'} will be rejected.</span></div><button className="button primary" disabled={busy}>{busy?'Saving…':selected?'Confirm selected tasks':'Confirm empty plan'}<Icon name="check" size={17}/></button></div>
            </form>}
            {run.status==='review'&&<MissedActionForm key={run.id} run={run} busy={busy} onAdd={addMissed}/>}
            {run.settings?.conversation_changes?.length>0&&<details className="disclosure" open><summary>Conversation revisions & cancellations</summary><Json value={run.settings.conversation_changes}/></details>}
            <HistoryEvents run={run}/>
          </section>}
        </>}
        {page==='annotations'&&<AnnotationReviewer api={api} downloadJson={downloadJson}/>}
        {page==='data'&&<DataControls completeAccountDeletion={completeAccountDeletion} onClosing={()=>{clearTimeout(saveTimer.current);activeRun.current=null;setClosing(true);setRun(null);setDrafts([]);setTranscript('');setRuns([]);setReport(null);setPending(null);setAnalysisStatus('');}}/>}
        {page==='history'&&<>
          <div className="page-intro"><div><div className="eyebrow accent">EVERY DECISION, TRACEABLE</div><h1 tabIndex={-1}>Your run history.</h1><p>Revisit the input, original proposals, corrections, and final results.</p></div></div>
          <div className="notice">{account?'History is saved to your account and is available across devices.':'History is saved in this local workspace.'} JSON exports include the complete transcript and review decisions.</div>
          {historyLoading?<div className="empty-state">Loading history…</div>:runs.length===0?<div className="empty-state"><h3>No saved runs yet.</h3><p>Analyze your first transcript to start a history.</p><button className="button primary" onClick={()=>setPage('extract')}>Extract a transcript</button></div>:<div className="history-list">{runs.map(r=><article className="panel history-card" key={r.id}><div className="history-symbol"><Icon name="history"/></div><div className="history-copy"><div className="history-title"><h3>{stamp(r.created_at)}</h3><span className={`badge ${r.status==='confirmed'?'green':'purple'}`}>{r.status==='confirmed'?'Confirmed':'Awaiting review'}</span></div><p>{r.preview}</p><small>Meeting {r.reference_date} · {r.proposal_count} proposals · Run {r.id.slice(0,8)}</small></div><button className="button secondary" disabled={busy} onClick={()=>openRun(r.id)}>Open run <Icon name="arrow" size={16}/></button></article>)}</div>}
        </>}
        {page==='benchmark'&&<>
          <div className="page-intro"><div><div className="eyebrow accent">QUALITY BEFORE GUESSWORK</div><h1 tabIndex={-1}>The evaluation lab.</h1><p>Compare retained extraction experiments and inspect individual cases.</p></div></div>
          <div className="stat-grid"><div className="stat"><span>ANNOTATED TRANSCRIPTS</span><strong>84</strong><small>Synthetic cases across two versions</small></div><div className="stat"><span>DEVELOPMENT / HELD OUT</span><strong>42 / 42</strong><small>30 + 12 per split; related scenarios</small></div><div className="stat"><span>HELD-OUT RULES F1</span><strong>{pct(bench?.reports.find(r=>r.label==='rules' && r.dataset==='test.jsonl')?.metrics.task_f1)}</strong><small>Lexical task matching</small></div></div>
          <details className="disclosure"><summary>Benchmark provenance & metric limitations</summary><p>Annotations were authored by Codex and have not been independently reviewed. Synthetic results do not establish real-meeting accuracy. Gold support is a proxy based on annotated tasks, metadata, and spans; it is not an entailment judge.</p></details>
          <div className="panel benchmark-panel"><div className="panel-heading"><div><h2>Model & prompt comparison</h2><p>Measured quality, latency, API cost, and failures from retained runs.</p></div><label className="split-filter">Dataset<select aria-label="Dataset" value={split} onChange={e=>setSplit(e.target.value)}><option value="test.jsonl">Held out</option><option value="dev.jsonl">Development</option><option value="revision-dev">Revision v1 development</option><option value="revision-test">Revision v1 held out</option><option value="all">All reports</option></select></label></div>
            {!bench?<p className="loading">Loading experiments…</p>:<div className="table-scroll" tabIndex={0} role="region" aria-label="Extraction comparison table"><table><thead><tr><th>Experiment</th><th>F1</th><th>Precision</th><th>Recall</th><th>Owner¹</th><th>Date¹</th><th>Known owner²</th><th>Known date²</th><th>Support³</th><th>Valid spans</th><th>p50</th><th>p95</th><th>API cost</th><th>Failures</th></tr></thead><tbody>{bench.reports.filter(r=>split==='all' || (split.startsWith('revision-') ? r.dataset_sha256===bench.additional_corpora?.[0]?.splits[split==='revision-dev'?'dev':'test'].sha256 : r.dataset_sha256===bench.manifest.splits[split==='dev.jsonl'?'dev':'test'].sha256)).map(r=><tr key={r.id} className={reportId===r.id?'active-row':''}><td><button className="experiment" onClick={()=>inspect(r.id)}>{r.label}<small>{r.dataset} · {r.case_count} cases</small></button></td>{['task_f1','task_precision','task_recall','owner_accuracy_on_matched','deadline_accuracy_on_matched','known_owner_end_to_end','known_deadline_end_to_end','gold_support_proxy','evidence_validity'].map(k=><td key={k}>{pct(r.metrics[k])}</td>)}<td>{duration(r.metrics.latency_p50_ms)}</td><td>{duration(r.metrics.latency_p95_ms)}</td><td>{r.metrics.cost_usd==null?'Unknown':`$${r.metrics.cost_usd.toFixed(4)}`}</td><td>{r.counts.failures}/{r.case_count}</td></tr>)}</tbody></table></div>}
            <p className="table-note">¹ Accuracy among matched tasks. ² End-to-end accuracy for gold items with known metadata. ³ Gold support proxy. Local model API fees are $0; compute costs are excluded. The original corpus has one measured pass per model/prompt. Repeated development experiments are summarized below.</p>
          </div>
          <details className="disclosure"><summary>Revision corpus details</summary><p>Revision v1 adds 24 synthetic cases with varied dates (12 development / 12 held out). Manual labels were authored by Codex; independent review and permitted real transcripts remain needed.</p></details>
          {bench?.repeat_summaries?.map((summary,n)=><section className="panel benchmark-panel" key={n}><h2>Repeated model comparisons</h2><p>{summary.limitations}</p><div className="table-scroll" tabIndex={0} role="region" aria-label="Repeated model statistics"><table><thead><tr><th>Model / prompt</th><th>Repeats</th><th>F1 mean ± SD</th><th>F1 range</th><th>Owner mean</th><th>Date mean</th><th>Support mean</th><th>p50 mean ± SD</th><th>API cost mean</th><th>Failure rate mean</th></tr></thead><tbody>{summary.groups.map((g,i)=><tr key={i}><td>{g.model} / {g.prompt}<small className="span-note">Corpus {g.dataset_sha256.slice(0,8)}</small></td><td>{g.repeats}</td><td>{pct(g.metrics.task_f1.mean)} ± {pct(g.metrics.task_f1.stdev)}</td><td>{pct(g.metrics.task_f1.min)}–{pct(g.metrics.task_f1.max)}</td><td>{pct(g.metrics.owner_accuracy_on_matched.mean)}</td><td>{pct(g.metrics.deadline_accuracy_on_matched.mean)}</td><td>{pct(g.metrics.gold_support_proxy.mean)}</td><td>{duration(g.metrics.latency_p50_ms.mean)} ± {duration(g.metrics.latency_p50_ms.stdev)}</td><td>{g.metrics.cost_usd.known_runs===g.repeats?'$'+g.metrics.cost_usd.mean.toFixed(4):'Unknown'}</td><td>{pct(g.metrics.failure_rate.mean)}</td></tr>)}</tbody></table></div><button className="button secondary" onClick={()=>downloadJson(summary,'repeat-summary.json')}>Download repeat statistics</button></section>)}
          {reportId&&!report&&<div className="notice">Loading experiment…</div>}
          {report&&<section className="panel case-panel"><div className="panel-heading"><div><h2>Inspect: {report.report.label}</h2><p>Compare annotations with the exact retained output.</p></div><button className="button secondary" onClick={()=>downloadJson(report.report,`${report.report.label}-${report.report.dataset}.json`)}><Icon name="download" size={16}/>Full report</button></div><label className="case-select">Transcript case<select aria-label="Transcript case" value={caseId} onChange={e=>setCaseId(e.target.value)}>{report.report.runs.map(c=><option key={c.id}>{c.id}</option>)}</select></label>
            {activeCase&&<><div className="eyebrow">TRANSCRIPT · {activeCase.reference_date}</div><pre className="saved-transcript">{activeCase.transcript}</pre></>}
            <div className="case-columns"><div><h3>Annotated gold items</h3><Json value={activeCase?.items || []}/></div><div><h3>Predictions, usage & failures</h3><Json value={prediction}/></div></div><details className="disclosure"><summary>Matches and missed tasks</summary><Json value={caseScore}/></details><details className="disclosure"><summary>Experiment fingerprints & configuration</summary><Json value={Object.fromEntries(Object.entries(report.report).filter(([key])=>!['runs','details','metrics','counts'].includes(key)))}/></details></section>}
          <ReviewedBenchmarks api={api} downloadJson={downloadJson} onAnnotate={()=>setPage('annotations')}/>
          {bench&&<><details className="disclosure"><summary>Corpus provenance</summary><Json value={bench.manifest}/></details><details className="disclosure"><summary>Illustrative workstream classifier seed data</summary><p>This small seed set trains workstream classification. It does not train action extraction.</p><Json value={bench.training_data}/></details></>}
        </>}
        <footer className="page-footer">Productivity Flow Engine <span>Evidence → Review → Action</span></footer>
      </div>
    </main>
  </div>;
}
function HistoryEvents({run}) {
  return <div className="audit"><div className="section-heading"><div><h2>Inspectable history</h2><p>Original evidence stays attached. Edits and rejected tasks are recorded.</p></div><Download href={`/api/runs/${run.id}/history.json`}>History JSON</Download></div>{run.events.map(event=><details key={event.event_id} className="disclosure"><summary><span className="event-label">{event.kind==='manual_proposal'?'User-added action':event.kind}</span><span className="event-time">{stamp(event.created_at)}</span></summary><Json value={event.payload}/></details>)}</div>;
}
createRoot(document.getElementById('root')).render(<AuthShell>{props=><App {...props}/>}</AuthShell>);
