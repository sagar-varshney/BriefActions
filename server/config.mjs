import path from 'node:path';
export function loadConfig(env=process.env) {
  const production=env.NODE_ENV==='production';
  const authMode=env.FLOW_AUTH_MODE || (production?'supabase':'local');
  if(!['local','supabase'].includes(authMode))throw new Error('FLOW_AUTH_MODE must be local or supabase.');
  const host=env.HOST || (production?'0.0.0.0':'127.0.0.1');
  // Render supplies the assigned HTTPS URL after service creation. Explicit
  // PUBLIC_ORIGIN still wins for custom domains; request headers never set it.
  const publicOrigin=env.PUBLIC_ORIGIN || (env.RENDER==='true'?env.RENDER_EXTERNAL_URL:'') || '';
  const supabaseUrl=env.SUPABASE_URL || '',supabaseKey=env.SUPABASE_PUBLISHABLE_KEY || '';
  const supabaseSecret=env.SUPABASE_SECRET_KEY || '';
  if(production && !supabaseSecret)throw new Error('Set server-only SUPABASE_SECRET_KEY for account deletion.');
  if(supabaseSecret && !supabaseSecret.startsWith('sb_secret_')){
    let role;try{role=JSON.parse(Buffer.from(supabaseSecret.split('.')[1],'base64url')).role;}catch{}
    if(role!=='service_role')throw new Error('SUPABASE_SECRET_KEY must be a secret or legacy service-role key.');
  }
  if(production || !['127.0.0.1','localhost','::1'].includes(host)) {
    if(authMode!=='supabase')throw new Error('Public hosting requires Supabase authentication.');
    if(!env.FLOW_DATABASE_URL)throw new Error('Public hosting requires persistent FLOW_DATABASE_URL.');
    if(!/^https:\/\//.test(publicOrigin))throw new Error('Set an HTTPS PUBLIC_ORIGIN for public hosting.');
  }
  if(publicOrigin && new URL(publicOrigin).origin!==publicOrigin)throw new Error('PUBLIC_ORIGIN must be an exact origin without a path.');
  if(authMode==='supabase' && (!/^https:\/\//.test(supabaseUrl) || !supabaseKey))throw new Error('Configure SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.');
  if(authMode==='supabase'){
    const url=new URL(supabaseUrl);
    if(url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname))throw new Error('SUPABASE_URL must be the HTTPS project origin.');
    if(!supabaseKey.startsWith('sb_publishable_') && supabaseKey.split('.').length!==3)throw new Error('Use a publishable or legacy anon Supabase key.');
  }
  if(supabaseKey.startsWith('sb_secret_'))throw new Error('Use a publishable Supabase key, never a secret key.');
  if(supabaseKey.split('.').length===3){
    let role;try{role=JSON.parse(Buffer.from(supabaseKey.split('.')[1],'base64url')).role;}catch{}
    if(role!=='anon')throw new Error('Only a publishable or legacy anon key may be used.');
  }
  if(production && env.FLOW_DATABASE_URL){
    const db=new URL(env.FLOW_DATABASE_URL);
    if(!['postgres:','postgresql:'].includes(db.protocol))throw new Error('FLOW_DATABASE_URL must be a Postgres connection URI.');
    if(!['localhost','127.0.0.1','[::1]'].includes(db.hostname) && !['require','verify-ca','verify-full'].includes(db.searchParams.get('sslmode')))throw new Error('Remote production Postgres requires sslmode=require or certificate verification.');
  }
  const port=Number(env.PORT || 3001);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be between 1 and 65535.');
  const maxWorkers=Number(env.FLOW_MAX_WORKERS || (production?1:2));
  if(!Number.isInteger(maxWorkers)||maxWorkers<1||maxWorkers>4)throw new Error('FLOW_MAX_WORKERS must be between 1 and 4.');
  if(env.FLOW_TELEMETRY && !['true','false'].includes(env.FLOW_TELEMETRY))throw new Error('FLOW_TELEMETRY must be true or false.');
  return {production,authMode,host,port,publicOrigin,supabaseUrl,supabaseKey,supabaseSecret,maxWorkers,telemetry:env.FLOW_TELEMETRY?env.FLOW_TELEMETRY==='true':production,emailEnabled:env.FLOW_EMAIL_SIGNIN==='true',databaseUrl:env.FLOW_DATABASE_URL,
    historyPath:env.FLOW_HISTORY_PATH || path.resolve('data/history.sqlite3')};
}
