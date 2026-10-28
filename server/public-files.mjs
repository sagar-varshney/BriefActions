import path from 'node:path';
import {realpath,stat} from 'node:fs/promises';

export const PUBLIC_TYPES={'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon', '.woff2':'font/woff2', '.txt':'text/plain'};

// Only built, public assets belong here. Dotfiles, source maps and symlinks
// outside the build directory must not become downloadable after a bad build.
export async function publicFile(root,pathname) {
  let decoded;
  try{decoded=decodeURIComponent(pathname);}catch{return {status:400};}
  if(/[\x00-\x1f\x7f\\]/.test(decoded))return {status:400};
  if(decoded.split('/').some(segment=>segment.startsWith('.')) || /\.map$/i.test(decoded))return {status:404};
  if(path.extname(decoded) && !Object.hasOwn(PUBLIC_TYPES,path.extname(decoded)))return {status:404};
  const base=await realpath(root).catch(()=>null);
  if(!base)return {status:503};
  let filename=path.resolve(base,'.'+decoded);
  if(!filename.startsWith(base+path.sep))filename=path.join(base,'index.html');
  let info=await stat(filename).catch(()=>null);
  if(!info?.isFile()){
    if(path.extname(decoded))return {status:404};
    filename=path.join(base,'index.html');
    info=await stat(filename).catch(()=>null);
  }
  if(!info?.isFile())return {status:503};
  const actual=await realpath(filename).catch(()=>null);
  if(!actual || !actual.startsWith(base+path.sep))return {status:404};
  if(path.relative(base,actual).split(path.sep).some(segment=>segment.startsWith('.')) || !Object.hasOwn(PUBLIC_TYPES,path.extname(actual)))return {status:404};
  return {filename:actual};
}
