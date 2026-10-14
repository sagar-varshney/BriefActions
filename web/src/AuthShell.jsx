import React,{useEffect,useState} from 'react';
import {configureApi,request} from './api.js';
import {scopeStorage} from './accountStorage.js';
import ThemeControl from './ThemeControl.jsx';
import ProductBrand from './ProductBrand.jsx';

export default function AuthShell({children}) {
  const [ready,setReady]=useState(false),[client,setClient]=useState(null),[session,setSession]=useState(null);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[email,setEmail]=useState(''),[emailEnabled,setEmailEnabled]=useState(false);
  const [authUrl,setAuthUrl]=useState('');
  useEffect(()=>{
    let alive=true,subscription;
    (async()=>{
      const response=await request('/api/auth-config');
      const config=await response.json();
      if(config.mode==='local'){configureApi(null,null);scopeStorage(null);if(alive)setReady(true);return;}
      const {createClient}=await import('@supabase/supabase-js');
      const auth=createClient(config.url,config.key,{auth:{flowType:'pkce'}});
      const {data,error}=await auth.auth.getSession();
      if(error)throw error;
      let current=data.session?.user.id || null;
      configureApi(auth,current);scopeStorage(current);
      if(alive){setClient(auth);setSession(data.session);setReady(true);setEmailEnabled(config.emailEnabled);setAuthUrl(config.url);}
      ({data:{subscription}}=auth.auth.onAuthStateChange((_event,next)=>{
        const id=next?.user.id || null;
        if(id!==current){
          // Remove old account UI and stop its pending work before opening another.
          if(alive){setReady(false);setSession(null);}
          location.reload();
        }
      }));
    })().catch(e=>{if(alive)setError(e.message);});
    return()=>{alive=false;subscription?.unsubscribe();};
  },[]);
  async function signIn(provider){setBusy(true);setError('');try{const {error}=await client.auth.signInWithOAuth({provider,options:{redirectTo:location.origin}});if(error)throw error;}catch(e){setError(e.message);setBusy(false);}}
  async function emailSignIn(event){event.preventDefault();setBusy(true);setError('');try{const {error}=await client.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin}});if(error)throw error;setNotice('Check your email for a sign-in link.');}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function signOut(){setBusy(true);setError('');const {error}=await client.auth.signOut();if(error){setError(error.message);setBusy(false);}}
  async function completeAccountDeletion(){
    setReady(false);
    try{await client.auth.signOut({scope:'local'});}finally{
      const key=`sb-${new URL(authUrl).hostname.split('.')[0]}-auth-token`;
      localStorage.removeItem(key);localStorage.removeItem(key+'-code-verifier');location.reload();
    }
  }
  if(ready && (!client || session))return children({account:session?.user,signOut:client?signOut:null,completeAccountDeletion,authError:error});
  return <main className="auth-shell" id="signin-main"><a className="skip-link" href="#signin-title">Skip to sign in</a>
    <header className="auth-header"><ProductBrand/><ThemeControl/></header>
    <div className="auth-layout"><section className="auth-story" aria-labelledby="signin-title"><div className="eyebrow accent">A LITTLE LESS MEETING. A LITTLE MORE MOMENTUM.</div><h1 id="signin-title" tabIndex={-1}>Your conversations.<br/><span>Your next steps.</span></h1><p>A clear path from what was said to what gets done. Bring the conversation. Leave with a plan you’ve checked.</p><div className="story-flow" aria-hidden="true"><span/><span/><span/><span/></div><div className="story-labels"><span>Capture</span><span>Find the actions</span><span>Review</span><span>Move forward</span></div><div className="auth-features"><div><strong>Keep the evidence close</strong><p>Trace every proposal back to the conversation.</p></div><div><strong>Your judgment stays in the loop</strong><p>Correct the details and choose each task to keep.</p></div></div></section>
    <section className="panel auth-card" aria-labelledby="auth-card-title"><div className="eyebrow accent">YOUR PRIVATE WORKSPACE</div><h2 id="auth-card-title">Let’s make a little progress.</h2><p>Sign in to save your transcripts, review action items, and pick up where you left off.</p>{error&&<div className="notice error" role="alert">{error}</div>}{notice&&<div className="notice" role="status">{notice}</div>}{!ready?<>{error?<button className="button secondary" onClick={()=>location.reload()}>Try again</button>:<p role="status">Loading secure workspace…</p>}</>:<><button className="button primary" disabled={busy} onClick={()=>signIn('github')}>Continue with GitHub <span aria-hidden="true">↗</span></button>{emailEnabled&&<form onSubmit={emailSignIn}><label className="field-label">Email address<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><button className="button secondary" disabled={busy}>Email me a sign-in link</button></form>}<p className="form-hint">Each account has separate saved data. Browser drafts are scoped to your account.</p></>}<p className="form-hint">You review every proposal before it becomes part of your confirmed plan.</p></section></div>
    <footer className="auth-footer"><span>Productivity Flow Engine · A clearer way forward.</span><a href="/privacy">Privacy & your data</a></footer>
  </main>;
}
