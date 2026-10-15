import {useEffect,useState} from 'react';

// DOM work requested by an event must wait for React's commit and any loading gate.
export default function useAfterRender(ready=true){
  const [pending,setPending]=useState(null);
  useEffect(()=>{
    if(!ready || !pending)return;
    pending();setPending(null);
  },[ready,pending]);
  return callback=>setPending(()=>callback);
}
