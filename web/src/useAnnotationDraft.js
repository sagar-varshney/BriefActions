import accountStorage from './accountStorage.js';
import {useEffect,useRef,useState} from 'react';

export const emptyAnnotation = () => ({items:[],selection:null,task:'',owner:'Unknown',deadline:'Unknown',reason:'',comparison_opened:false});
const identity = (id, reviewer, mode) => `${id}:${reviewer.trim().toLowerCase()}:${mode}`;
const loadJson = key => {try{return JSON.parse(accountStorage.getItem(key)||'null');}catch{return null;}};

export default function useAnnotationDraft(api) {
  const [session,setSession]=useState(null),[status,setStatus]=useState(''),[conflict,setConflict]=useState(false);
  const sessionRef=useRef(null),timers=useRef(new Map()),queues=useRef(new Map()),versions=useRef(new Map()),epoch=useRef(0),edits=useRef(0);
  const [client]=useState(()=>{let value=sessionStorage.getItem('flow.annotationClient');if(!value){value=crypto.randomUUID();sessionStorage.setItem('flow.annotationClient',value);}return value;});
  const keyFor = key => `flow.annotationDraft.${client}.${key}`;
  function cache(key,value){try{accountStorage.setItem(keyFor(key),JSON.stringify(value));return true;}catch{setStatus('Browser storage unavailable. Keep this page open until the history save finishes.');return false;}}
  function notice(key,message){if(sessionRef.current?.key===key)setStatus(message);}
  async function enqueue(value,editId) {
    const key=value.key;
    const previous=queues.current.get(key)||Promise.resolve();
    const queued=previous.catch(()=>{}).then(async()=>{
      try {
        const saved=await api(`/annotations/${value.caseId}/draft`,{method:'POST',body:JSON.stringify({reviewer:value.reviewer,mode:value.mode,state:value.state,
          version:versions.current.get(key)||0,client_id:client,edit_id:editId})});
        versions.current.set(key,saved.version);
        const cached=loadJson(keyFor(key));
        const dirty=!!cached && cached.edit_id!==editId;
        if(cached)cache(key,{...cached,version:saved.version,dirty});
        notice(key,dirty?'Latest edits saved in this browser; saving to history…':'Annotation draft saved to history.');
      } catch(e) {
        notice(key,`Browser draft kept. History save failed: ${e.message}`);
        if(sessionRef.current?.key===key && /another tab/.test(e.message))setConflict(true);
        throw e;
      }
    });
    queues.current.set(key,queued);queued.catch(()=>{});return queued;
  }
  function schedule(value,editId){
    clearTimeout(timers.current.get(value.key));
    timers.current.set(value.key,setTimeout(()=>{timers.current.delete(value.key);enqueue(value,editId).catch(()=>{});},450));
  }
  function pause(){
    ++epoch.current;
    for(const timer of timers.current.values())clearTimeout(timer);
    timers.current.clear();
  }
  async function open(caseId,reviewer,mode='review',readOnly=false) {
    pause();const current=epoch.current,key=identity(caseId,reviewer,mode);
    await (queues.current.get(key)||Promise.resolve()).catch(()=>{});
    const saved=await api(`/annotations/${caseId}/draft?reviewer=${encodeURIComponent(reviewer.trim())}&mode=${mode}`);
    if(current!==epoch.current)return;
    versions.current.set(key,saved?.version||0);
    const cached=loadJson(keyFor(key));
    const compatible=cached && (cached.version===(saved?.version||0) || saved?.client_id===client && (saved.edit_id||0)<=(cached.edit_id||0));
    const state=compatible?cached.state:saved?.state || emptyAnnotation();
    const value={key,caseId,reviewer:reviewer.trim(),mode,state};
    sessionRef.current=value;setSession(value);
    edits.current=Math.max(edits.current,cached?.edit_id||0,saved?.edit_id||0);
    const different=!!cached?.dirty && !compatible;
    setConflict(different);
    setStatus(different?'A newer history draft exists. Your browser copy is preserved for recovery.':cached||saved?'Restored unfinished annotation draft.':'New independent draft. Labels start empty.');
    accountStorage.setItem('flow.annotationSession',JSON.stringify({caseId,reviewer:value.reviewer,mode}));
    if(compatible && cached.dirty && !readOnly)schedule(value,cached.edit_id);
  }
  function update(patch) {
    const old=sessionRef.current;if(!old)return;
    const state=typeof patch==='function'?patch(old.state):{...old.state,...patch};
    const value={...old,state},editId=++edits.current;
    sessionRef.current=value;setSession(value);
    const stored=cache(value.key,{state,version:versions.current.get(value.key)||0,edit_id:editId,dirty:true});
    if(stored)setStatus('Annotation draft saved in this browser; saving to history…');
    schedule(value,editId);
  }
  async function flush(){
    const value=sessionRef.current;if(!value)return;
    clearTimeout(timers.current.get(value.key));timers.current.delete(value.key);
    const cached=loadJson(keyFor(value.key));
    // Flush even if storage is unavailable; confirmation uses the exact current state.
    await enqueue(value,cached?.edit_id || ++edits.current);
  }
  function completed(){
    const old=sessionRef.current;if(!old)return;
    clearTimeout(timers.current.get(old.key));timers.current.delete(old.key);
    accountStorage.removeItem(keyFor(old.key));
    versions.current.set(old.key,0);
    const value={...old,state:emptyAnnotation()};sessionRef.current=value;setSession(value);setConflict(false);setStatus('Review submitted. Its saved labels are immutable.');
  }
  function close(){pause();sessionRef.current=null;setSession(null);setStatus('');setConflict(false);}
  async function recover(){
    const value=sessionRef.current,cached=value&&loadJson(keyFor(value.key));
    if(!cached)return;
    try{
      await (queues.current.get(value.key)||Promise.resolve()).catch(()=>{});
      const saved=await api(`/annotations/${value.caseId}/draft?reviewer=${encodeURIComponent(value.reviewer)}&mode=${value.mode}`);
      if(sessionRef.current?.key!==value.key)return;
      versions.current.set(value.key,saved?.version||0);setConflict(false);update(cached.state);
    }catch(e){notice(value.key,`Browser draft kept. Recovery failed: ${e.message}`);}
  }
  // Dirty local copies survive a page reload or navigation before the debounce fires.
  useEffect(()=>()=>{pause();sessionRef.current=null;},[]);
  return {session,status,conflict,open,update,flush,completed,close,recover};
}
