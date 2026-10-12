import React, {useRef,useState} from 'react';
import {decodeTranscript,parseTranscript,MAX_FILE_BYTES,MAX_TRANSCRIPT} from './transcriptImport.js';

export default function TranscriptImport({disabled,onUse,actionName='Analyze transcript'}) {
  const [preview,setPreview]=useState(null),[error,setError]=useState(''),[reading,setReading]=useState(false);
  const generation=useRef(0);
  async function choose(event) {
    const file=event.target.files?.[0],version=++generation.current;
    setPreview(null);setError('');
    if(!file){setReading(false);return;}
    setReading(true);
    try {
      if(file.size>MAX_FILE_BYTES)throw new Error('Choose a file smaller than 1 MiB.');
      const parsed=parseTranscript(file.name,decodeTranscript(await file.arrayBuffer()));
      if(version===generation.current)setPreview({...parsed,name:file.name});
    }catch(e){if(version===generation.current)setError(e.message);}
    finally{if(version===generation.current)setReading(false);}
  }
  return <details className="disclosure transcript-import"><summary>Import a transcript file</summary>
    <p id="import-help">Choose TXT, WebVTT, or SRT (up to 1 MiB). Review the text here before using it. Caption times are removed; choose the meeting date separately.</p>
    <label className="field-label" htmlFor="transcript-file">Transcript file</label><input id="transcript-file" type="file" accept=".txt,.vtt,.srt" aria-describedby="import-help" disabled={disabled} onChange={choose}/>
    {reading&&<p role="status">Reading the file…</p>}{error&&<p className="notice error" role="alert">{error}</p>}
    {preview&&<><p role="status">{preview.name} · {preview.format.toUpperCase()}{preview.cues?` · ${preview.cues} captions`:''}</p>
      <label className="field-label" htmlFor="import-preview">Transcript import preview</label><textarea id="import-preview" disabled={disabled} value={preview.transcript} maxLength={MAX_TRANSCRIPT} onChange={e=>setPreview({...preview,transcript:e.target.value})}/>
      <div className="import-actions"><button type="button" className="button secondary" disabled={disabled || !preview.transcript.trim()} onClick={()=>{onUse(preview.transcript);setPreview(null);}}>Use this transcript</button><button type="button" className="text-button" disabled={disabled} onClick={()=>{generation.current++;setPreview(null);}}>Discard preview</button></div>
      <p className="form-hint">Choosing a file stays in your browser. Choosing {actionName} saves only the text you approve.</p></>}
  </details>;
}
