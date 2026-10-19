import {readRoute,routePath} from './routing.js';

export function authScreen(url=new URL(location.href)){
 const path=url.pathname.replace(/\/$/,'') || '/';
 if(path==='/sign-in')return 'signin';
 if(path==='/auth/callback' || path==='/' && (['code','error','error_description','error_code'].some(key=>url.searchParams.has(key)) || /(?:^#|&)(?:access_token|error|error_description|error_code)=/.test(url.hash)))return 'callback';
 return path==='/' && url.hash!=='#data'?'landing':'workspace';
}

// Only known, same-origin workspace routes can be authentication destinations.
// Reconstructing the route drops provider codes, arbitrary queries and fragments.
export function workspaceDestination(value,origin=location.origin){
 if(typeof value!=='string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))return '/today';
 try{
  const url=new URL(value,origin),route=readRoute(url);
  if(url.origin!==origin || route.invalid || url.pathname==='/' && url.hash!=='#data')return '/today';
  return routePath(route);
 }catch{return '/today';}
}
