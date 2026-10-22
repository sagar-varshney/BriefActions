import {useEffect} from 'react';

// Account labels, fonts and wrapped navigation can change the sticky header height.
export default function useWorkspaceInset(ref){
 useEffect(()=>{
  const header=ref.current,root=document.documentElement;
  if(!header)return;
  const previous=root.style.getPropertyValue('--workspace-inset');
  const update=()=>{const sticky=getComputedStyle(header).position==='sticky';root.style.setProperty('--workspace-inset',`${sticky?Math.ceil(header.getBoundingClientRect().height)+12:16}px`);};
  const observer=new ResizeObserver(update);observer.observe(header);window.addEventListener('resize',update);update();
  return()=>{observer.disconnect();window.removeEventListener('resize',update);if(previous)root.style.setProperty('--workspace-inset',previous);else root.style.removeProperty('--workspace-inset');};
 },[ref]);
}
