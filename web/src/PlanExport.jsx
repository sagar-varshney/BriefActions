import React,{useRef,useState} from 'react';
import {actionPlan} from './actionPlan.js';

export default function PlanExport({run}){
 const [groupBy,setGroupBy]=useState('owner'),[notice,setNotice]=useState(''),[error,setError]=useState(''),[preview,setPreview]=useState(false),ref=useRef(null);
 const text=actionPlan(run,{groupBy});
 async function copy(){
  setError('');setNotice('');
  try{await navigator.clipboard.writeText(text);setNotice('Action plan copied.');}
  catch{setError('Clipboard access is unavailable. Open the preview and copy the plan manually.');setPreview(true);}
 }
 function download(){
  const url=URL.createObjectURL(new Blob([actionPlan(run,{groupBy,format:'markdown'})],{type:'text/markdown;charset=utf-8'})),link=document.createElement('a');
  link.href=url;link.download=`briefactions-plan-${run.id.slice(0,8)}.md`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('Markdown download prepared.');
 }
 return <section className="plan-export panel" aria-label="Export action plan"><h3>Take your plan with you</h3><p>Copy a readable plan or download Markdown, with current deadlines, correction reasons, and supporting passages. Exports include the whole plan and keep Unknown values.</p><div className="plan-export-controls"><label className="field-label">Group action plan by<select aria-label="Group action plan by" value={groupBy} onChange={e=>{setGroupBy(e.target.value);setNotice('');setError('');}}><option value="owner">Owner</option><option value="deadline">Deadline</option><option value="none">Original task order</option></select></label><button className="button primary" type="button" onClick={copy}>Copy action plan</button><button className="button secondary" type="button" onClick={download}>Download Markdown</button></div>{notice&&<p role="status">{notice}</p>}{error&&<p className="notice error" role="alert">{error}</p>}<details open={preview} onToggle={e=>setPreview(e.currentTarget.open)}><summary>Preview action plan</summary><label className="sr-only" htmlFor="action-plan-preview">Action plan preview</label><textarea id="action-plan-preview" ref={ref} readOnly value={text}/><button className="text-button" type="button" onClick={()=>{ref.current?.focus();ref.current?.select();}}>Select plan text</button></details></section>;
}
