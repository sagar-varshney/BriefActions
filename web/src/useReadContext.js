import {useLayoutEffect,useRef} from 'react';

// Keep a background refresh from dropping keyboard focus or moving a long list.
// Explicit navigation and filter changes retain their existing focus behavior.
export default function useReadContext(result){
 const restore=useRef(null);
 useLayoutEffect(()=>{restore.current?.();restore.current=null;},[result]);
 return ()=>{
  const main=document.getElementById('workspace-main'),heading=main?.querySelector('h1'),active=document.activeElement;
  if(!main||active?.closest('dialog[open]'))return;
  const top=main.scrollTop,left=main.scrollLeft,x=window.scrollX,y=window.scrollY;
  restore.current=()=>{
   if(!heading?.isConnected)return;
   if(!active?.isConnected&&[document.body,main].includes(document.activeElement))heading.focus({preventScroll:true});
   main.scrollTo({top,left,behavior:'instant'});window.scrollTo({top:y,left:x,behavior:'instant'});
  };
 };
}
