import accountStorage from './accountStorage.js';
import React,{useEffect,useRef,useState} from 'react';
import useAnnotationDraft,{emptyAnnotation} from './useAnnotationDraft';

const readOnly = (c,reviewer,mode='review') => !!c.resolution || c.events.some(e=>e.kind==='annotation_split') || mode==='review' && c.reviews.some(r=>r.reviewer.toLowerCase()===reviewer.trim().toLowerCase());
const title = c => c.origin ? `${c.origin.corpus_id} · ${c.origin.case_id}` : c.group;

export default function AnnotationReviewer({api,downloadJson}) {
  const [cases,setCases]=useState([]),[active,setActive]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [text,setText]=useState(''),[meeting,setMeeting]=useState(new Date().toLocaleDateString('en-CA')),[source,setSource]=useState('synthetic'),[group,setGroup]=useState('');
  const [aliases,setAliases]=useState(''),[permission,setPermission]=useState(false),[checked,setChecked]=useState(false);
  const [reviewer,setReviewer]=useState(''),[independent,setIndependent]=useState(false),[compare,setCompare]=useState(false);
  const [seed,setSeed]=useState('reviewed-corpus-v1'),[snapshot,setSnapshot]=useState(null),[snapshotId,setSnapshotId]=useState(accountStorage.getItem('flow.annotationSnapshot')||'');
  const [library,setLibrary]=useState([]),[corpus,setCorpus]=useState('all'),[importSplit,setImportSplit]=useState('all'),[importNotice,setImportNotice]=useState('');
  const [caseFilter,setCaseFilter]=useState('all'),[splitFilter,setSplitFilter]=useState('all'),[search,setSearch]=useState(''),[offset,setOffset]=useState(0);
  const draft=useAnnotationDraft(api), mounted=useRef(true);
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
  async function action(fn){setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{if(mounted.current)setBusy(false);}}
  function adopt(c){draft.close();setActive(c);setCompare(false);setIndependent(false);}
  async function open(id){await action(async()=>{
    const c=await api(`/annotations/${id}`);adopt(c);
    // Resume only this reviewer's own draft; a different identity starts empty.
    if(reviewer.trim())await draft.open(id,reviewer,'review',readOnly(c,reviewer));
  });}
  async function start(mode='review'){if(!active)return;await action(async()=>{
    await draft.open(active.id,reviewer,mode,readOnly(active,reviewer,mode));setCompare(mode==='resolution');setIndependent(false);
  });}
  async function create(e){e.preventDefault();await action(async()=>{
    if(aliasError)throw new Error('Use one original => alias pair per line.');
    adopt(await api('/annotations',{method:'POST',body:JSON.stringify({transcript:preview,reference_date:meeting,source,group,permission,anonymized:checked})}));
    await refresh();setText('');setAliases('');setChecked(false);setPermission(false);
  });}
  async function importCorpus(){await action(async()=>{
    const result=await api('/annotations/import-corpus',{method:'POST',body:JSON.stringify({corpus_id:corpus,split:importSplit})});
    await refresh();setOffset(0);setCaseFilter(corpus);setSplitFilter(importSplit);
    setImportNotice(`${result.imported} cases imported; ${result.existing} already present. Gold labels were excluded.`);
  });}
  function select(e){if(locked || !draft.session)return;const el=e.currentTarget,a=el.selectionStart,b=el.selectionEnd;if(a===b)return;
    draft.update({selection:{start:Array.from(el.value.slice(0,a)).length,end:Array.from(el.value.slice(0,b)).length,text:el.value.slice(a,b)}});
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
    <div className="page-intro"><div><div className="eyebrow accent">BUILD TRUSTWORTHY LABELS</div><h1>Annotation reviewer.</h1><p>Label exact passages, collect separate reviews, and resolve disagreements before freezing evaluation data.</p></div></div>
    <div className="notice">Reviewer identities and independence are self-attested in this workspace. First-pass labels start empty; only your own unfinished draft is restored. Submitted reviews stay immutable.</div>
    {error&&<div className="notice error" role="alert">{error}</div>}
    <section className="panel annotation-panel" aria-label="Bundled corpus import">
      <h2>Review the existing evaluation corpus</h2><p>Import 84 synthetic transcripts for human review. Gold tasks, owners, deadlines, supporting spans, and annotation explanations are excluded.</p>
      <div className="field-row"><label className="field-label">Corpus to import<select aria-label="Corpus to import" disabled={busy} value={corpus} onChange={e=>setCorpus(e.target.value)}><option value="all">All bundled corpora (84 cases)</option>{library.map(c=><option key={c.id} value={c.id}>{c.name} ({Object.values(c.splits).reduce((n,s)=>n+s.cases,0)} cases)</option>)}</select></label><label className="field-label">Split to import<select aria-label="Split to import" disabled={busy} value={importSplit} onChange={e=>setImportSplit(e.target.value)}><option value="all">Both original splits</option><option value="dev">Original development</option><option value="test">Original held out</option></select></label></div>
      <button className="button primary" disabled={busy || !library.length} onClick={importCorpus}>Import bundled cases</button>
      {importNotice&&<p role="status">{importNotice}</p>}
      <p className="field-hint">Repeated imports reuse existing cases. Original corpus files and gold labels remain unchanged. These cases have already been evaluated; reviewing them does not make them unseen held-out data. Reviewers should avoid inspecting their original labels in the Evaluation lab.</p>
    </section>
    <form className="panel annotation-panel" onSubmit={create}>
      <h2>Import a transcript</h2>
      <div className="field-row"><label className="field-label">Source<select aria-label="Source" disabled={busy} value={source} onChange={e=>setSource(e.target.value)}><option value="synthetic">Synthetic</option><option value="real">Permitted real transcript</option></select></label><label className="field-label">Annotation meeting date<input disabled={busy} type="date" value={meeting} required onChange={e=>setMeeting(e.target.value)}/></label></div>
      <label className="field-label">Source group<input disabled={busy} value={group} required placeholder="Same meeting or scenario family = same group" onChange={e=>setGroup(e.target.value)}/></label>
      <label className="field-label">Transcript to import<textarea disabled={busy} aria-label="Transcript to import" className="transcript" value={text} required maxLength={100000} onChange={e=>{setText(e.target.value);setChecked(false);}}/></label>
      <label className="field-label">Anonymization replacements<textarea disabled={busy} aria-label="Anonymization replacements" value={aliases} placeholder={'One literal replacement per line: Alice => Person A\nAcme Ltd => Company A'} onChange={e=>{setAliases(e.target.value);setChecked(false);}}/></label>
      <details open={!!aliases}><summary>Preview the exact text to store</summary><pre className="saved-transcript">{preview}</pre></details>
      <p className="field-hint">Only the preview is sent to the server. Replacements are case-sensitive; review names, emails, organizations, and sensitive content manually.</p>
      <label className="keep"><input disabled={busy} type="checkbox" checked={permission} onChange={e=>setPermission(e.target.checked)}/>I have permission to use this material for evaluation</label>
      <label className="keep"><input disabled={busy} type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>I checked the preview for identifying or sensitive information</label>
      <button className="button primary" disabled={busy || !permission || !checked || aliasError}>Import for annotation</button>
    </form>
    <section className="panel annotation-panel" aria-label="Annotation case list"><h2>Annotation cases <span className="count">{cases.length}</span></h2>
      <div className="field-row"><label className="field-label">Case library<select aria-label="Case library" value={caseFilter} onChange={e=>filter(setCaseFilter,e.target.value)}><option value="all">All cases</option><option value="manual">Manually imported</option>{library.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="field-label">Original split<select aria-label="Original split" value={splitFilter} onChange={e=>filter(setSplitFilter,e.target.value)}><option value="all">All splits</option><option value="dev">Development</option><option value="test">Held out</option></select></label><label className="field-label">Find annotation case<input value={search} onChange={e=>filter(setSearch,e.target.value)} placeholder="Case ID or transcript text"/></label></div>
      {!filtered.length?<p>No matching cases.</p>:visible.map(c=><div className="annotation-case" key={c.id}><div><strong>{title(c)}</strong><p>{c.preview}</p><small>{c.source} · {c.reference_date} · {c.review_count} reviews · {c.status}{c.origin&&` · original ${c.origin.split}`}</small></div><button className="button secondary" disabled={busy} onClick={()=>open(c.id)}>Label case {c.id.slice(0,6)}</button></div>)}
      {filtered.length>12&&<div className="annotation-pagination"><button className="button secondary" disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-12))}>Previous cases</button><span>{offset+1}–{Math.min(offset+12,filtered.length)} of {filtered.length}</span><button className="button secondary" disabled={offset+12>=filtered.length} onClick={()=>setOffset(offset+12)}>Next cases</button></div>}
    </section>
    {active&&<section className="panel annotation-panel" aria-label="Active annotation case">
      <h2>Label: {title(active)}</h2><p>Meeting {active.reference_date}. Choose a reviewer session, then select exact supporting passages. Missing owners and exact deadlines stay Unknown.</p>
      <div className="reviewer-session"><label className="field-label">Reviewer identity<input disabled={busy} value={reviewer} onChange={e=>{setReviewer(e.target.value);setIndependent(false);}} placeholder="A distinct reviewer name or ID"/></label><button className="button secondary" disabled={busy || !reviewer.trim()} onClick={()=>start()}>Start or resume review</button>{active.disagreement&&!active.resolution&&!frozen&&<button className="button secondary" disabled={busy || !reviewer.trim()} onClick={()=>start('resolution')}>Open disagreement resolution</button>}</div>
      {draft.session&&<><p role="status" className="form-hint">{draft.status}</p><p className="field-hint">Editing as <strong>{draft.session.reviewer}</strong> · {draft.session.mode==='resolution'?'Disagreement resolution':'Independent review'}. Changing the identity field takes effect when you start a session.</p>
        {draft.conflict&&<button className="button secondary" disabled={locked} onClick={draft.recover}>Restore my browser draft</button>}
        {locked&&!busy&&<div className="notice">This session is read-only: its review was submitted, or the case is resolved or frozen.</div>}
      </>}
      <label className="field-label">Annotation transcript<textarea disabled={busy} aria-label="Annotation transcript" readOnly className="transcript" value={active.transcript} onSelect={select}/></label>
      {draft.session&&<>
        {selection&&<blockquote className="annotation-selection" aria-label="Selected supporting passage">{selection.text}</blockquote>}
        <div className="field-row"><label className="field-label">Annotation task<input disabled={locked} value={task} onChange={e=>draft.update({task:e.target.value})}/></label><label className="field-label">Annotation owner<input disabled={locked} value={owner} onChange={e=>draft.update({owner:e.target.value})}/></label><label className="field-label">Annotation deadline<input disabled={locked} value={deadline} onChange={e=>draft.update({deadline:e.target.value})}/></label></div>
        <button className="button secondary" disabled={locked || !selection || !task.trim()} onClick={add}>Add labeled action</button>
        {items.map((item,i)=><article className="annotation-item" key={i}><div className="field-row">{['task','owner','deadline'].map(k=><label className="field-label" key={k}>{k} label {i+1}<input disabled={locked} value={item[k]} onChange={e=>edit(i,k,e.target.value)}/></label>)}</div>{item.evidence.map((e,n)=><blockquote key={n}>{e.text}</blockquote>)}<button className="text-button" disabled={locked || !selection} onClick={()=>draft.update(s=>({...s,items:s.items.map((v,n)=>n===i?{...v,evidence:[...v.evidence,selection]}:v)}))}>Attach selected passage to action {i+1}</button><button className="text-button" disabled={locked} onClick={()=>draft.update(s=>({...s,items:s.items.filter((_,n)=>n!==i)}))}>Remove action {i+1}</button></article>)}
        {draft.session.mode==='review'&&<><label className="keep"><input disabled={locked || draft.session.state.comparison_opened} type="checkbox" checked={independent} onChange={e=>setIndependent(e.target.checked)}/>I labeled this independently without viewing another review</label><button className="button primary" disabled={locked || !independent || draft.session.state.comparison_opened} onClick={()=>submit()}>Submit independent review ({items.length} actions)</button><button className="button secondary" disabled={busy || !submitted} onClick={showComparison}>Compare submitted reviews</button></>}
        {draft.session.mode==='resolution'&&<><label className="field-label">Resolution reason<textarea disabled={locked} aria-label="Resolution reason" value={reason} onChange={e=>draft.update({reason:e.target.value})}/></label><button className="button primary" disabled={locked || !reason.trim()} onClick={()=>submit(true)}>Record disagreement resolution</button></>}
      </>}
      {compare&&<><div className="notice">Comparison opened. {active.disagreement?'Reviewers disagree; record an adjudication.':active.status}</div><pre className="json">{JSON.stringify(active.reviews,null,2)}</pre>{draft.session?.mode==='resolution'&&!locked&&active.reviews.map((r,i)=><button key={i} className="button secondary" onClick={()=>draft.update({items:structuredClone(r.items),comparison_opened:true})}>Use {r.reviewer} labels for resolution</button>)}{active.resolution&&<pre className="json">{JSON.stringify(active.resolution,null,2)}</pre>}<button className="button secondary" onClick={()=>downloadJson(active,'annotation-audit.json')}>Download annotation audit</button></>}
    </section>}
    <div className="panel annotation-panel"><h2>Freeze a fresh evaluation split</h2><p>Only agreed or resolved cases qualify. Related source groups stay together. Bundled cases share a group per corpus version. Frozen cases cannot be relabeled.</p><label className="field-label">Split seed<input disabled={busy} value={seed} onChange={e=>setSeed(e.target.value)}/></label><button className="button primary" disabled={busy} onClick={()=>action(async()=>{const value=await api('/annotations/freeze',{method:'POST',body:JSON.stringify({seed,test_fraction:.3})});setSnapshot(value);setSnapshotId(value.snapshot);accountStorage.setItem('flow.annotationSnapshot',value.snapshot);await refresh();})}>Freeze reviewed dataset</button>{snapshot&&<><p>Snapshot {snapshot.snapshot} · {snapshot.manifest.sources.real} real / {snapshot.manifest.sources.synthetic} cases</p><button className="button secondary" onClick={()=>exportFiles(snapshot)}>Download dev, held-out, and manifest</button><button className="button secondary" onClick={()=>downloadJson(snapshot,'reviewed-snapshot.json')}>Download complete snapshot</button></>}
      <label className="field-label">Existing snapshot ID<input disabled={busy} placeholder="Paste a saved snapshot ID" value={snapshotId} onChange={e=>setSnapshotId(e.target.value)} /></label><button className="button secondary" disabled={busy} onClick={()=>action(async()=>setSnapshot(await api(`/annotations/${snapshotId}/export`)))}>Load frozen snapshot</button>
    </div>
  </>;
}
