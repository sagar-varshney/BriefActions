import React,{useEffect,useState} from 'react';
import Icon from './Icon.jsx';

// A slower response is still pending, not a failure or a percentage complete.
export default function LoadingState({label,requestKey='',slowText='Still waiting for the server. You can switch sections and return.',className=''}){
 const token=JSON.stringify([label,requestKey]),[slowToken,setSlowToken]=useState(null);
 useEffect(()=>{const timer=setTimeout(()=>setSlowToken(token),8000);return()=>clearTimeout(timer);},[token]);
 return <div className={`request-state ${className}`.trim()} role="status" aria-live="polite" aria-atomic="true"><Icon name="spinner" size={19} className="icon-spin"/><div><p className="request-state-label">{label}</p>{slowToken===token&&<p className="request-state-slow">{slowText}</p>}</div></div>;
}
