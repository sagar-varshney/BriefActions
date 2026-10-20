// Hosted browser drafts never reuse the local workspace or another account's keys.
let account=null;
export function scopeStorage(id){account=id;}
const key=name=>account?`flow.account.${account}.${name}`:name;
export default {
  getItem:name=>localStorage.getItem(key(name)),
  setItem:(name,value)=>localStorage.setItem(key(name),value),
  removeItem:name=>localStorage.removeItem(key(name)),
  forgetInput:(id,broadcast=true)=>{
    const prefix=account?`flow.account.${account}.`:'flow.';
    for(const k of Object.keys(localStorage)){
      if(!k.startsWith(prefix) || k==='flow.theme')continue;
      const v=localStorage.getItem(k) || '';
      // Removing a group preserves unrelated unsubmitted transcript text. A pending
      // analysis keeps its original fingerprint so a committed result can recover.
      try{const d=JSON.parse(v);if(d?.series_id===id&&!k.includes(id)){
        if(k.includes('flow.inputDraft.')){localStorage.setItem(k,JSON.stringify({...d,series_id:''}));continue;}
        if(k.endsWith('flow.pendingAnalysis'))continue;
      }}catch{}
      if(k.includes(id) || v.includes(id) || /flow\.(annotationSnapshot|reviewedBenchmark)$/.test(k))localStorage.removeItem(k);
    }
    if(broadcast)localStorage.setItem(key('flow.erasure'),JSON.stringify({id,at:Date.now()}));
  },
  broadcastErasure:(ids,id=ids[0])=>localStorage.setItem(key('flow.erasure'),JSON.stringify({id,ids,at:Date.now()})),
  clearWorkspace:(broadcast=true)=>{
    const prefix=account?`flow.account.${account}.`:'flow.';
    for(const k of Object.keys(localStorage))if(k.startsWith(prefix) && k!=='flow.theme')localStorage.removeItem(k);
    if(broadcast)localStorage.setItem(key('flow.erasure'),JSON.stringify({account:true,at:Date.now()}));
  },
  erasureKey:()=>key('flow.erasure'),
};
