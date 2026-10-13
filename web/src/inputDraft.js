import accountStorage from './accountStorage.js';
const validContext=value=>value==='new' || /^[a-f0-9]{32}$/.test(value);
const key=(client,context)=>`flow.inputDraft.${client}.${context}`;
export function readInputDraft(client,context){
  if(!validContext(context))return null;
  try{const d=JSON.parse(accountStorage.getItem(key(client,context)) || 'null');
    return d?.version===1 && d.source_id===(context==='new'?null:context) && typeof d.transcript==='string' && d.transcript.length<=100_000 && typeof d.reference_date==='string' && d.reference_date.length<=10 && typeof d.title==='string' && d.title.length<=120 && Number.isInteger(d.clusters) && d.clusters>=1 && d.clusters<=6?d:null;
  }catch{return null;}
}
export function saveInputDraft(client,context,input){
  accountStorage.setItem(key(client,context),JSON.stringify({version:1,...input,source_id:context==='new'?null:context,updated_at:new Date().toISOString()}));
}
export function removeInputDraft(client,context){accountStorage.removeItem(key(client,context));}
