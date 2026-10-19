import React,{useEffect,useState} from 'react';
import {api} from './api.js';
import ProductBrand from './ProductBrand.jsx';
import ThemeControl from './ThemeControl.jsx';

// This component mounts only after authentication and account-scoped API setup.
// Saved account data, rather than a browser's visit flag, chooses the default.
export default function WorkspaceEntry({onReady}){
 const [attempt,setAttempt]=useState(0),[error,setError]=useState('');
 useEffect(()=>{
  let alive=true;setError('');
  (async()=>{
   const account=await api('/account');
   if(!alive)return;
   if(account.state==='deleting'){onReady('/account');return;}
   const history=await api('/runs/search?page_size=1');
   if(alive)onReady(history.total>0?'/today':'/meetings');
  })().catch(e=>{if(alive)setError(e.message);});
  return()=>{alive=false;};
 },[attempt,onReady]);
 return <main className="signin-shell workspace-entry"><header className="signin-toolbar"><ProductBrand/><ThemeControl/></header><section className="panel signin-card" aria-labelledby="entry-title"><h1 id="entry-title">Opening your workspace</h1>{error?<div className="notice error" role="alert"><p>We couldn’t check your saved meetings. {error}</p><button className="button secondary" type="button" onClick={()=>setAttempt(value=>value+1)}>Retry opening workspace</button></div>:<p role="status">Finding the right place to start…</p>}</section></main>;
}
