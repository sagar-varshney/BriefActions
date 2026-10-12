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
  const response=await fetch(url,{...options,headers,cache:'no-store'});
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error || 'Request failed.');}
  return response;
}
export async function api(url,options={}){return (await request(`/api${url}`,options)).json();}
export async function downloadFile(url){
  const response=await request(url),blob=await response.blob();
  const href=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=href;link.download=response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] || 'flow-export';
  link.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
}
