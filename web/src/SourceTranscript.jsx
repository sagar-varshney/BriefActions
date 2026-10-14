import React,{useEffect,useMemo,useState} from 'react';
export default function SourceTranscript({run,passage,onReturn}){
  const [open,setOpen]=useState(()=>!matchMedia('(max-width:1100px)').matches);
  useEffect(()=>{const media=matchMedia('(max-width:1100px)'),resize=()=>setOpen(!media.matches);resize();media.addEventListener('change',resize);return()=>media.removeEventListener('change',resize);},[run.id]);
  const content=useMemo(()=>{
    const chars=Array.from(run.transcript);
    if(!passage || !Number.isInteger(passage.start) || !Number.isInteger(passage.end) || passage.start<0 || passage.end>chars.length || chars.slice(passage.start,passage.end).join('')!==passage.text)return run.transcript;
    return <>{chars.slice(0,passage.start).join('')}<mark>{chars.slice(passage.start,passage.end).join('')}</mark>{chars.slice(passage.end).join('')}</>;
  },[run.transcript,passage]);
  return <details className="panel saved-source-panel" open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary className="source-summary"><h2>Source transcript</h2><span className="badge neutral">Original</span><span className="source-toggle-label">{open?'Hide':'Show'}</span></summary><pre id="saved-source" className="source-document" tabIndex={0} role="region" aria-label="Saved source transcript">{content}</pre><div className="source-actions"><p className="form-hint">Use “Locate passage” to highlight the source.</p>{passage&&<button className="text-button" type="button" onClick={onReturn}>Back to task <span aria-hidden="true">↗</span></button>}</div></details>;
}
