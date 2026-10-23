import React from 'react';
import Icon from './Icon.jsx';

const labels={saving:'Saving…',saved:'Saved',local:'Saved in this browser',error:'Couldn’t save',info:'Review draft'};
export default function SaveFeedback({phase='info',detail,onRetry,disabled=false}){
 if(!detail)return null;
 return <div className={`save-feedback save-feedback-${phase}`}>
  <p role="status" aria-live="polite" aria-atomic="true"><Icon name={phase==='saving'?'spinner':phase==='error'?'attention':phase==='saved'||phase==='local'?'check':'quote'} size={16} className={phase==='saving'?'icon-spin':''}/><span><strong>{labels[phase]}</strong><span className="save-feedback-detail">{detail}</span></span></p>
  {phase==='error'&&onRetry&&<button type="button" className="text-button" disabled={disabled} onClick={onRetry}>Retry saving draft</button>}
 </div>;
}
