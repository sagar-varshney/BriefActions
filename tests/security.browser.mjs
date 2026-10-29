// Exercise rendering with CSP bypassed too: React must escape user text even
// when the browser's additional script restrictions are absent.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';

const folder=await mkdtemp(path.join(tmpdir(),'flow-xss-'));
const server=createApp({historyPath:path.join(folder,'history.sqlite3')});let browser;
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const attack='<img id="flow-xss-probe" src="/invalid" onerror="globalThis.__flowInjected=true">';
 const script='<script>globalThis.__flowInjected=true</script>';
 const post=async(route,data)=>{const response=await fetch(base+'/api'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});assert.ok(response.ok,`HTTP ${response.status}`);return response.json();};
 const run=await post('/runs',{transcript:`Maya will send the notes tomorrow.\n${attack}\n${script}`,title:attack,reference_date:'2026-10-29'});
 const proposal=run.proposals[0];assert.ok(proposal);
 await post(`/runs/${run.id}/finalize`,{decisions:run.proposals.map((p,index)=>({...p,accept:index===0,task:index===0?attack:p.task,owner:script}))});
 browser=await chromium.launch({headless:true,...(process.env.FLOW_CHROMIUM_PATH?{executablePath:process.env.FLOW_CHROMIUM_PATH}:{})});
 const context=await browser.newContext({bypassCSP:true});
 const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`${base}/meetings/${run.id}`);
 await page.getByRole('heading',{name:'Your confirmed plan',exact:true}).waitFor();
 await page.getByText(attack,{exact:true}).first().waitFor();
 assert.ok((await page.locator('#saved-source').textContent()).includes(attack));
 assert.equal(await page.locator('#flow-xss-probe').count(),0);
 assert.equal(await page.evaluate(()=>globalThis.__flowInjected),undefined);
 // Stored task/owner/title text must remain text after reloading too.
 await page.reload();await page.getByRole('heading',{name:'Your confirmed plan',exact:true}).waitFor();
 assert.equal(await page.locator('#flow-xss-probe').count(),0);
 assert.equal(await page.evaluate(()=>globalThis.__flowInjected),undefined);
 const saved=await (await fetch(`${base}/api/runs/${run.id}`)).json();
 assert.ok(saved.transcript.includes(attack));assert.equal(saved.final_tasks[0].task,attack);
 assert.deepEqual(errors,[]);
 console.log('Stored XSS checks passed: original transcript, task, owner, title, and reload render user text without executing it, even with CSP bypassed.');
}finally{await browser?.close();server.closeAllConnections();await server.shutdown();await rm(folder,{recursive:true,force:true});}
