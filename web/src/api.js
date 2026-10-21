let client=null,owner=null,scope=0,readGeneration=0;
const pendingReads=new Map();
function invalidateReads(){readGeneration++;pendingReads.clear();}
export function configureApi(auth,id){client=auth;owner=id;scope++;invalidateReads();}
export async function request(url,options={}) {
  const auth=client,account=owner,startedScope=scope;
  const sameAccount=()=>{if(scope!==startedScope)throw new Error('Your sign-in changed. Reopen this workspace.');};
  const headers=new Headers(options.headers);
  if(auth){
    const {data:{session}}=await auth.auth.getSession();
    sameAccount();
    if(!session || session.user.id!==account)throw new Error('Sign in again to use this workspace.');
    headers.set('Authorization',`Bearer ${session.access_token}`);
  }
  if(options.body)headers.set('Content-Type','application/json');
  let response;
  try{response=await fetch(url,{signal:AbortSignal.timeout(90_000),...options,headers,cache:'no-store'});}catch{const error=new Error('Connection interrupted. Your saved work can be recovered.');error.retryable=true;throw error;}
  sameAccount();
  if(!response.ok){const data=await response.json().catch(()=>({}));const reference=data.request_id || response.headers.get('x-request-id');const requestId=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(reference || '')?reference:null;const error=new Error((data.error || 'Request failed.')+(requestId?` Reference: ${requestId}.`:''));error.requestId=requestId;error.status=response.status;error.retryAfter=Number(response.headers.get('retry-after')) || null;error.retryable=[408,429,500,502,503,504].includes(response.status);throw error;}
  return response;
}
export async function api(url,options={}){
  const isRead=(options.method || 'GET').toUpperCase()==='GET'&&!options.body;
  // Share simultaneous default JSON reads only. Signals/headers retain their own
  // semantics, and no completed private response is cached.
  const share=isRead&&Object.keys(options).length===0,key=`${scope}:${readGeneration}:${url}`;
  if(!isRead)invalidateReads();
  let pending=share?pendingReads.get(key):null;
  if(!pending){
    const startedScope=scope;
    pending=request(`/api${url}`,options).then(response=>response.json()).then(value=>{
      if(scope!==startedScope)throw new Error('Your sign-in changed. Reopen this workspace.');
      return value;
    });
    if(share){
      pendingReads.set(key,pending);
      const clear=()=>{if(pendingReads.get(key)===pending)pendingReads.delete(key);};
      pending.then(clear,clear);
    }
  }
  try{return structuredClone(await pending);}finally{if(!isRead)invalidateReads();}
}
export async function downloadFile(url){
  const response=await request(url),blob=await response.blob();
  if(response.headers.get('content-type')?.includes('application/x-ndjson')){
    let complete;try{complete=JSON.parse((await blob.slice(-4096).text()).trim().split('\n').at(-1));}catch{}
    if(complete?.type!=='complete')throw new Error('The export was interrupted. Retry the download.');
  }
  const href=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=href;link.download=response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] || 'flow-export';
  link.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
}
