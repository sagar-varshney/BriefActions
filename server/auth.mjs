import {createClient} from '@supabase/supabase-js';
export const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
export function accountDeleter(config) {
  if(!config.supabaseSecret)return null;
  const client=createClient(config.supabaseUrl,config.supabaseSecret,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(10_000)})}});
  return async id=>{const {error}=await client.auth.admin.deleteUser(id);if(error && error.status!==404)throw new Error('Sign-in account deletion failed.');};
}
export function accountVerifier(config) {
  if(config.authMode==='local')return async()=>null;
  const client=createClient(config.supabaseUrl,config.supabaseKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(10_000)})}});
  return async token=>{
    const {data,error}=await client.auth.getUser(token);
    if(error && (error.status>=500 || error.name==='AuthRetryableFetchError'))throw new Error('Authentication unavailable');
    if(error || !UUID.test(data.user?.id || '') || data.user?.is_anonymous)return null;
    return data.user.id;
  };
}

export function rateLimiter({limit=90,windowMs=60_000,capacity=5000}={}) {
  const buckets=new Map();
  return key=>{
    const now=Date.now();
    for(const [id,b] of buckets)if(b.until<=now)buckets.delete(id);
    let b=buckets.get(key);
    if(!b){if(buckets.size>=capacity)return false;b={until:now+windowMs,count:0};buckets.set(key,b);}
    return ++b.count<=limit;
  };
}
