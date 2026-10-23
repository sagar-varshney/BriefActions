import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';

const dist=new URL('../dist/',import.meta.url),manifest=JSON.parse(await readFile(new URL('.vite/manifest.json',dist),'utf8'));
const entry=Object.keys(manifest).find(key=>manifest[key].isEntry),seen=new Set();
assert.ok(entry,'The build has an entry module');
function visit(key){if(seen.has(key))return;seen.add(key);for(const dependency of manifest[key].imports||[])visit(dependency);}
visit(entry);
const files=await Promise.all([...seen].filter(key=>manifest[key].file.endsWith('.js')).map(async key=>{const file=manifest[key].file,source=await readFile(new URL(file,dist));return {file,bytes:source.length,gzipBytes:gzipSync(source).length};}));
const bytes=files.reduce((sum,file)=>sum+file.bytes,0),gzipBytes=files.reduce((sum,file)=>sum+file.gzipBytes,0);
assert.ok(bytes<=350_000,`Initial JavaScript exceeded 350 kB: ${bytes} bytes`);
assert.ok(gzipBytes<=110_000,`Initial JavaScript exceeded 110 kB gzip: ${gzipBytes} bytes`);
for(const name of ['WorkspaceApp','AnnotationReviewer','BenchmarkPage']){
 const key=Object.keys(manifest).find(key=>key.endsWith(`/${name}.jsx`));
 assert.ok(key&&manifest[key].isDynamicEntry,`${name} stays an on-demand entry`);assert.ok(!seen.has(key),`${name} is excluded from the initial static graph`);
}
const report={scope:'Public entry and its static JavaScript dependencies; excludes on-demand chunks, CSS, fonts, and server wake-up time.',bytes,gzipBytes,limits:{bytes:350_000,gzipBytes:110_000},files};
console.log(`Initial JavaScript: ${(bytes/1000).toFixed(1)} kB (${(gzipBytes/1000).toFixed(1)} kB gzip); workspace and research downloads remain on demand.`);
if(process.env.CI){const folder=new URL('../artifacts/',import.meta.url);await mkdir(folder,{recursive:true});await writeFile(new URL('web-bundle.json',folder),JSON.stringify(report,null,2));}
