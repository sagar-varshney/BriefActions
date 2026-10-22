import '@fontsource-variable/inter/wght.css';
import Icon from './Icon.jsx';
import {authScreen} from './authRouting.js';
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
import PrivacyPage from './PrivacyPage.jsx';
import MeetingHistory from './MeetingHistory.jsx';
import MeetingSeries from './MeetingSeries.jsx';
import SeriesMembership from './SeriesMembership.jsx';
import {SeriesInput} from './SeriesPicker.jsx';
import AllTasks,{initialTaskFilters} from './AllTasks.jsx';
import Calendar from './Calendar.jsx';
import MyDay from './MyDay.jsx';
import OwnerOverview,{initialOwnerFilters} from './OwnerOverview.jsx';
import {initialCalendar} from './calendarDates.js';
import PlanExport from './PlanExport.jsx';
import FollowupDraft from './FollowupDraft.jsx';
import PlanChangeReview,{FollowupForm} from './PlanUpdates.jsx';
import ProductBrand from './ProductBrand.jsx';
import SourceTranscript from './SourceTranscript.jsx';
import WorkspaceSummary from './WorkspaceSummary.jsx';
import ReviewProposals from './ReviewProposals.jsx';
import TaskFollowThrough from './TaskFollowThrough.jsx';
import ActivityTimeline,{ConversationChanges} from './ActivityTimeline.jsx';
import ResearchNavigation from './ResearchNavigation.jsx';
import WorkspaceLayout from './WorkspaceLayout.jsx';
import HelpGuide from './HelpGuide.jsx';
import WorkflowGuide from './WorkflowGuide.jsx';
import ContextHelp from './ContextHelp.jsx';
import MeetingTips,{focusMeetingStep} from './MeetingTips.jsx';
import ResearchHelp from './ResearchHelp.jsx';
import useAfterRender from './useAfterRender.js';
import useDocumentTitle from './useDocumentTitle.js';
import ComparisonResults,{ResultSummary} from './ComparisonResults.jsx';
import {readRoute,routePath} from './routing.js';
import {readInputDraft,saveInputDraft,removeInputDraft} from './inputDraft.js';

function loadPending(){try{const value=JSON.parse(accountStorage.getItem('flow.pendingAnalysis') || 'null');return value && /^[a-f0-9]{32}$/.test(value.request_id) && typeof value.transcript==='string'?value:null;}catch{return null;}}

function reviewDrafts(proposals,decisions=[]){const byId=new Map(decisions.map(d=>[d.proposal_id,d]));return proposals.map(p=>byId.get(p.proposal_id)||{proposal_id:p.proposal_id,task:p.task,owner:p.owner,deadline:p.deadline,accept:false});}

const pct = value => value == null ? 'Unknown' : `${(value*100).toFixed(1)}%`;
const duration = value => value == null ? 'Unknown' : value < 1000 ? `${value.toFixed(1)} ms` : `${(value/1000).toFixed(2)} s`;
function Json({value}) { return <pre className="json" tabIndex={0}>{JSON.stringify(value,null,2)}</pre>; }
function Evidence({passages = [],onInspect,label}) {
  return <div className="evidence"><div className="eyebrow"><Icon name="quote" size={15}/> Supporting transcript</div>{passages.map((e,i)=><div key={i}><blockquote>{e.text}</blockquote><div className="evidence-footer"><span className="span-note">Characters {e.start}–{e.end} in the saved input</span>{onInspect&&<button type="button" className="text-button evidence-jump" aria-label={`Locate passage ${i+1} for ${label}`} onClick={event=>onInspect(e,event.currentTarget)}>Locate passage <Icon name="arrow" size={14}/></button>}</div></div>)}</div>;
}
function Download({href,children}) {
  const pending=useRef(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function download(){
    if(pending.current)return;
    pending.current=true;setBusy(true);setError('');setNotice('Preparing download…');
    try{await downloadFile(href);setNotice('File prepared. Check your browser’s downloads.');}
    catch(e){setNotice('');setError(e.message);}
    finally{pending.current=false;setBusy(false);}
  }
  return <span className="download-control"><button type="button" className="button secondary" aria-label={children} aria-busy={busy} disabled={busy} onClick={download}><Icon name={busy?'spinner':'download'} size={16} className={busy?'icon-spin':''}/>{busy?'Preparing…':children}</button><small role="status">{notice}</small>{error&&<small className="download-error" role="alert">{error} Try the download again.</small>}</span>;
}
function downloadJson(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
  const link = document.createElement('a'); link.href=url; link.download=filename; link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const pages = [{id:'extract',name:'Extract & review',icon:'extract'},{id:'today',name:'My day',icon:'day'},{id:'tasks',name:'All tasks',icon:'check'},{id:'owners',name:'Tasks by owner',icon:'owners'},{id:'calendar',name:'Calendar',icon:'calendar'},{id:'history',name:'Meeting history',icon:'history'},{id:'benchmark',name:'Compare extraction methods',icon:'chart'},{id:'annotations',name:'Label & review examples',icon:'quote'},{id:'data',name:'Data & account',icon:'history'}];
const analysisBrowsePages=new Set(['extract','today','tasks','owners','calendar','history']);

function App({account,signOut,completeAccountDeletion,authError}) {
  const [historyStatus,setHistoryStatus]=useState('');
  const [ownerFilters,setOwnerFilters]=useState(initialOwnerFilters);
  const [calendarFilters,setCalendarFilters]=useState(initialCalendar);
  const [helpTopic,setHelpTopic]=useState(null);
  const [meetingTips,setMeetingTips]=useState(()=>{try{return accountStorage.getItem('flow.meetingTips')==='show';}catch{return false;}});
  const [taskFilters,setTaskFilters]=useState(initialTaskFilters),[taskTarget,setTaskTarget]=useState(()=>readRoute().taskId || null);
  const [page,setPageState] = useState(()=>readRoute().page);
  const [historySeries,setHistorySeries]=useState(()=>({open:!!readRoute().seriesView,id:readRoute().seriesId||null}));
  useDocumentTitle(page==='history'&&historySeries.open?(historySeries.id?'Prepare next meeting':'Meeting series'):pages.find(section=>section.id===page)?.name || 'Extract & review');
  const navigation=useRef(null),deferredNavigation=useRef(null),navigationEpoch=useRef(0),committedURL=useRef(routePath(readRoute()));
  const [sourceWidth,setSourceWidth]=useState(()=>{try{const width=Number(accountStorage.getItem('flow.workspaceWidth'));return Number.isInteger(width)&&width>=32&&width<=55?width:43;}catch{return 43;}});
  function resizeSource(width){setSourceWidth(width);try{accountStorage.setItem('flow.workspaceWidth',String(width));}catch{}}
  function commitRoute(next,mode='push'){const url=routePath(next);if(mode!=='pop' && (location.pathname+location.search+location.hash!==url))history[mode==='replace'?'replaceState':'pushState']({},'',url);committedURL.current=url;setPageState(next.page);setTaskTarget(next.taskId || null);setHistorySeries({open:!!next.seriesView||!!next.seriesId,id:next.seriesId||null});}
  function setPage(next){if(next==='history')setHistoryStatus('');return navigate({page:next,runId:next==='extract'?run?.id:null});}
  async function navigate(next,mode='push'){
    if(restoring && mode==='pop'){deferredNavigation.current=next;return;}
    const browsing=analysisBusy.current && analysisBrowsePages.has(next.page) && !next.seriesView && !next.seriesId && !next.taskId && (!next.runId || next.runId===run?.id);
    if(closing && next.page!=='data' || busy && !browsing || restoring){if(mode==='pop')history.replaceState({},'',committedURL.current);return;}
    if(next.invalid){setError('This page does not exist. Choose a section from the navigation.');if(mode==='pop')history.replaceState({},'',committedURL.current);return;}
    if(next.page==='extract' && next.runId && next.runId!==run?.id)return openRun(next.runId,mode,next.taskId);
    if(next.page==='extract' && !next.runId && run){if(!resetMeeting()){if(mode==='pop')history.replaceState({},'',committedURL.current);return;}}
    navigationEpoch.current++;setError('');commitRoute(next,mode);if(!next.taskId)afterNavigation(()=>document.querySelector('main h1')?.focus({preventScroll:true}));
  }
  navigation.current=navigate;
  useEffect(()=>{const pop=()=>{if(authScreen()==='workspace')navigation.current?.(readRoute(),'pop');};window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[]);
  const [closing,setClosing]=useState(false);
  const [restoring,setRestoring]=useState(true);
  useEffect(()=>{if(!restoring && deferredNavigation.current){const next=deferredNavigation.current;deferredNavigation.current=null;history.replaceState({},'',routePath(next));void navigation.current?.(next,'pop');}},[restoring]);
  const [pending,setPending]=useState(loadPending),[analysisStatus,setAnalysisStatus]=useState('');
  const analysisBusy=useRef(false);
  const [analysisResultId,setAnalysisResultId]=useState(null),[analysisRevision,setAnalysisRevision]=useState(0);
  const [config,setConfig] = useState(null);
  const [transcript,setTranscript] = useState('');
  const [meetingDate,setMeetingDate] = useState('');
  const [meetingTitle,setMeetingTitle]=useState(''),[inputSaveStatus,setInputSaveStatus]=useState('');
  const [inputSeriesId,setInputSeriesId]=useState('');
  const [clusters,setClusters] = useState(3);
  const [run,setRun] = useState(null);
  const [editorOpen,setEditorOpen]=useState(false);
  const [activeEvidence,setActiveEvidence]=useState(null),evidenceTrigger=useRef(null);
  function inspectEvidence(passage,trigger){evidenceTrigger.current=trigger;setActiveEvidence(passage);afterRender(()=>{const source=document.getElementById('saved-source');const disclosure=source?.closest('details');if(disclosure)disclosure.open=true;source?.focus({preventScroll:true});(source?.querySelector('mark') || source)?.scrollIntoView({block:'center',behavior:'instant'});});}
  function openEditor(field='meeting-name'){setEditorOpen(true);afterRender(()=>document.getElementById(field)?.focus());}
  function returnToTask(){if(evidenceTrigger.current?.isConnected)evidenceTrigger.current.focus();}
  const [drafts,setDrafts] = useState([]);
  const [busy,setBusy] = useState(false);
  const afterRender=useAfterRender(!busy && !restoring);
  const afterNavigation=useAfterRender(!restoring);
  function showMeetingTips(){setHelpTopic(null);setMeetingTips(true);try{accountStorage.setItem('flow.meetingTips','show');}catch{}setPage('extract');afterNavigation(()=>{const heading=document.getElementById('meeting-tips-title');heading?.focus({preventScroll:true});heading?.scrollIntoView({block:'start',behavior:'instant'});});}
  function hideMeetingTips(){setMeetingTips(false);try{accountStorage.removeItem('flow.meetingTips');}catch{}afterNavigation(()=>focusMeetingStep(run));}
  const [error,setError] = useState('');
  const [bench,setBench] = useState(null);
  const [report,setReport] = useState(null);
  const [reportId,setReportId] = useState('');
  const [split,setSplit] = useState('test.jsonl');
  const [caseId,setCaseId] = useState('');
  const reportEpoch = useRef(0);
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


  function showInput(value,restored=false){setTranscript(value.transcript || '');setMeetingDate(value.reference_date || '');setClusters(value.clusters || value.settings?.clusters || 3);setMeetingTitle(value.title || '');setInputSeriesId(value.series_id??value.series_membership?.series?.id??'');setInputSaveStatus(restored?'Restored transcript draft from this browser.':'');}
  function inputValue(patch={}){return {transcript,reference_date:meetingDate,clusters,title:meetingTitle,series_id:run?(run.series_membership?.series?.id||''):inputSeriesId,...patch};}
  function stashInput(value=inputValue(),context=run?.id || 'new'){
    try{saveInputDraft(draftClient,context,value);setInputSaveStatus('Transcript draft saved in this browser.');return true;}
    catch{setInputSaveStatus('Transcript draft could not be saved in this browser. Keep this page open or copy your text before leaving.');return false;}
  }
  function changeInput(patch){const value=inputValue(patch);showInput(value);stashInput(value);}
  function restoreInput(snapshot){const cached=readInputDraft(draftClient,snapshot?.id || 'new');showInput(cached || snapshot || {transcript:'',reference_date:'',clusters:3,title:''},!!cached);}
  function resetMeeting(){
    if(busy || restoring || pending || !stashInput())return false;
    clearTimeout(saveTimer.current);activeRun.current=null;setRun(null);setEditorOpen(false);setDrafts([]);accountStorage.removeItem('flow.activeRun');setPending(null);setAnalysisResultId(null);setAnalysisStatus('');restoreInput(null);return true;
  }
  function newMeeting(){if(resetMeeting())commitRoute({page:'extract',runId:null});}
  function meetingInSeries(series){if(!resetMeeting())return;const cached=readInputDraft(draftClient,'new'),value={transcript:'',reference_date:'',clusters:3,...cached,title:cached?.title||series.name,series_id:series.id};showInput(value,!!cached);stashInput(value,'new');commitRoute({page:'extract',runId:null});setAnalysisStatus(`Next conversation: ${series.name}. Check any restored transcript draft before analyzing.`);afterRender(()=>document.getElementById('transcript')?.focus());}
  const openSeries=id=>navigate({page:'history',seriesView:true,...(id?{seriesId:id}:{})});
  function discardInput(){try{removeInputDraft(draftClient,run?.id || 'new');showInput(run || {transcript:'',reference_date:'',clusters:3,title:''});}catch{setInputSaveStatus('Browser draft could not be discarded. Keep this page open.');}}
  async function saveName(){setError('');setBusy(true);try{const value=await api(`/runs/${run.id}/title`,{method:'POST',body:JSON.stringify({title:meetingTitle,version:run.title_version})});adopt(value);setMeetingTitle(value.title);stashInput(inputValue({title:value.title}));}catch(e){setError(e.message);}finally{setBusy(false);}}

  function adopt(snapshot) {
    if(activeRun.current!==snapshot.id)setEditorOpen(false);setActiveEvidence(null);setRun(snapshot);
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
        if(status.state==='deleting'){accountStorage.clearWorkspace(false);setPending(null);setClosing(true);commitRoute({page:'data'},'replace');return;}
        const value=await api('/config');
        if(!alive)return;
        setConfig(value);
        const initial=readRoute();
        if(initial.invalid)setError('This page does not exist. Choose a section from the navigation.');
        const saved=initial.runId || (initial.invalid || location.pathname==='/meetings'?null:accountStorage.getItem('flow.activeRun'));
        if(saved) {
          try {
            const snapshot=await api(`/runs/${saved}`);
            if(alive){adopt(snapshot);restoreInput(snapshot);if(initial.page==='extract')commitRoute({page:'extract',runId:snapshot.id,taskId:initial.taskId},'replace');}
          } catch(e){if([404,410].includes(e.status)){if(accountStorage.getItem('flow.activeRun')===saved)accountStorage.removeItem('flow.activeRun');if(initial.runId)setError('This meeting is unavailable or does not belong to your account.');}else throw e;}
        }
        if(alive && !saved){restoreInput(null);if(!initial.invalid)commitRoute(initial,'replace');}
        else if(alive && initial.page!=='extract')commitRoute(initial,'replace');
        const unfinished=loadPending();
        if(unfinished && alive){
          showInput(unfinished);
          try{const saved=await api(`/runs/${unfinished.request_id}`);if(alive){removeInputDraft(draftClient,unfinished.source_context || accountStorage.getItem('flow.activeRun') || 'new');adopt(saved);showInput(saved);accountStorage.removeItem('flow.pendingAnalysis');setPending(null);setAnalysisStatus('Recovered your saved analysis.');if(initial.page==='extract')commitRoute({page:'extract',runId:saved.id},'replace');}}
          catch(e){if(alive)setAnalysisStatus('An unfinished analysis is saved. Retry it to recover or finish the same request.');}
        }
      } catch(e){if(alive){setError(e.message);if(!accountStorage.getItem('flow.activeRun'))restoreInput(null);const unfinished=loadPending();if(unfinished)showInput(unfinished);}}finally{if(alive)setRestoring(false);}
    })();
    return ()=>{alive=false;};
  },[]);
  useEffect(()=>{
    const erased=e=>{if(e.key!==accountStorage.erasureKey() || !e.newValue)return;try{const value=JSON.parse(e.newValue);value.account?accountStorage.clearWorkspace(false):(value.ids || [value.id]).forEach(id=>accountStorage.forgetInput(id,false));}finally{location.reload();}};
    window.addEventListener('storage',erased);return()=>window.removeEventListener('storage',erased);
  },[]);
  useEffect(()=>{
    if(page==='benchmark' && !bench) api('/benchmarks').then(setBench).catch(e=>setError(e.message));
  },[page,bench]);
  async function analyze(event) {
    event.preventDefault();
    const input=inputValue();
    const saved=loadPending();
    const same=saved && saved.transcript===transcript && saved.reference_date===meetingDate && saved.clusters===clusters && (saved.title || '')===meetingTitle && (saved.series_id||'')===input.series_id;
    await submitAnalysis(same?saved:{...input,request_id:crypto.randomUUID().replaceAll('-','')});
  }
  async function submitAnalysis(input){
    if(analysisBusy.current)return;
    const sourceContext=input.source_context || run?.id || 'new';
    input={...input,source_context:sourceContext};
    try{accountStorage.setItem('flow.pendingAnalysis',JSON.stringify(input));}catch{setError('Browser storage is unavailable. Enable storage before starting a recoverable analysis.');return;}
    analysisBusy.current=true;setAnalysisResultId(null);setPending(input);setError('');setBusy(true);setAnalysisStatus('Analyzing your saved request…');
    showInput(input);
    const finish=value=>{removeInputDraft(draftClient,sourceContext);adopt(value);showInput(value);accountStorage.removeItem('flow.pendingAnalysis');setPending(null);setAnalysisResultId(value.id);setAnalysisRevision(n=>n+1);setAnalysisStatus('Analysis saved. Review the proposals below.');if(readRoute().page==='extract'){commitRoute({page:'extract',runId:value.id});afterRender(()=>{const heading=document.getElementById('task-review-title') || document.getElementById('confirmed-plan-title');heading?.focus({preventScroll:true});heading?.scrollIntoView({block:'start',behavior:'instant'});});}};
    try{finish(await api('/runs',{method:'POST',body:JSON.stringify(input)}));}
    catch(e){
      if(e.retryable){
        setAnalysisStatus('Connection interrupted. Checking for a saved result…');
        try{finish(await api(`/runs/${input.request_id}`));}
        catch{setError(e.message);setAnalysisStatus('Your input and request ID are saved. Retry the same analysis below; a completed result will be reused.');}
      }else{
        setError(e.message);setAnalysisStatus('');
        accountStorage.removeItem('flow.pendingAnalysis');setPending(null);stashInput(input,sourceContext);
      }
    }finally{analysisBusy.current=false;setBusy(false);}
  }
  async function startPlanUpdate(input){
    if(pending || analysisBusy.current || restoring)throw new Error('Finish recovering the saved analysis before starting a follow-up comparison.');
    if(!stashInput())throw new Error('Browser storage is unavailable. Copy your current transcript before continuing.');
    setBusy(true);setError('');
    try{
      let value;
      try{value=await api(`/runs/${run.id}/updates`,{method:'POST',body:JSON.stringify(input)});}
      catch(e){if(!e.retryable)throw e;try{value=await api(`/runs/${input.request_id}`);}catch{throw e;}}
      adopt(value);showInput(value);commitRoute({page:'extract',runId:value.id});
      afterRender(()=>{const heading=document.getElementById('plan-comparison-title');heading?.focus({preventScroll:true});heading?.scrollIntoView({block:'start',behavior:'instant'});});
    }finally{setBusy(false);}
  }
  async function confirmPlanUpdate(payload){
    if(pending || analysisBusy.current || restoring)throw new Error('Finish recovering the saved analysis before confirming this updated plan.');
    setBusy(true);setError('');
    try{
      let value;
      try{value=await api(`/runs/${run.id}/update-confirm`,{method:'POST',body:JSON.stringify(payload)});}
      catch(e){if(!e.retryable)throw e;try{value=await api(`/runs/${run.id}`);if(value.status!=='confirmed')throw e;}catch{throw e;}}
      adopt(value);afterRender(()=>document.getElementById('confirmed-plan-title')?.focus());
    }finally{setBusy(false);}
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
  async function openRun(id,mode='push',taskId=null) {
    if(pending || busy || restoring){setError('Finish the current request before opening another meeting.');if(mode==='pop')history.replaceState({},'',committedURL.current);return;}
    if(!stashInput()){setError('Browser storage is unavailable. Return to Extract & review and copy your unsaved transcript before opening another run.');if(mode==='pop')history.replaceState({},'',committedURL.current);return;}
    const epoch=++navigationEpoch.current;setError('');setBusy(true);
    try {
      const value=await api(`/runs/${id}`);if(epoch!==navigationEpoch.current)return;adopt(value);restoreInput(value);commitRoute({page:'extract',runId:id,taskId},mode);if(!taskId)afterRender(()=>document.querySelector('main h1')?.focus({preventScroll:true}));
    }catch(e){if(epoch===navigationEpoch.current){setError(e.message);if(mode==='pop')history.replaceState({},'',committedURL.current);}}finally{if(epoch===navigationEpoch.current)setBusy(false);}
  }
  async function inspect(id) {
    const epoch=++reportEpoch.current;
    setReportId(id);setReport(null);setCaseId('');setError('');
    if (!id) return;
    try {const value=await api(`/benchmarks/${id}`);if(epoch===reportEpoch.current){setReport(value);setCaseId(value.report.runs[0]?.id || '');}}
    catch(e){if(epoch===reportEpoch.current)setError(e.message);}
  }
  function updateReview(next) {
    const edit_id=++editEpoch.current;setDrafts(next);cacheDraft(run.id,{version:draftVersions.current[run.id] || 0,decisions:next,dirty:true,edit_id});scheduleSave(run.id,next,edit_id);
  }
  const selected=drafts.filter(d=>d.accept).length;
  const inputChanged=run && (run.transcript!==transcript || run.reference_date!==meetingDate || (run.settings?.clusters || 3)!==clusters);
  const editorVisible=!run || editorOpen || !!pending;
  const nameChanged=run && meetingTitle!==run.title;
  const activeCase=report?.cases.find(c=>c.id===caseId);
  const prediction=report?.report.runs.find(c=>c.id===caseId);
  const caseScore=report?.report.details.find(c=>c.id===caseId);

  return <div className="app-shell">
    <a className="skip-link" href="#workspace-main">Skip to workspace</a>
    <header className="workspace-header">
      <ProductBrand href="/today" onClick={e=>{e.preventDefault();setPage('today');}}/>
      <nav aria-label="Main navigation">{pages.filter(p=>!['benchmark','annotations','data'].includes(p.id)).map(p=><button key={p.id} disabled={busy && !analysisBusy.current || restoring || closing && p.id!=='data'} className={`nav-item ${page===p.id?'active':''}`} aria-current={page===p.id?'page':undefined} onClick={()=>setPage(p.id)}><Icon name={p.icon} size={17}/><span>{p.name}</span></button>)}<ResearchNavigation page={page} disabled={closing || busy || restoring} onNavigate={setPage}/></nav>
      <div className="topbar-actions"><button type="button" className={`text-button account-entry ${page==='data'?'active':''}`} aria-current={page==='data'?'page':undefined} disabled={busy || restoring} onClick={()=>setPage('data')}>Data & account</button><button type="button" className="text-button help-entry" onClick={()=>setHelpTopic(page==='history'&&historySeries.open?'series':page==='owners'?'owners':page==='today'?'today':page==='calendar'?'calendar':page==='annotations'?'annotations':page==='benchmark'?'benchmark':'meetings')}>Help</button><ThemeControl/>{account&&<><span className="account-name" title={account.email}>{account.email || 'Signed in'}</span><button className="text-button" onClick={signOut}>Sign out</button></>}</div>
    </header>
    {helpTopic&&<HelpGuide onMeetingTips={showMeetingTips} initialTopic={helpTopic} onClose={()=>setHelpTopic(null)} onNavigate={target=>target==='series'?openSeries():setPage(target)} navigationDisabled={busy || restoring || closing || !!pending}/>}
    <main id="workspace-main" tabIndex={-1} aria-busy={restoring || busy && page==='extract'}>
      <div className="topbar"><span>Workspace <span className="slash">/</span> {pages.find(p=>p.id===page).name}</span><span className="local-badge"><span/> {account?'Private account':'Local workspace'}</span></div>
      <div className={`content ${run && page==='extract'?'meeting-content':''}`}>
      {page!=='extract'&&(analysisBusy.current || pending && page!=='today' || analysisResultId===run?.id)&&<div className="notice" role="status">{analysisBusy.current?'Your transcript is being analyzed. You can browse your tasks and calendar.':pending?(analysisStatus || 'An unfinished analysis is saved in this browser.'):'Your analysis is ready to review.'}<button type="button" className="text-button" onClick={()=>setPage('extract')}>{analysisBusy.current || pending?'Return to analysis':'Open analysis result'}</button></div>}
        {page==='today'&&pending&&!analysisBusy.current&&<div className="notice" role="status">An interrupted analysis is saved in this browser. Recover it before starting another meeting.<button className="text-button" type="button" disabled={busy||restoring} onClick={()=>setPage('extract')}>Recover saved analysis</button></div>}
        {authError&&<div className="notice error" role="alert">{authError}</div>}{error&&<div className="notice error" role="alert">{error}{!config&&<button className="text-button" onClick={()=>location.reload()}>Retry workspace loading</button>}<button aria-label="Dismiss error" onClick={()=>setError('')}>×</button></div>}
        {page==='extract'&&<>
          {run?<div className="meeting-heading"><div className="meeting-title"><h1 tabIndex={-1}>{run.title || `Meeting ${run.reference_date}`}</h1><p>{run.reference_date} <span aria-hidden="true">·</span> {run.status==='confirmed'?'Your confirmed plan':'Review your suggested tasks'}</p></div><div className="meeting-heading-actions"><button type="button" className="button secondary" disabled={busy || restoring || !!pending} onClick={newMeeting}>New meeting</button><button type="button" className="text-button" aria-label="Edit meeting input" aria-expanded={editorVisible} aria-controls="meeting-editor" disabled={busy || restoring || !!pending} onClick={()=>editorVisible?setEditorOpen(false):openEditor()}>{editorVisible?'Close editor':'Edit meeting'}</button></div></div>:<div className="page-intro extraction-intro"><div><div className="eyebrow accent">START HERE · EXTRACT & REVIEW</div><h1 tabIndex={-1}>Make your next move <em>clear.</em></h1><p>Add a transcript, review the suggested actions, then confirm your plan.</p></div><div className="intro-note"><Icon name="check" size={17}/><span>Evidence attached.<br/><strong>You make the final call.</strong></span></div></div>}
          {meetingTips&&<MeetingTips run={run} disabled={busy||restoring||!!pending} onHide={hideMeetingTips} onHelp={()=>setHelpTopic('meetings')}/>}
          {run?.superseded_by&&<div className="notice" role="status">This is an earlier plan version. Its tasks and evidence are preserved; All tasks uses the newer version.{run.superseded_available?<button className="text-button" disabled={busy} onClick={()=>openRun(run.superseded_by)}>Open newer plan</button>:<p>The newer version has been deleted.</p>}</div>}
          {run&&<SeriesMembership key={`series-${run.id}`} run={run} client={draftClient} disabled={busy||restoring||!!pending} onUpdate={setRun} onManage={()=>openSeries()} onPrepare={openSeries}/>}
          {(!run?.settings?.plan_update||run.status==='confirmed')&&<WorkspaceSummary run={run} drafts={drafts} selected={selected}/>}
          <div className="review-flow-bar"><div className="steps" role="group" aria-label="Meeting workflow"><span className={!run?'current':''}><b>1</b> Add transcript</span><span className={run?.status==='review'?'current':''}><b>2</b> Review proposals</span><span className={run?.status==='confirmed'?'current':''}><b>3</b> Confirm plan</span></div>{run&&<details className="layout-options"><summary>Layout options</summary><WorkspaceLayout width={sourceWidth} onChange={resizeSource}/></details>}</div>
          {!run&&(transcript || meetingTitle || meetingDate)&&<div className="meeting-actions"><button className="text-button" disabled={busy || restoring || !!pending} onClick={discardInput}>Discard transcript draft</button></div>}
          {analysisStatus&&<p className="analysis-feedback" role="status">{analysisStatus}</p>}
          {run&&(inputChanged || nameChanged)&&<p className="input-change-note" role="status">{inputChanged?'Transcript edits are saved in this browser. These tasks still use the original conversation.':'You have an unsaved meeting name.'}<button type="button" className="text-button" onClick={()=>openEditor(inputChanged?'transcript':'meeting-name')}>Review changes</button></p>}
          <div className={`extraction-grid ${run?'has-result':''}`} data-source-width={sourceWidth}><div className="source-column" role="region" aria-label="Transcript workspace" tabIndex={0}>
          {run&&<SourceTranscript run={run} passage={activeEvidence} onReturn={returnToTask}/>}
          <div id="meeting-editor" hidden={!editorVisible}><form className="panel transcript-panel" onSubmit={analyze}>
            {!run&&!pending&&!restoring&&config&&!transcript&&<section className="welcome-panel" aria-labelledby="welcome-title"><h2 id="welcome-title">Start with a conversation</h2><button className="text-button" type="button" onClick={()=>setHelpTopic('meetings')}>Start a quick walkthrough</button><p>Try a sample, paste a conversation, or import a transcript file.</p><div className="welcome-actions"><button type="button" className="button primary" onClick={()=>{changeInput({transcript:config.sample_transcript,reference_date:config.sample_reference_date,title:'Example meeting'});setAnalysisStatus('Example loaded. Analyze it to try reviewing a plan.');}}>Try an example</button><button type="button" className="button secondary" onClick={()=>document.getElementById('transcript').focus()}>Paste my transcript</button><button type="button" className="button secondary" onClick={()=>{const details=document.querySelector('.transcript-import');details.open=true;document.getElementById('transcript-file').focus();}}>Import a file</button></div><p className="form-hint">Saved when you analyze. <a href="/privacy">How your data is handled</a>.</p></section>}
            <div className="panel-heading"><div><h2>Meeting transcript</h2><p>Paste the conversation. Keep speaker names where available.</p></div><button type="button" className="text-button" disabled={!config || busy || restoring} onClick={()=>{changeInput({transcript:config.sample_transcript,reference_date:config.sample_reference_date,title:'Example meeting'});}}>Load example</button></div>
            <label className="field-label meeting-name">Meeting name (optional)<input id="meeting-name" aria-label="Meeting name" maxLength={120} value={meetingTitle} disabled={busy || restoring} placeholder="e.g. Product planning" onChange={e=>changeInput({title:e.target.value})}/></label>
            {!run&&<SeriesInput value={inputSeriesId} onChange={value=>changeInput({series_id:value})} disabled={busy||restoring||!!pending} onManage={()=>openSeries()}/>}
            {run&&<button type="button" className="text-button" disabled={busy || restoring || !!pending || meetingTitle===run.title} onClick={saveName}>Save meeting name</button>}
            <TranscriptImport disabled={busy || restoring} onUse={value=>{changeInput({transcript:value,reference_date:'',title:''});setAnalysisStatus('Transcript imported. Choose the meeting date, then analyze.');document.getElementById('meeting-date').focus();}}/>
            <label className="sr-only" htmlFor="transcript">Meeting transcript</label><textarea id="transcript" className="transcript" disabled={busy || restoring} value={transcript} onChange={e=>changeInput({transcript:e.target.value})} maxLength={config?.max_transcript || 100000} required placeholder="Maya: I’ll send the report tomorrow…"/>
            <div className="input-footer"><div className="settings"><label>Meeting date<input id="meeting-date" type="date" disabled={busy || restoring} value={meetingDate} onChange={e=>changeInput({reference_date:e.target.value})} required/></label><label>Maximum groups<select aria-label="Maximum groups" disabled={busy || restoring} value={clusters} onChange={e=>changeInput({clusters:Number(e.target.value)})}>{[1,2,3,4,5,6].map(n=><option key={n}>{n}</option>)}</select></label></div><button className="button primary" disabled={busy || !config || restoring}>{busy?'Working…':'Analyze transcript'}<Icon name={busy?'spinner':'arrow'} size={17} className={busy?'icon-spin':''}/></button></div>
            <div className="form-hint">Relative deadlines use the meeting date. Missing people and exact dates stay <strong>Unknown</strong>.</div><ContextHelp title="Why is a person or date Unknown?"><p>Unknown means the app did not identify a clear value. It is not proof that the conversation contains no answer. Check the original words, supply a detail you can establish, or leave Unknown.</p><p>For example, “Alex: Please review the notes” does not name the person doing the review or an exact deadline. Alex is the speaker, which does not automatically make Alex the owner.</p></ContextHelp>
            {config&&transcript===config.sample_transcript&&meetingDate===config.sample_reference_date&&<p className="notice" role="status">Synthetic example meeting · {config.sample_reference_date}. Use your actual meeting date for your own transcript.</p>}
            {run&&<button type="button" className="text-button discard-input" disabled={busy || restoring || !!pending} onClick={discardInput}>Discard transcript draft</button>}
          </form>
          {inputSaveStatus&&<p className="form-hint" role="status">{inputSaveStatus}</p>}
          {pending&&!busy&&!restoring&&<button className="button secondary" onClick={()=>submitAnalysis(pending)}>Retry saved analysis</button>}
          </div></div><div className="review-column">
          {!run&&<section className="panel review-placeholder" aria-labelledby="plan-placeholder-title"><div className="eyebrow accent">FROM WORDS TO WHAT’S NEXT</div><h2 id="plan-placeholder-title">Your action plan starts here.</h2><p>Add a conversation on the left. We’ll find proposed tasks and the passages behind them, ready for your review.</p><div className="plan-principles"><div><span>01</span><strong>Know what was said</strong><p>Every proposal keeps its supporting transcript.</p></div><div><span>02</span><strong>Fill in the gaps</strong><p>Missing owners and deadlines stay Unknown.</p></div><div><span>03</span><strong>Make it your plan</strong><p>Correct, select, and confirm only the tasks you want.</p></div></div><span className="badge neutral">Nothing is accepted automatically</span></section>}

          {run&&<section className="extraction-result" aria-label="Extraction result">
            {run.status==='confirmed'?<>
              <div className="section-heading"><div><h2 id="confirmed-plan-title" tabIndex={-1}>Your confirmed plan</h2><p>{run.final_tasks.length} task{run.final_tasks.length===1?'':'s'} confirmed. Next: update their progress below.</p></div><Download key={run.id} href={`/api/runs/${run.id}/tasks.csv`}>Export CSV</Download></div>
              {run.final_tasks.length===0&&<div className="notice">You confirmed a plan with no tasks. All proposals were rejected.</div>}
              {!run.superseded_by&&<FollowupForm key={`followup-${run.id}`} run={run} client={draftClient} busy={busy} onStart={startPlanUpdate}/>}
              <PlanExport key={`export-${run.id}`} run={run}/>
              <FollowupDraft key={`message-${run.id}`} run={run} client={draftClient} disabled={busy} onUpdate={value=>setRun(value)}/>
              <TaskFollowThrough key={`progress-${run.id}`} run={run} targetId={taskTarget} onViewChange={()=>{setActiveEvidence(null);evidenceTrigger.current=null;}} onUpdate={value=>{setRun(value);setActiveEvidence(null);evidenceTrigger.current=null;}} renderEvidence={(task,i)=><Evidence passages={task.evidence} onInspect={inspectEvidence} label={`confirmed task ${i+1}`}/>}/>
              {run.settings?.plan_update&&<details className="disclosure"><summary>Review the changes behind this plan</summary><PlanChangeReview key={`changes-${run.id}`} run={run} client={draftClient} busy={busy} onConfirm={confirmPlanUpdate} onOpen={openRun} onViewChange={()=>{setActiveEvidence(null);evidenceTrigger.current=null;}} renderEvidence={(task,label)=><Evidence passages={task.evidence} onInspect={inspectEvidence} label={label}/>} /></details>}
            </>:run.settings?.plan_update?<PlanChangeReview key={`changes-${run.id}`} run={run} client={draftClient} busy={busy} onConfirm={confirmPlanUpdate} onOpen={openRun} onViewChange={()=>{setActiveEvidence(null);evidenceTrigger.current=null;}} renderEvidence={(task,label)=><Evidence passages={task.evidence} onInspect={inspectEvidence} label={label}/>} />:<ReviewProposals key={`review-${run.id}`} run={run} drafts={drafts} busy={busy} onViewChange={()=>{setActiveEvidence(null);evidenceTrigger.current=null;}} onChange={updateReview} onConfirm={finalize} renderEvidence={(p,i)=><Evidence passages={p.evidence} onInspect={inspectEvidence} label={`task ${i+1}`}/>}>
              <div className="review-save-state"><p role="status" className="form-hint">{saveStatus}</p><details className="review-recovery"><summary>Review help</summary><p>Missing owners and dates stay Unknown. Your edits save automatically; the original supporting passage stays attached. You can restore this browser’s review copy below.</p><button type="button" className="text-button" onClick={()=>{try{const cached=JSON.parse(accountStorage.getItem(draftKey(run.id))||'null');if(cached){const merged=reviewDrafts(run.proposals,cached.decisions);setDrafts(merged);scheduleSave(run.id,merged);}}catch{setError('Browser draft could not be restored.');}}}>Restore browser copy</button></details></div>
            </ReviewProposals>}
            {run.status==='review'&&!run.settings?.plan_update&&<MissedActionForm key={run.id} run={run} busy={busy} onAdd={addMissed}/>}
            <ConversationChanges changes={run.settings?.conversation_changes} renderEvidence={(change,i)=><Evidence passages={change.evidence} onInspect={inspectEvidence} label={`conversation change ${i+1}`}/>}/>
            <details className="disclosure meeting-overview"><summary>Meeting details</summary>
            {run.summary&&<div className="summary"><div className="eyebrow accent">MEETING SUMMARY</div><p>{run.summary}</p></div>}
            <p>Meeting date: {run.reference_date}</p><details className="disclosure"><summary>Technical details</summary><p>Meeting ID: <code>{run.id}</code></p><pre className="saved-transcript">{run.transcript}</pre><p>Extractor: {run.settings?.extractor || 'rules'} · Maximum groups: {run.settings?.clusters || 3}</p><small>Extractor fingerprint: {run.settings?.extractor_sha256 || 'Unavailable for this meeting'}</small></details>
            </details>
            <ActivityTimeline key={`activity-${run.id}`} run={run} download={<Download key={run.id} href={`/api/runs/${run.id}/history.json`}>History JSON</Download>}/>
          </section>}
          </div></div>
        </>}
        {page==='annotations'&&<AnnotationReviewer api={api} downloadJson={downloadJson} onHelp={()=>setHelpTopic('annotations')}/>}
        {page==='data'&&<DataControls completeAccountDeletion={completeAccountDeletion} onClosing={()=>{clearTimeout(saveTimer.current);activeRun.current=null;setClosing(true);setRun(null);setDrafts([]);setTranscript('');setMeetingTitle('');setInputSaveStatus('');setReport(null);setPending(null);setAnalysisStatus('');}}/>}
        {page==='owners'&&<OwnerOverview filters={ownerFilters} onFilters={setOwnerFilters} onTasks={filters=>{setTaskFilters({...initialTaskFilters,...filters});setPage('tasks');}} onOpen={item=>openRun(item.run_id,'push',item.proposal_id)} onStart={newMeeting} busy={busy || restoring || !!pending}/>}
        {page==='tasks'&&<AllTasks filters={taskFilters} onFilters={setTaskFilters} onStart={newMeeting} onOpen={item=>openRun(item.run_id,'push',item.proposal_id)} busy={busy || restoring || !!pending}/>}
        {page==='today'&&<MyDay refreshToken={analysisRevision} busy={busy || restoring || !!pending} onStart={newMeeting} onOpen={item=>openRun(item.run_id,'push',item.proposal_id)} onTasks={view=>{setTaskFilters({...initialTaskFilters,view});setPage('tasks');}} onReviews={()=>{setHistoryStatus('review');navigate({page:'history'});}} onCalendar={()=>setPage('calendar')}/>}
        {page==='calendar'&&<Calendar refreshToken={analysisRevision} filters={calendarFilters} onFilters={setCalendarFilters} onOpen={item=>openRun(item.run_id,'push',item.proposal_id)} busy={busy || restoring || !!pending}/>}
        {page==='history'&&(historySeries.open?<MeetingSeries key={historySeries.id||'series-list'} seriesId={historySeries.id} client={draftClient} busy={busy||restoring||!!pending} onBack={()=>historySeries.id?openSeries():setPage('history')} onSelect={openSeries} onOpen={(id,task)=>openRun(id,'push',task)} onStart={meetingInSeries}/>:<MeetingHistory refreshToken={analysisRevision} key={historyStatus} initialStatus={historyStatus} onOpen={openRun} onStart={newMeeting} onSeries={()=>openSeries()} busy={busy || restoring || !!pending}/>)}
        {page==='benchmark'&&<>
          <div className="page-intro"><div><div className="eyebrow accent">QUALITY BEFORE GUESSWORK</div><h1 tabIndex={-1}>Compare extraction methods.</h1><p>Check how well an approach finds tasks by comparing its saved suggestions with expected answers. These optional checks help improve extraction.</p></div></div>
          <WorkflowGuide id="comparison-guide" title="Check a method in three steps" description="Test suggestions against expected answers, then inspect the differences." onHelp={()=>setHelpTopic('benchmark')} steps={[
            {title:'Choose examples',text:'Practice examples help improve a method. Reserved test examples check it afterwards.',target:'comparison-table-title',action:'Choose an example set'},
            {title:'Compare the results',text:'Start with tasks found, extra suggestions, response time, and failures. Select a method name to see its examples.'},
            {title:'Inspect the differences',text:'Check the original conversation against expected and suggested tasks. Detailed scores explain how matching works.'}
          ]}><ResearchHelp mode="comparison"/></WorkflowGuide>
          <div className="stat-grid"><div className="stat"><span>LABELED EXAMPLE CONVERSATIONS</span><strong>84</strong><small>Invented examples across two datasets</small></div><div className="stat"><span>PRACTICE / RESERVED TEST</span><strong>42 / 42</strong><small>30 + 12 in each set; related scenarios</small></div><div className="stat"><span>TEST DETECTION SCORE (F1)</span><strong>{pct(bench?.reports.find(r=>r.label==='rules' && r.dataset==='test.jsonl')?.metrics.task_f1)}</strong><small>Text-based task matching; higher is better</small></div></div>
          <div className="panel benchmark-panel"><div className="panel-heading"><div><h2 id="comparison-table-title" tabIndex={-1}>Extraction method comparison</h2><p>Choose a method name to inspect its saved results. Nothing is run automatically.</p></div><label className="split-filter">Example set<select aria-label="Example set" value={split} onChange={e=>setSplit(e.target.value)}><option value="test.jsonl">Reserved test examples</option><option value="dev.jsonl">Practice examples</option><option value="revision-dev">Revision v1 practice examples</option><option value="revision-test">Revision v1 reserved test examples</option><option value="all">All reports</option></select></label></div>
            {!bench?<p className="loading">Loading comparisons…</p>:<ComparisonResults reports={bench.reports.filter(r=>split==='all' || (split.startsWith('revision-') ? r.dataset_sha256===bench.additional_corpora?.[0]?.splits[split==='revision-dev'?'dev':'test'].sha256 : r.dataset_sha256===bench.manifest.splits[split==='dev.jsonl'?'dev':'test'].sha256))} selectedId={reportId} onInspect={inspect}/>}
            <p className="table-note">The original dataset has one measured pass per method/instructions version. Repeated checks are shown separately below.</p>
          </div>
          <details className="disclosure"><summary>Revision example dataset details</summary><p>Revision v1 adds 24 invented conversations with varied dates: 12 practice and 12 reserved test examples. These draft annotations still need independent review and validation against permitted real transcripts.</p></details>
          {bench?.repeat_summaries?.map((summary,n)=><section className="panel benchmark-panel" key={n}><h2>Repeated comparison checks</h2><p>See how results vary when a method runs several times on the same practice examples.</p><p>{summary.limitations}</p><div className="table-scroll" tabIndex={0} role="region" aria-label="Repeated model statistics"><table><thead><tr><th>Method / instructions version</th><th>Repeats</th><th>Detection score: average ± variation</th><th>Detection score range</th><th>Owner mean</th><th>Date mean</th><th>Support mean</th><th>Typical time: average ± variation</th><th>API cost mean</th><th>Failure rate mean</th></tr></thead><tbody>{summary.groups.map((g,i)=><tr key={i}><td>{g.model} / {g.prompt}<small className="span-note">Dataset {g.dataset_sha256.slice(0,8)}</small></td><td>{g.repeats}</td><td>{pct(g.metrics.task_f1.mean)} ± {pct(g.metrics.task_f1.stdev)}</td><td>{pct(g.metrics.task_f1.min)}–{pct(g.metrics.task_f1.max)}</td><td>{pct(g.metrics.owner_accuracy_on_matched.mean)}</td><td>{pct(g.metrics.deadline_accuracy_on_matched.mean)}</td><td>{pct(g.metrics.gold_support_proxy.mean)}</td><td>{duration(g.metrics.latency_p50_ms.mean)} ± {duration(g.metrics.latency_p50_ms.stdev)}</td><td>{g.metrics.cost_usd.known_runs===g.repeats?'$'+g.metrics.cost_usd.mean.toFixed(4):'Unknown'}</td><td>{pct(g.metrics.failure_rate.mean)}</td></tr>)}</tbody></table></div><button className="button secondary" onClick={()=>downloadJson(summary,'repeat-summary.json')}>Download repeat statistics</button></section>)}
          {reportId&&!report&&<div className="notice">Loading experiment…</div>}
          {report&&<section className="panel case-panel"><div className="panel-heading"><div><h2>Inspect: {report.report.label}</h2><p>Compare annotations with the exact retained output.</p></div><button className="button secondary" onClick={()=>downloadJson(report.report,`${report.report.label}-${report.report.dataset}.json`)}><Icon name="download" size={16}/>Full report</button></div><ResultSummary report={report.report}/><p className="form-hint">Next: choose an example conversation and compare expected tasks with suggested tasks below. Matching uses text similarity; extra suggestions need a closer look.</p><label className="case-select">Example conversation<select aria-label="Example conversation" value={caseId} onChange={e=>setCaseId(e.target.value)}>{report.report.runs.map(c=><option key={c.id}>{c.id}</option>)}</select></label>
            {activeCase&&<><div className="eyebrow">TRANSCRIPT · {activeCase.reference_date}</div><pre className="saved-transcript">{activeCase.transcript}</pre></>}
            <div className="case-columns"><div><h3>Expected tasks</h3><Json value={activeCase?.items || []}/></div><div><h3>Suggested tasks & run details</h3><Json value={prediction}/></div></div><details className="disclosure"><summary>Matches and missed tasks</summary><Json value={caseScore}/></details><details className="disclosure"><summary>Experiment fingerprints & configuration</summary><Json value={Object.fromEntries(Object.entries(report.report).filter(([key])=>!['runs','details','metrics','counts'].includes(key)))}/></details></section>}
          <ReviewedBenchmarks api={api} downloadJson={downloadJson} onAnnotate={()=>setPage('annotations')}/>
          {bench&&<><details className="disclosure"><summary>Example dataset details</summary><p>These invented conversations have draft expected answers. Independent review is still needed.</p><details className="disclosure"><summary>Technical dataset details</summary><Json value={{...bench.manifest,provenance:'Synthetic transcripts and draft annotations; not independently reviewed'}}/></details></details><details className="disclosure"><summary>Illustrative workstream classifier seed data</summary><p>This small seed set trains workstream classification. It does not train action extraction.</p><Json value={bench.training_data}/></details></>}
        </>}
        <footer className="page-footer">BriefActions <a href="/privacy">Privacy & your data</a><span>Evidence → Review → Action</span></footer>
      </div>
    </main>
  </div>;
}
createRoot(document.getElementById('root')).render(location.pathname.replace(/\/$/,'')==='/privacy'?<PrivacyPage/>:<AuthShell>{props=><App {...props}/>}</AuthShell>);
