import React,{useEffect,useState} from 'react';

export default function AnnotationReviewer({api,downloadJson}) {
  const [cases,setCases]=useState([]),[active,setActive]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [text,setText]=useState(''),[meeting,setMeeting]=useState('2026-10-11'),[source,setSource]=useState('synthetic'),[group,setGroup]=useState('');
  const [aliases,setAliases]=useState(''),[permission,setPermission]=useState(false),[checked,setChecked]=useState(false);
  const [reviewer,setReviewer]=useState(''),[independent,setIndependent]=useState(false),[items,setItems]=useState([]),[selection,setSelection]=useState(null);
  const [task,setTask]=useState(''),[owner,setOwner]=useState('Unknown'),[deadline,setDeadline]=useState('Unknown');
  const [compare,setCompare]=useState(false),[reason,setReason]=useState(''),[seed,setSeed]=useState('reviewed-corpus-v1'),[snapshot,setSnapshot]=useState(null),[snapshotId,setSnapshotId]=useState(localStorage.getItem('flow.annotationSnapshot')||'');
  const replacements=aliases.split('\n').filter(Boolean).map(line=>line.split('=>').map(s=>s.trim()));
  const aliasError=replacements.some(pair=>pair.length!==2 || !pair[0] || !pair[1]);
  // Single pass: replacements cannot accidentally rewrite each other's aliases.
  const mappings=Object.fromEntries(replacements.filter(p=>p.length===2 && p[0] && p[1]));
  const escaped=Object.keys(mappings).sort((a,b)=>b.length-a.length).map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
  const preview=escaped.length?text.replace(new RegExp(escaped.join('|'),'g'),s=>mappings[s]):text;
  async function refresh(){setCases(await api('/annotations'));}
  useEffect(()=>{refresh().catch(e=>setError(e.message));},[]);
  async function action(fn){setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}}
  function adopt(c){setActive(c);setItems([]);setSelection(null);setCompare(false);setIndependent(false);setReason('');}
  async function open(id){await action(async()=>adopt(await api(`/annotations/${id}`)));}
  async function create(e){e.preventDefault();await action(async()=>{
    if(aliasError)throw new Error('Use one original => alias pair per line.');
    adopt(await api('/annotations',{method:'POST',body:JSON.stringify({transcript:preview,reference_date:meeting,source,group,permission,anonymized:checked})}));
    await refresh();setText('');setAliases('');setChecked(false);setPermission(false);
  });}
  function select(e){const el=e.currentTarget;const a=el.selectionStart,b=el.selectionEnd;if(a===b)return;
    // Browser uses UTF-16; Python evidence offsets count Unicode code points.
    const start=Array.from(el.value.slice(0,a)).length,end=Array.from(el.value.slice(0,b)).length;
    setSelection({start,end,text:el.value.slice(a,b)});
  }
  function add(){if(!selection || !task.trim())return;setItems(old=>[...old,{task:task.trim(),owner:owner.trim()||'Unknown',deadline:deadline.trim()||'Unknown',evidence:[selection]}]);setTask('');setOwner('Unknown');setDeadline('Unknown');setSelection(null);}
  function edit(i,k,v){setItems(old=>old.map((item,n)=>n===i?{...item,[k]:v}:item));}
  async function submit(resolve=false){await action(async()=>{
    const c=await api(`/annotations/${active.id}/submit`,{method:'POST',body:JSON.stringify({reviewer,items,independent,...(resolve?{reason}:{})})});
    adopt(c);await refresh();
  });}
  function exportFiles(value){for(const split of ['dev','test']){
    const url=URL.createObjectURL(new Blob([value.files[split]],{type:'application/x-ndjson'}));const a=document.createElement('a');a.href=url;a.download=`reviewed-${value.snapshot.slice(0,8)}-${split}.jsonl`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }downloadJson(value.manifest,`reviewed-${value.snapshot.slice(0,8)}-manifest.json`);}
  return <>
    <div className="page-intro"><div><div className="eyebrow accent">BUILD TRUSTWORTHY LABELS</div><h1>Annotation reviewer.</h1><p>Label exact passages, collect separate reviews, and resolve disagreements before freezing evaluation data.</p></div></div>
    <div className="notice">Reviewer identities and independence are self-attested on this local app. First-pass labels start empty; compare only after submitting. Real transcripts require permission and a manual privacy check.</div>
    {error&&<div className="notice error" role="alert">{error}</div>}
    <form className="panel annotation-panel" onSubmit={create}>
      <h2>Import a transcript</h2>
      <div className="field-row"><label className="field-label">Source<select disabled={busy} value={source} onChange={e=>setSource(e.target.value)}><option value="synthetic">Synthetic</option><option value="real">Permitted real transcript</option></select></label><label className="field-label">Annotation meeting date<input disabled={busy} type="date" value={meeting} required onChange={e=>setMeeting(e.target.value)}/></label></div>
      <label className="field-label">Source group<input disabled={busy} value={group} required placeholder="Same meeting or scenario family = same group" onChange={e=>setGroup(e.target.value)}/></label>
      <label className="field-label">Transcript to import<textarea disabled={busy} className="transcript" value={text} required maxLength={100000} onChange={e=>{setText(e.target.value);setChecked(false);}}/></label>
      <label className="field-label">Anonymization replacements<textarea disabled={busy} value={aliases} placeholder={'One literal replacement per line: Alice => Person A\nAcme Ltd => Company A'} onChange={e=>{setAliases(e.target.value);setChecked(false);}}/></label>
      <details open={!!aliases}><summary>Preview the exact text to store</summary><pre className="saved-transcript">{preview}</pre></details>
      <p className="field-hint">Only the preview is sent to the server. Replacements are case-sensitive; review names, emails, organizations, and sensitive content manually.</p>
      <label className="keep"><input disabled={busy} type="checkbox" checked={permission} onChange={e=>setPermission(e.target.checked)}/>I have permission to use this material for evaluation</label>
      <label className="keep"><input disabled={busy} type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>I checked the preview for identifying or sensitive information</label>
      <button className="button primary" disabled={busy || !permission || !checked || aliasError}>Import for annotation</button>
    </form>
    <div className="panel annotation-panel"><h2>Annotation cases</h2>{cases.length===0?<p>No imported cases yet.</p>:cases.map(c=><div className="annotation-case" key={c.id}><div><strong>{c.group}</strong><p>{c.preview}</p><small>{c.source} · {c.reference_date} · {c.review_count} reviews · {c.status}</small></div><button className="button secondary" disabled={busy} onClick={()=>open(c.id)}>Label case {c.id.slice(0,6)}</button></div>)}</div>
    {active&&<section className="panel annotation-panel" aria-label="Active annotation case">
      <h2>Label: {active.group}</h2><p>Meeting {active.reference_date}. Select text in the transcript to attach exact supporting evidence. Include every committed action; empty labels explicitly mean no actions.</p>
      <label className="field-label">Annotation transcript<textarea disabled={busy} aria-label="Annotation transcript" readOnly className="transcript" value={active.transcript} onSelect={select}/></label>
      {selection&&<blockquote>{selection.text}</blockquote>}
      <div className="field-row"><label className="field-label">Annotation task<input disabled={busy} value={task} onChange={e=>setTask(e.target.value)}/></label><label className="field-label">Annotation owner<input disabled={busy} value={owner} onChange={e=>setOwner(e.target.value)}/></label><label className="field-label">Annotation deadline<input disabled={busy} value={deadline} onChange={e=>setDeadline(e.target.value)}/></label></div>
      <button className="button secondary" disabled={!selection || !task.trim()} onClick={add}>Add labeled action</button>
      {items.map((item,i)=><article className="annotation-item" key={i}><div className="field-row">{['task','owner','deadline'].map(k=><label className="field-label" key={k}>{k} label {i+1}<input disabled={busy} value={item[k]} onChange={e=>edit(i,k,e.target.value)}/></label>)}</div>{item.evidence.map((e,n)=><blockquote key={n}>{e.text}</blockquote>)}<button className="text-button" disabled={!selection} onClick={()=>setItems(old=>old.map((v,n)=>n===i?{...v,evidence:[...v.evidence,selection]}:v))}>Attach selected passage to action {i+1}</button><button className="text-button" onClick={()=>setItems(old=>old.filter((_,n)=>n!==i))}>Remove action {i+1}</button></article>)}
      <label className="field-label">Reviewer identity<input disabled={busy} value={reviewer} onChange={e=>setReviewer(e.target.value)} placeholder="A distinct reviewer name or ID"/></label>
      <label className="keep"><input disabled={busy} type="checkbox" checked={independent} onChange={e=>setIndependent(e.target.checked)}/>I labeled this independently without viewing another review</label>
      <button className="button primary" disabled={busy || !independent || !reviewer.trim() || compare || !!active.resolution} onClick={()=>submit()}>Submit independent review ({items.length} actions)</button>
      <button className="button secondary" disabled={!active.reviews.some(r=>r.reviewer.toLowerCase()===reviewer.trim().toLowerCase())} onClick={()=>setCompare(true)}>Compare submitted reviews</button>
      {compare&&<><div className="notice">Comparison opened. Start a new first-pass session by reopening the case. {active.disagreement?'Reviewers disagree; record an adjudication.':active.status}</div><pre className="json">{JSON.stringify(active.reviews,null,2)}</pre>{active.disagreement&&!active.resolution&&<><p>Build the resolved labels above, or start from a submitted review and edit it.</p>{active.reviews.map((r,i)=><button key={i} className="button secondary" onClick={()=>setItems(structuredClone(r.items))}>Use {r.reviewer} labels for resolution</button>)}<label className="field-label">Resolution reason<textarea disabled={busy} value={reason} onChange={e=>setReason(e.target.value)}/></label><button className="button primary" disabled={busy || !reason.trim() || !reviewer.trim()} onClick={()=>submit(true)}>Record disagreement resolution</button></>}{active.resolution&&<pre className="json">{JSON.stringify(active.resolution,null,2)}</pre>}<button className="button secondary" onClick={()=>downloadJson(active,'annotation-audit.json')}>Download annotation audit</button></>}
    </section>}
    <div className="panel annotation-panel"><h2>Freeze a fresh evaluation split</h2><p>Only agreed or resolved cases qualify. Related source groups stay together. Frozen cases cannot receive further labels; exported files have content hashes.</p><label className="field-label">Split seed<input disabled={busy} value={seed} onChange={e=>setSeed(e.target.value)}/></label><button className="button primary" disabled={busy} onClick={()=>action(async()=>{const value=await api('/annotations/freeze',{method:'POST',body:JSON.stringify({seed,test_fraction:.3})});setSnapshot(value);setSnapshotId(value.snapshot);localStorage.setItem('flow.annotationSnapshot',value.snapshot);await refresh();})}>Freeze reviewed dataset</button>{snapshot&&<><p>Snapshot {snapshot.snapshot} · {snapshot.manifest.sources.real} real / {snapshot.manifest.sources.synthetic} synthetic cases</p><button className="button secondary" onClick={()=>exportFiles(snapshot)}>Download dev, held-out, and manifest</button><button className="button secondary" onClick={()=>downloadJson(snapshot,'reviewed-snapshot.json')}>Download complete snapshot</button></>}
    <label className="field-label">Existing snapshot ID<input disabled={busy} placeholder="Paste a saved snapshot ID" value={snapshotId} onChange={e=>setSnapshotId(e.target.value)} /></label><button className="button secondary" disabled={busy} onClick={()=>action(async()=>setSnapshot(await api(`/annotations/${snapshotId}/export`)))}>Load frozen snapshot</button></div>
  </>;
}
