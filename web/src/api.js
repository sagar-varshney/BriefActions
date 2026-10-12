let client=null,owner=null;
export function configureApi(auth,id){client=auth;owner=id;}
export async function request(url,options={}) {
  const headers=new Headers(options.headers);
  if(client){
    const {data:{session}}=await client.auth.getSession();
    if(!session || session.user.id!==owner)throw new Error('Sign in again to use this workspace.');
    headers.set('Authorization',`Bearer ${session.access_token}`);
  }
  if(options.body)headers.set('Content-Type','application/json');
  let response;
  try{response=await fetch(url,{signal:AbortSignal.timeout(90_000),...options,headers,cache:'no-store'});}catch{const error=new Error('Connection interrupted. Your saved work can be recovered.');error.retryable=true;throw error;}
  if(!response.ok){const data=await response.json().catch(()=>({}));const reference=data.request_id || response.headers.get('x-request-id');const requestId=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(reference || '')?reference:null;const error=new Error((data.error || 'Request failed.')+(requestId?` Reference: ${requestId}.`:''));error.requestId=requestId;error.status=response.status;error.retryAfter=Number(response.headers.get('retry-after')) || null;error.retryable=[408,429,500,502,503,504].includes(response.status);throw error;}
  return response;
}
export async function api(url,options={}){return (await request(`/api${url}`,options)).json();}
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
