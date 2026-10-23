import accountStorage from './accountStorage.js';
import TranscriptImport from './TranscriptImport.jsx';
import React,{useEffect,useRef,useState} from 'react';
import useAnnotationDraft,{emptyAnnotation} from './useAnnotationDraft';
import SaveFeedback from './SaveFeedback.jsx';
import WorkflowGuide from './WorkflowGuide.jsx';
import ResearchHelp from './ResearchHelp.jsx';
import useAfterRender from './useAfterRender.js';
import {movePassageSelection} from './passageSelection.js';

const readOnly = (c,reviewer,mode='review') => !!c.resolution || c.events.some(e=>e.kind==='annotation_split') || mode==='review' && c.reviews.some(r=>r.reviewer.toLowerCase()===reviewer.trim().toLowerCase());
const datasetName = c => c.id==='starter-v1'?'Starter examples':c.id==='revision-v1'?'Revisions & cancellations':c.name;
const title = c => c.origin ? `${c.origin.corpus_id} · ${c.origin.case_id}` : c.group;

export default function AnnotationReviewer({api,downloadJson,onHelp}) {
  const [cases,setCases]=useState([]),[active,setActive]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [text,setText]=useState(''),[meeting,setMeeting]=useState(new Date().toLocaleDateString('en-CA')),[source,setSource]=useState('synthetic'),[group,setGroup]=useState('');
  const [aliases,setAliases]=useState(''),[permission,setPermission]=useState(false),[checked,setChecked]=useState(false);
  const [reviewer,setReviewer]=useState(''),[independent,setIndependent]=useState(false),[compare,setCompare]=useState(false);
  const [seed,setSeed]=useState('reviewed-corpus-v1'),[snapshot,setSnapshot]=useState(null),[snapshotId,setSnapshotId]=useState(accountStorage.getItem('flow.annotationSnapshot')||'');
  const [library,setLibrary]=useState([]),[corpus,setCorpus]=useState('all'),[importSplit,setImportSplit]=useState('all'),[importNotice,setImportNotice]=useState('');
  const [caseFilter,setCaseFilter]=useState('all'),[splitFilter,setSplitFilter]=useState('all'),[search,setSearch]=useState(''),[offset,setOffset]=useState(0);
  const draft=useAnnotationDraft(api), mounted=useRef(true);
  const afterRender=useAfterRender(!busy);
  const {items,selection,task,owner,deadline,reason}=draft.session?.state || emptyAnnotation();
  const replacements=aliases.split('\n').filter(Boolean).map(line=>line.split('=>').map(s=>s.trim()));
  const aliasError=replacements.some(pair=>pair.length!==2 || !pair[0] || !pair[1]);
  const mappings=Object.fromEntries(replacements.filter(p=>p.length===2 && p[0] && p[1]));
  const escaped=Object.keys(mappings).sort((a,b)=>b.length-a.length).map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
  const preview=escaped.length?text.replace(new RegExp(escaped.join('|'),'g'),s=>mappings[s]):text;
  const frozen=!!active?.events.some(e=>e.kind==='annotation_split');
  const submitted=!!active?.reviews.some(r=>r.reviewer.toLowerCase()===draft.session?.reviewer.toLowerCase());
  const locked=busy || frozen || !!active?.resolution || (draft.session?.mode==='review' && submitted);
  const filtered=cases.filter(c=>(caseFilter==='all'||(caseFilter==='manual'?!c.origin:c.origin?.corpus_id===caseFilter)) &&
    (splitFilter==='all'||c.origin?.split===splitFilter) && `${title(c)} ${c.preview}`.toLowerCase().includes(search.toLowerCase()));
  const visible=filtered.slice(offset,offset+12);

  async function refresh(){const value=await api('/annotations');if(mounted.current)setCases(value);}
  useEffect(()=>{
    mounted.current=true;
    (async()=>{
      try {
        const [listing,catalogue]=await Promise.all([api('/annotations'),api('/annotations/corpora')]);
        if(!mounted.current)return;setCases(listing);setLibrary(catalogue);
        let saved;try{saved=JSON.parse(accountStorage.getItem('flow.annotationSession')||'null');}catch{}
        if(saved){
          const c=await api(`/annotations/${saved.caseId}`);if(!mounted.current)return;
          setActive(c);setReviewer(saved.reviewer);await draft.open(c.id,saved.reviewer,saved.mode,readOnly(c,saved.reviewer,saved.mode));
          if(mounted.current)setCompare(saved.mode==='resolution');
        }
      }catch(e){if(mounted.current)setError(e.message);}
    })();
    return ()=>{mounted.current=false;};
  },[]);
  async function action(fn,focusId){setBusy(true);setError('');try{await fn();if(mounted.current && focusId)afterRender(()=>{const target=document.getElementById(focusId);target?.focus({preventScroll:true});target?.scrollIntoView({block:'start',behavior:'instant'});});}catch(e){if(mounted.current)setError(e.message);}finally{if(mounted.current)setBusy(false);}}
  function adopt(c){draft.close();setActive(c);setCompare(false);setIndependent(false);}
  async function open(id){await action(async()=>{
    const c=await api(`/annotations/${id}`);adopt(c);
    // Resume only this reviewer's own draft; a different identity starts empty.
    if(reviewer.trim())await draft.open(id,reviewer,'review',readOnly(c,reviewer));
  },'active-example-title');}
  async function start(mode='review'){if(!active)return;await action(async()=>{
    await draft.open(active.id,reviewer,mode,readOnly(active,reviewer,mode));setCompare(mode==='resolution');setIndependent(false);
  },'example-transcript');}
  async function create(e){e.preventDefault();await action(async()=>{
    if(aliasError)throw new Error('Use one original => alias pair per line.');
    adopt(await api('/annotations',{method:'POST',body:JSON.stringify({transcript:preview,reference_date:meeting,source,group,permission,anonymized:checked})}));
    await refresh();setText('');setAliases('');setChecked(false);setPermission(false);
  },'active-example-title');}
  async function importCorpus(){await action(async()=>{
    const result=await api('/annotations/import-corpus',{method:'POST',body:JSON.stringify({corpus_id:corpus,split:importSplit})});
    await refresh();setOffset(0);setCaseFilter(corpus);setSplitFilter(importSplit);
    setImportNotice(`${result.imported} examples added; ${result.existing} already present. Expected answers were excluded.`);
  });}
  function select(e){if(locked || !draft.session)return;const el=e.currentTarget,a=el.selectionStart,b=el.selectionEnd;if(a===b)return;
    draft.update({selection:{start:Array.from(el.value.slice(0,a)).length,end:Array.from(el.value.slice(0,b)).length,text:el.value.slice(a,b)}});
  }
  function selectWithKeyboard(event){
    if(locked || !draft.session || event.ctrlKey || event.metaKey || event.altKey || !['ArrowLeft','ArrowRight'].includes(event.key))return;
    event.preventDefault();const el=event.currentTarget,next=movePassageSelection(el.value,el.selectionStart,el.selectionEnd,el.selectionDirection,event.key,event.shiftKey);
    el.setSelectionRange(next.start,next.end,next.direction);select(event);
  }
  function add(){if(!selection || !task.trim())return;draft.update(s=>({...s,items:[...s.items,{task:task.trim(),owner:owner.trim()||'Unknown',deadline:deadline.trim()||'Unknown',evidence:[selection]}],task:'',owner:'Unknown',deadline:'Unknown',selection:null}));}
  function edit(i,k,v){draft.update(s=>({...s,items:s.items.map((item,n)=>n===i?{...item,[k]:v}:item)}));}
  async function submit(resolve=false){await action(async()=>{
    await draft.flush();
    const c=await api(`/annotations/${active.id}/submit`,{method:'POST',body:JSON.stringify({reviewer:draft.session.reviewer,items,independent,...(resolve?{reason}:{})})});
    draft.completed();setActive(c);setIndependent(false);setCompare(false);await refresh();
  });}
  function showComparison(){setCompare(true);if(!locked)draft.update({comparison_opened:true});}
  function exportFiles(value){for(const split of ['dev','test']){
    const url=URL.createObjectURL(new Blob([value.files[split]],{type:'application/x-ndjson'}));const a=document.createElement('a');a.href=url;a.download=`reviewed-${value.snapshot.slice(0,8)}-${split}.jsonl`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }downloadJson(value.manifest,`reviewed-${value.snapshot.slice(0,8)}-manifest.json`);}
  const filter=(setter,value)=>{setter(value);setOffset(0);};
  return <>
    <div className="page-intro"><div><div className="eyebrow accent">BUILD TRUSTWORTHY LABELS</div><h1 tabIndex={-1}>Label & review examples.</h1><p>Write the tasks you expect from a conversation, then have a separate person review it independently. These reference answers help check how well the app finds tasks.</p></div></div>
    <WorkflowGuide id="example-review-guide" title="Build a reliable example set" description="Highlight a passage, record its expected task, and collect a separate review." onHelp={onHelp} steps={[
      {title:'Choose an example',text:'Start with invented practice conversations or add a permitted transcript.',target:'practice-example-title',action:'Choose practice examples'},
      {title:'Label the tasks',text:'Open an example, start your reviewer session, and select the words supporting each expected task.',...(active?{target:'active-example-title',action:'Continue labeling'}:{target:'example-list-title',action:'Find an example'})},
      {title:'Review and lock answers',text:'Collect independent reviews, resolve differences, then lock the agreed answers for comparison.',target:'lock-examples-title',action:'See how locking works'}
    ]}><ResearchHelp mode="examples"/></WorkflowGuide>
    <div className="notice">Reviewers declare their own names and independent work; this app cannot verify either. Each first review starts empty or restores that reviewer’s unfinished draft. Submitted answers cannot be edited.</div>
    {error&&<div className="notice error" role="alert">{error}</div>}
    <section className="panel annotation-panel" aria-label="Practice example import">
      <h2 id="practice-example-title" tabIndex={-1}>Start with practice examples</h2><p>Add up to 84 invented conversations for people to review. Expected tasks, owners, dates, and supporting passages are excluded so you can start with your own answers.</p>
      <div className="field-row"><label className="field-label">Example dataset to import<select aria-label="Example dataset to import" disabled={busy} value={corpus} onChange={e=>setCorpus(e.target.value)}><option value="all">All practice datasets (84 examples)</option>{library.map(c=><option key={c.id} value={c.id}>{datasetName(c)} ({Object.values(c.splits).reduce((n,s)=>n+s.cases,0)} cases)</option>)}</select></label><label className="field-label">Examples to import<select aria-label="Examples to import" disabled={busy} value={importSplit} onChange={e=>setImportSplit(e.target.value)}><option value="all">Both original example sets</option><option value="dev">Original practice examples</option><option value="test">Original reserved test examples</option></select></label></div>
      <button className="button primary" disabled={busy || !library.length} onClick={importCorpus}>Add practice examples</button>
      {importNotice&&<p role="status">{importNotice}</p>}
      <p className="field-hint">Adding the same examples again reuses existing copies. The original dataset stays unchanged. These examples have already been tested; reviewing them does not make them unseen test data. Avoid looking at their original answers before reviewing.</p>
    </section>
    <form className="panel annotation-panel" onSubmit={create}>
      <h2>Import a transcript</h2>
      <TranscriptImport disabled={busy} actionName="Add example for review" onUse={value=>{setText(value);setAliases('');setMeeting('');setChecked(false);setPermission(false);document.getElementById('annotation-meeting-date').focus();}}/>
      <div className="field-row"><label className="field-label">Source<select aria-label="Source" disabled={busy} value={source} onChange={e=>setSource(e.target.value)}><option value="synthetic">Invented conversation</option><option value="real">Permitted real transcript</option></select></label><label className="field-label">Example meeting date<input id="annotation-meeting-date" disabled={busy} type="date" value={meeting} required onChange={e=>setMeeting(e.target.value)}/></label></div>
      <label className="field-label">Related example group<input disabled={busy} value={group} required placeholder="e.g. Product planning — use the same group for related conversations" onChange={e=>setGroup(e.target.value)}/></label>
      <label className="field-label">Transcript to import<textarea disabled={busy} aria-label="Transcript to import" className="transcript" value={text} required maxLength={100000} onChange={e=>{setText(e.target.value);setChecked(false);}}/></label>
      <label className="field-label">Replace identifying details<textarea disabled={busy} aria-label="Replace identifying details" value={aliases} placeholder={'One literal replacement per line: Alice => Person A\nAcme Ltd => Company A'} onChange={e=>{setAliases(e.target.value);setChecked(false);}}/></label>
      <details open={!!aliases}><summary>Preview the exact text to store</summary><pre className="saved-transcript">{preview}</pre></details>
      <p className="field-hint">Only the preview is sent to the server. Replacements are case-sensitive; review names, emails, organizations, and sensitive content manually.</p>
      <label className="keep"><input disabled={busy} type="checkbox" checked={permission} onChange={e=>setPermission(e.target.checked)}/>I have permission to use this material for evaluation</label>
      <label className="keep"><input disabled={busy} type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>I checked the preview for identifying or sensitive information</label>
      <button className="button primary" disabled={busy || !permission || !checked || aliasError}>Add example for review</button>
    </form>
    <section className="panel annotation-panel" aria-label="Example list"><h2 id="example-list-title" tabIndex={-1}>Examples to review <span className="count">{cases.length}</span></h2>
      <div className="field-row"><label className="field-label">Example library<select aria-label="Example library" value={caseFilter} onChange={e=>filter(setCaseFilter,e.target.value)}><option value="all">All examples</option><option value="manual">Manually imported</option>{library.map(c=><option key={c.id} value={c.id}>{datasetName(c)}</option>)}</select></label><label className="field-label">Original example set<select aria-label="Original example set" value={splitFilter} onChange={e=>filter(setSplitFilter,e.target.value)}><option value="all">All example sets</option><option value="dev">Practice examples</option><option value="test">Reserved test examples</option></select></label><label className="field-label">Find example<input value={search} onChange={e=>filter(setSearch,e.target.value)} placeholder="Example ID or conversation text"/></label></div>
      {!filtered.length?<p>No matching examples.</p>:visible.map(c=><div className="annotation-case" key={c.id}><div><strong>{title(c)}</strong><p>{c.preview}</p><small>{c.source==='synthetic'?'Invented':'Real conversation'} · {c.reference_date} · {c.review_count} reviews · {c.status}{c.origin&&` · ${c.origin.split==='dev'?'original practice set':'original reserved test set'}`}</small></div><button className="button secondary" disabled={busy} onClick={()=>open(c.id)}>Label example {c.id.slice(0,6)}</button></div>)}
      {filtered.length>12&&<div className="annotation-pagination"><button className="button secondary" disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-12))}>Previous examples</button><span>{offset+1}–{Math.min(offset+12,filtered.length)} of {filtered.length}</span><button className="button secondary" disabled={offset+12>=filtered.length} onClick={()=>setOffset(offset+12)}>Next examples</button></div>}
    </section>
    {active&&<section className="panel annotation-panel" aria-label="Active example">
      <h2 id="active-example-title" tabIndex={-1}>Label: {title(active)}</h2><p>Meeting {active.reference_date}. Choose a reviewer session, then highlight the exact words that support a task. Missing owners and dates stay Unknown.</p>
      <div className="reviewer-session"><label className="field-label">Reviewer identity<input disabled={busy} value={reviewer} onChange={e=>{setReviewer(e.target.value);setIndependent(false);}} placeholder="A distinct reviewer name or ID"/></label><button className="button secondary" disabled={busy || !reviewer.trim()} onClick={()=>start()}>Start or resume review</button>{active.disagreement&&!active.resolution&&!frozen&&<button className="button secondary" disabled={busy || !reviewer.trim()} onClick={()=>start('resolution')}>Open disagreement resolution</button>}</div>
      {draft.session&&<><SaveFeedback phase={draft.phase} detail={draft.status} onRetry={()=>draft.flush().catch(()=>{})} disabled={locked||draft.conflict}/><p className="field-hint">Editing as <strong>{draft.session.reviewer}</strong> · {draft.session.mode==='resolution'?'Disagreement resolution':'Independent review'}. Changing the identity field takes effect when you start a session.</p>
        {draft.conflict&&<button className="button secondary" disabled={locked} onClick={draft.recover}>Restore my browser draft</button>}
        {locked&&!busy&&<div className="notice">These answers are locked: the review was submitted, or this example has been resolved or locked for comparison.</div>}
      </>}
      <label className="field-label">Example transcript<textarea id="example-transcript" aria-describedby="passage-selection-help" disabled={busy} aria-label="Example transcript" readOnly className="transcript" value={active.transcript} onSelect={select} onKeyDown={selectWithKeyboard}/></label><p id="passage-selection-help" className="field-hint">Highlight words using your mouse, touch selection, or Shift + Left/Right arrow keys. Then enter the expected task below and choose Add labeled action. Example: “Maya will send the notes tomorrow” → task “Send the notes”, owner “Maya”, date based on the meeting date.</p>
      {draft.session&&<>
        {selection&&<blockquote className="annotation-selection" aria-label="Selected supporting passage">{selection.text}</blockquote>}
        <div className="field-row"><label className="field-label">Expected task<input disabled={locked} value={task} onChange={e=>draft.update({task:e.target.value})}/></label><label className="field-label">Expected owner<input disabled={locked} value={owner} onChange={e=>draft.update({owner:e.target.value})}/></label><label className="field-label">Expected deadline<input aria-describedby="expected-date-help" disabled={locked} value={deadline} onChange={e=>draft.update({deadline:e.target.value})}/></label></div>
        <p id="expected-date-help" className="field-hint">Use YYYY-MM-DD for a known date, or Unknown. Submitting a review locks your answers; compare other reviews only afterwards.</p>
        <button className="button secondary" disabled={locked || !selection || !task.trim()} onClick={add}>Add labeled action</button>
        {items.map((item,i)=><article className="annotation-item" key={i}><div className="field-row">{['task','owner','deadline'].map(k=><label className="field-label" key={k}>{k} label {i+1}<input disabled={locked} value={item[k]} onChange={e=>edit(i,k,e.target.value)}/></label>)}</div>{item.evidence.map((e,n)=><blockquote key={n}>{e.text}</blockquote>)}<button className="text-button" disabled={locked || !selection} onClick={()=>draft.update(s=>({...s,items:s.items.map((v,n)=>n===i?{...v,evidence:[...v.evidence,selection]}:v)}))}>Attach selected passage to action {i+1}</button><button className="text-button" disabled={locked} onClick={()=>draft.update(s=>({...s,items:s.items.filter((_,n)=>n!==i)}))}>Remove action {i+1}</button></article>)}
        {draft.session.mode==='review'&&<><label className="keep"><input disabled={locked || draft.session.state.comparison_opened} type="checkbox" checked={independent} onChange={e=>setIndependent(e.target.checked)}/>I labeled this independently without viewing another review</label><button className="button primary" disabled={locked || !independent || draft.session.state.comparison_opened} onClick={()=>submit()}>Submit independent review ({items.length} actions)</button><button className="button secondary" disabled={busy || !submitted} onClick={showComparison}>Compare submitted reviews</button></>}
        {draft.session.mode==='resolution'&&<><label className="field-label">Resolution reason<textarea disabled={locked} aria-label="Resolution reason" value={reason} onChange={e=>draft.update({reason:e.target.value})}/></label><button className="button primary" disabled={locked || !reason.trim()} onClick={()=>submit(true)}>Record disagreement resolution</button></>}
      </>}
      {compare&&<><div className="notice">Comparison opened. {active.disagreement?'Reviewers disagree; record the agreed answer and explain why.':active.status}</div><pre className="json" tabIndex={0}>{JSON.stringify(active.reviews,null,2)}</pre>{draft.session?.mode==='resolution'&&!locked&&active.reviews.map((r,i)=><button key={i} className="button secondary" onClick={()=>draft.update({items:structuredClone(r.items),comparison_opened:true})}>Use {r.reviewer} labels for resolution</button>)}{active.resolution&&<pre className="json" tabIndex={0}>{JSON.stringify(active.resolution,null,2)}</pre>}<button className="button secondary" onClick={()=>downloadJson(active,'annotation-audit.json')}>Download annotation audit</button></>}
    </section>}
    <div className="panel annotation-panel"><h2 id="lock-examples-title" tabIndex={-1}>Lock agreed answers for comparison</h2><p>Only examples with agreed or resolved reviews qualify. Locking saves an uneditable copy and separates practice from reserved test examples. Related conversations stay together; bundled examples share a group per dataset version.</p><label className="field-label">Grouping seed<input aria-describedby="grouping-seed-help" disabled={busy} value={seed} onChange={e=>setSeed(e.target.value)}/></label><p id="grouping-seed-help" className="field-hint">A seed makes the practice/test grouping repeatable. Keep the default unless you need a different grouping.</p><button className="button primary" disabled={busy} onClick={()=>action(async()=>{const value=await api('/annotations/freeze',{method:'POST',body:JSON.stringify({seed,test_fraction:.3})});setSnapshot(value);setSnapshotId(value.snapshot);accountStorage.setItem('flow.annotationSnapshot',value.snapshot);await refresh();})}>Lock reviewed example set</button>{snapshot&&<><p>Locked example set {snapshot.snapshot} · {snapshot.manifest.sources.real} real / {snapshot.manifest.sources.synthetic} cases</p><button className="button secondary" onClick={()=>exportFiles(snapshot)}>Download practice, test, and dataset details</button><button className="button secondary" onClick={()=>downloadJson(snapshot,'reviewed-snapshot.json')}>Download complete example set</button></>}
      <label className="field-label">Saved example set ID<input disabled={busy} placeholder="Paste a saved example set ID" value={snapshotId} onChange={e=>setSnapshotId(e.target.value)} /></label><button className="button secondary" disabled={busy} onClick={()=>action(async()=>setSnapshot(await api(`/annotations/${snapshotId}/export`)))}>Open locked example set</button>
    </div>
  </>;
}
