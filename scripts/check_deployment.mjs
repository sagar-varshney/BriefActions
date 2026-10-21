/** Secret-free configuration and live launch checks. No accounts or tasks created. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig} from '../server/config.mjs';

const check=(name,ok,detail)=>({name,ok:!!ok,detail});
export function checkConfig(env){
 const fields=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY','FLOW_DATABASE_URL'];
 const checks=[check('production mode',env.NODE_ENV==='production','NODE_ENV must be production.')];
 for(const name of fields)checks.push(check(name,typeof env[name]==='string'&&!!env[name].trim()&&!/replace_me|your-project|URL_ENCODED_PASSWORD|pooler-host/i.test(env[name]),'A real server environment value is required; values are never printed.'));
 let config;try{config=loadConfig(env);}catch{}
 checks.push(check('configuration structure',config?.production&&config.authMode==='supabase','Checks HTTPS, persistent Postgres, auth-key roles, TLS, and server limits.'));
 checks.push(check('public origin',config?.publicOrigin&&!/your-app|replace_me/i.test(config.publicOrigin),'Set PUBLIC_ORIGIN, or use Render’s assigned URL.'));
 checks.push(check('public network binding',config&&['0.0.0.0','::'].includes(config.host),'The service must listen on a public container interface.'));
 return {ok:checks.every(c=>c.ok),checks,scope:'Structure only: provider credentials, migrations, OAuth and backups still require live verification.'};
}

function validAuth(data){
 if(!data||data.mode!=='supabase'||typeof data.emailEnabled!=='boolean'||Object.keys(data).some(k=>!['mode','url','key','emailEnabled'].includes(k)))return false;
 try{loadConfig({FLOW_AUTH_MODE:'supabase',SUPABASE_URL:data.url,SUPABASE_PUBLISHABLE_KEY:data.key});return true;}catch{return false;}
}
async function responseBody(response){
 const reader=response.body?.getReader();if(!reader)return '';
 let size=0;const chunks=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65_536)throw new Error('Response too large');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 return Buffer.concat(chunks).toString('utf8');
}
export async function checkLive(value,{fetchImpl=fetch,timeoutMs=90_000,budgetMs=180_000,now=()=>performance.now()}={}){
 let origin;try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw new Error();origin=url.origin;}catch{throw new Error('Use an HTTPS app origin without credentials, path, query, or fragment.');}
 const deadline=now()+budgetMs,checks=[],isShell=body=>/<div\s+id=["']root["']/.test(body),isJson=response=>response.headers.get('content-type')?.includes('application/json');
 const probes=[
  {name:'homepage',route:'/',shell:true},
  {name:'sign-in route',route:'/sign-in',shell:true},
  {name:'OAuth callback route',route:'/auth/callback',shell:true},
  {name:'workspace deep link',route:'/history/series',shell:true},
  {name:'process liveness',route:'/api/live',status:'alive'},
  {name:'storage readiness',route:'/api/health',status:'ready'},
  {name:'public auth configuration',route:'/api/auth-config',auth:true},
  {name:'private meeting gate',route:'/api/runs',http:401},
  {name:'private series gate',route:'/api/series',http:401},
  {name:'configured app origin',route:'/api/runs',http:401,post:true,origin},
  {name:'cross-origin write rejection',route:'/api/runs',http:403,post:true,origin:'https://briefactions.invalid'},
 ];
 for(const probe of probes){
  const remaining=Math.floor(deadline-now());
  if(remaining<1){checks.push(check(probe.name,false,'Overall verification time limit reached.'));continue;}
  try{
   const response=await fetchImpl(origin+probe.route,{redirect:'manual',signal:AbortSignal.timeout(Math.min(timeoutMs,remaining)),...(probe.post?{method:'POST',headers:{'Content-Type':'application/json',Origin:probe.origin},body:'{}'}:{})});
   const body=await responseBody(response);let data;try{data=JSON.parse(body);}catch{}
   const status=response.status===(probe.http||200),content=probe.shell?response.headers.get('content-type')?.includes('text/html')&&isShell(body):isJson(response)&&(probe.auth?validAuth(data):probe.status?data?.status===probe.status:true);
   const headers=response.headers,secure=headers.get('x-content-type-options')==='nosniff'&&headers.get('x-frame-options')==='DENY'&&/max-age=[1-9]\d*/.test(headers.get('strict-transport-security')||'')&&/frame-ancestors 'none'/.test(headers.get('content-security-policy')||'')&&(probe.shell||headers.get('cache-control')==='no-store');
   checks.push(check(probe.name,status&&content&&secure,`HTTP ${response.status}; expected content, access control and security headers checked.`));
  }catch{checks.push(check(probe.name,false,'Request timed out, failed, or returned an oversized response. Response content is not logged.'));}
 }
 return {ok:checks.every(c=>c.ok),checks,scope:'Smoke checks only. No users or tasks created. Real sign-in, two-account isolation, redeploy persistence and backup recovery remain separate launch checks.'};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const [mode,...args]=process.argv.slice(2);let result;
  if(mode==='config'&&!args.length)result=checkConfig(process.env);
  else if(mode==='live'&&args.length===1)result=await checkLive(args[0]);
  else throw new Error();
  for(const item of result.checks)console.log(`${item.ok?'PASS':'FAIL'} ${item.name}: ${item.detail}`);
  console.log(result.scope);process.exitCode=result.ok?0:1;
 }catch{console.error('Use: node scripts/check_deployment.mjs config | live https://YOUR-APP-HOST');process.exitCode=1;}
}
