import React,{useCallback,useEffect,useRef,useState} from 'react';
import {configureApi,request} from './api.js';
import {scopeStorage} from './accountStorage.js';
import ThemeControl from './ThemeControl.jsx';
import ProductBrand from './ProductBrand.jsx';
import LandingPage from './LandingPage.jsx';
import {readRoute} from './routing.js';
import {authScreen,workspaceDestination} from './authRouting.js';
import useDocumentTitle from './useDocumentTitle.js';
import WorkspaceEntry from './WorkspaceEntry.jsx';

function clearDestination(){try{sessionStorage.removeItem('flow.authReturn');}catch{}}
function destination(){let target;try{target=sessionStorage.getItem('flow.authReturn');}catch{}clearDestination();return workspaceDestination(target);}
function rememberDestination(){if(authScreen()==='entry' || !readRoute().invalid)try{sessionStorage.setItem('flow.authReturn',workspaceDestination(location.pathname+location.search+location.hash));}catch{}}
function resolveScreen(signedIn,local){
  const screen=authScreen();
  if((screen==='signin' && signedIn) || screen==='callback' && (signedIn || local)){
    history.replaceState({},'',destination());return authScreen();
  }
  if(['workspace','entry'].includes(screen) && !signedIn && !local){rememberDestination();history.replaceState({},'','/sign-in');return 'signin';}
  if(screen==='callback'){history.replaceState({},'','/sign-in');return 'signin';}
  return screen;
}

export default function AuthShell({children}) {
  const [screen,setScreen]=useState(authScreen),[ready,setReady]=useState(false),[local,setLocal]=useState(false),[client,setClient]=useState(null),[session,setSession]=useState(null);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[email,setEmail]=useState(''),[emailEnabled,setEmailEnabled]=useState(false);
  const [authUrl,setAuthUrl]=useState(''),leaving=useRef(false);
  const openWorkspace=useCallback(target=>{history.replaceState({},'',target);setScreen('workspace');},[]);
  useDocumentTitle(screen==='workspace' && ready && (local || session)?null:screen==='entry'?'Opening workspace':screen==='landing'?'':screen==='callback'?'Signing in':'Sign in');
  useEffect(()=>{
    let alive=true,subscription;
    const callback=authScreen()==='callback';
    (async()=>{
      const response=await request('/api/auth-config');
      const config=await response.json();
      if(config.mode==='local'){
        configureApi(null,null);scopeStorage(null);
        if(alive){setLocal(true);setScreen(resolveScreen(false,true));setReady(true);}return;
      }
      const {createClient}=await import('@supabase/supabase-js');
      const auth=createClient(config.url,config.key,{auth:{flowType:'pkce'}});
      const {data,error:sessionError}=await auth.auth.getSession();
      if(!alive)return;
      if(sessionError || callback && !data.session)setError('We couldn’t finish signing you in. Please try again.');
      const current=data.session?.user.id || null;
      configureApi(auth,current);scopeStorage(current);
      setClient(auth);setSession(data.session);setScreen(resolveScreen(!!data.session,false));setReady(true);setEmailEnabled(config.emailEnabled);setAuthUrl(config.url);
      ({data:{subscription}}=auth.auth.onAuthStateChange((_event,next)=>{
        const id=next?.user.id || null;
        if(id!==current){
          // Unmount the old workspace before configuring requests for another account.
          if(alive){setReady(false);setSession(null);}
          if(leaving.current)location.replace('/sign-in');else location.reload();
        }
      }));
    })().catch(()=>{if(alive)setError('Sign-in is temporarily unavailable. Please try again.');});
    return()=>{alive=false;subscription?.unsubscribe();};
  },[]);
  useEffect(()=>{
    if(!ready)return;
    const pop=()=>setScreen(resolveScreen(!!session,local));
    window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);
  },[ready,session,local]);
  async function signIn(provider){setBusy(true);setError('');try{const {error}=await client.auth.signInWithOAuth({provider,options:{redirectTo:location.origin+'/auth/callback'}});if(error)throw error;}catch{setError('We couldn’t start sign-in. Please try again.');setBusy(false);}}
  async function emailSignIn(event){event.preventDefault();setBusy(true);setError('');setNotice('');try{const {error}=await client.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+'/auth/callback'}});if(error)throw error;setNotice('Check your email for a sign-in link.');}catch{setError('We couldn’t send a sign-in link. Please try again.');}finally{setBusy(false);}}
  async function signOut(){
    setBusy(true);setError('');leaving.current=true;clearDestination();
    try{const {error}=await client.auth.signOut();if(error)throw error;location.replace('/sign-in');}catch{leaving.current=false;setError('We couldn’t sign you out. Please try again.');setBusy(false);}
  }
  async function completeAccountDeletion(){
    setReady(false);leaving.current=true;clearDestination();
    try{await client.auth.signOut({scope:'local'});}finally{
      const key=`sb-${new URL(authUrl).hostname.split('.')[0]}-auth-token`;
      localStorage.removeItem(key);localStorage.removeItem(key+'-code-verifier');location.replace('/sign-in');
    }
  }
  if(screen==='landing')return <LandingPage signedIn={!!session}/>;
  if(screen==='entry' && ready && (local || session))return <WorkspaceEntry onReady={openWorkspace}/>;
  if(screen==='workspace' && ready && (local || session))return children({account:session?.user,signOut:client?signOut:null,completeAccountDeletion,authError:error});
  return <main className="signin-shell" id="signin-main"><a className="skip-link" href="#signin-title">Skip to sign in</a>
    <header className="signin-toolbar"><a className="text-button" href="/">← Back to home</a><ThemeControl/></header>
    <div className="signin-content"><ProductBrand/><section className="panel signin-card" aria-labelledby="signin-title"><div className="eyebrow accent">YOUR PRIVATE WORKSPACE</div><h1 id="signin-title" tabIndex={-1}>Welcome back.</h1><p>Sign in to turn your conversations into clear next steps—and pick up where you left off.</p>
      {error&&<div className="notice error" role="alert">{error}</div>}{notice&&<div className="notice" role="status">{notice}</div>}
      {!ready?<>{error?<button className="button secondary" onClick={()=>location.reload()}>Try again</button>:<p role="status">Getting sign-in ready…</p>}</>:local?<><div className="signin-local"><strong>Local preview</strong><p>No account is required on this development server. Public deployments use separate user accounts.</p></div><a className="button primary" href="/workspace">Open local workspace <span aria-hidden="true">↗</span></a></>:<><button className="button primary" disabled={busy} onClick={()=>signIn('github')}>Continue with GitHub <span aria-hidden="true">↗</span></button>{emailEnabled&&<><div className="signin-divider"><span>or use your email</span></div><form onSubmit={emailSignIn}><label className="field-label">Email address<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><button className="button secondary" disabled={busy}>{busy?'Please wait…':'Email me a sign-in link'}</button></form></>}<p className="form-hint">Your account has its own saved meetings, plans, and drafts.</p></>}
      <p className="signin-privacy">Your conversations deserve context and care.<br/><a href="/privacy">Privacy & your data</a></p>
    </section><p className="signin-caption">A little less meeting. A little more momentum.</p></div>
    <footer className="signin-footer">BriefActions · A Productivity Flow Engine</footer>
  </main>;
}
