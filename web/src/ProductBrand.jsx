import React,{useRef,useState} from 'react';
export default function ProductBrand({onClick,href='/'}){
  const [cycle,setCycle]=useState(0),lastPlayed=useRef(Date.now());
  function replay(){
    if(matchMedia('(prefers-reduced-motion: reduce)').matches || Date.now()-lastPlayed.current<1100)return;
    lastPlayed.current=Date.now();setCycle(value=>value+1);
  }
  return <a href={href} className="brand" onClick={onClick} onMouseEnter={replay} onFocus={replay} aria-label="BriefActions home"><span className="brand-mark" aria-hidden="true"><svg key={cycle} className="brand-symbol" viewBox="0 0 64 64" fill="none" focusable="false"><path className="brand-ribbon brand-ribbon-upper" fill="#0084C7" d="M6 25 25 6h33L46 18H30L18 30v16H6V25Z"/><path className="brand-ribbon brand-ribbon-lower" fill="#0084C7" d="M58 39 39 58H6l12-12h16l12-12V18h12v21Z"/></svg></span><span className="brand-wordmark"><span className="brand-name">BriefActions</span></span></a>;
}
