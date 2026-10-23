import React,{Component,Suspense,lazy,useEffect} from 'react';
import LoadingState from './LoadingState.jsx';

class DownloadBoundary extends Component{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){
  if(this.state.failed)return <section className="panel section-download" role="alert"><h1 tabIndex={-1}>This section couldn’t load.</h1><p>Check your connection and reload this page to download the latest version. Saved browser drafts are kept.</p><button type="button" className="button secondary" onClick={()=>location.reload()}>Reload page</button></section>;
  return this.props.children;
 }
}
function Ready({onReady,children}){useEffect(()=>{onReady?.();},[]);return children;}

// Declare once at module scope. Only mounting the section starts its download.
// A reload also recovers from obsolete chunk URLs after a new deployment.
export function deferSection(load,label){
 const Section=lazy(load);
 return function DeferredSection({onReady,...props}){
  return <DownloadBoundary><Suspense fallback={<LoadingState label={`Loading ${label}…`} slowText="Still downloading this section. Check your connection if the wait continues."/>}><Ready onReady={onReady}><Section {...props}/></Ready></Suspense></DownloadBoundary>;
 };
}
