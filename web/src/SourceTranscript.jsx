import React,{useMemo} from 'react';
export default function SourceTranscript({run,passage,onReturn}){
  const content=useMemo(()=>{
    const chars=Array.from(run.transcript);
    if(!passage || !Number.isInteger(passage.start) || !Number.isInteger(passage.end) || passage.start<0 || passage.end>chars.length || chars.slice(passage.start,passage.end).join('')!==passage.text)return run.transcript;
    return <>{chars.slice(0,passage.start).join('')}<mark>{chars.slice(passage.start,passage.end).join('')}</mark>{chars.slice(passage.end).join('')}</>;
  },[run.transcript,passage]);
  return <section className="panel saved-source-panel" aria-labelledby="saved-source-title"><div className="panel-heading"><div><div className="eyebrow accent">THE ORIGINAL CONVERSATION</div><h2 id="saved-source-title">Source transcript</h2></div><span className="badge neutral">Saved input</span></div><p>Evidence comes from this saved conversation. Edits below are used only when you analyze again.</p><pre id="saved-source" className="source-document" tabIndex={0} role="region" aria-label="Saved source transcript">{content}</pre><div className="source-actions"><p className="form-hint">Use “Locate passage” on a task to highlight its evidence here.</p>{passage&&<button className="text-button" type="button" onClick={onReturn}>Back to task <span aria-hidden="true">↗</span></button>}</div></section>;
}
