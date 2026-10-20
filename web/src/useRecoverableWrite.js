import {useEffect,useRef,useState} from 'react';
import {api} from './api.js';
import accountStorage from './accountStorage.js';
export default function useRecoverableWrite(key,url,onSuccess){
 const [pending,setPending]=useState(()=>{try{const p=JSON.parse(accountStorage.getItem(key)||'null');return p&&/^[a-f0-9]{32}$/.test(p.request_id)?p:null;}catch{return null;}}),[busy,setBusy]=useState(false),[error,setError]=useState(''),alive=useRef(true),sending=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 async function send(payload=pending){
  if(sending.current||!payload)return;
  try{accountStorage.setItem(key,JSON.stringify(payload));}catch{setError('Browser storage is unavailable. Enable it before making a recoverable change.');return;}
  sending.current=true;setPending(payload);setBusy(true);setError('');
  try{const value=await api(url,{method:'POST',body:JSON.stringify(payload)});if(alive.current){try{accountStorage.removeItem(key);}catch{}setPending(null);onSuccess(value);}return value;}
  catch(e){if(alive.current){setError(e.message);if(!e.retryable){setPending(null);try{accountStorage.removeItem(key);}catch{}}}}
  finally{sending.current=false;if(alive.current)setBusy(false);}
 }
 return {pending,busy,error,send,clearError:()=>setError('')};
}
