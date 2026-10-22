import React,{useEffect,useMemo,useRef,useState} from 'react';
import Icon from './Icon.jsx';
import ContextHelp from './ContextHelp.jsx';
export default function SourceTranscript({run,passage,onReturn}){
  const panel=useRef(null);
  const [open,setOpen]=useState(()=>!matchMedia('(max-width:1100px)').matches);
  useEffect(()=>{const media=matchMedia('(max-width:1100px)'),resize=()=>setOpen(!media.matches||!!panel.current?.contains(document.activeElement));resize();media.addEventListener('change',resize);return()=>media.removeEventListener('change',resize);},[run.id]);
  const content=useMemo(()=>{
    const chars=Array.from(run.transcript);
    if(!passage || !Number.isInteger(passage.start) || !Number.isInteger(passage.end) || passage.start<0 || passage.end>chars.length || chars.slice(passage.start,passage.end).join('')!==passage.text)return run.transcript;
    return <>{chars.slice(0,passage.start).join('')}<mark>{chars.slice(passage.start,passage.end).join('')}</mark>{chars.slice(passage.end).join('')}</>;
  },[run.transcript,passage]);
  return <details ref={panel} className="panel saved-source-panel" open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary className="source-summary"><h2>Source transcript</h2><span className="badge neutral">Original</span><span className="source-toggle-label">{open?'Hide':'Show'}</span></summary><pre id="saved-source" className="source-document" tabIndex={0} role="region" aria-label="Saved source transcript">{content}</pre><ContextHelp title="What is a supporting passage?"><p>The exact words linked to a suggested or confirmed task. Use Locate passage to highlight those words in this saved conversation.</p><p>Changing a task, owner, or deadline records your correction separately. It never rewrites the original passage. Read the surrounding conversation to check the meaning.</p></ContextHelp><div className="source-actions"><p className="form-hint">Use “Locate passage” to highlight the source.</p>{passage&&<button className="text-button" type="button" onClick={onReturn}>Back to task <Icon name="external" size={14}/></button>}</div></details>;
}
