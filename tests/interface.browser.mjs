import {meetingField} from './browser-helpers.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {createApp} from '../server/index.mjs';
import {loadConfig} from '../server/config.mjs';

const folder=await mkdtemp(path.join(tmpdir(),'flow-interface-'));
const shots=process.env.FLOW_SCREENSHOTS || path.join(folder,'screenshots');await mkdir(shots,{recursive:true});
const server=createApp({historyPath:path.join(folder,'history.sqlite3')}),authServer=createApp({historyPath:path.join(folder,'auth.sqlite3'),config:{...loadConfig(),authMode:'supabase',supabaseUrl:'https://test-project.supabase.co',supabaseKey:'sb_publishable_test'},verifyAccount:async()=>null});
let browser;const checks=[];
async function scan(page,label){const r=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();checks.push({label,violations:r.violations,incomplete:r.incomplete.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))});assert.deepEqual(r.violations,[],label);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label}: horizontal page overflow`);}
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await new Promise(resolve=>authServer.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`,authBase=`http://127.0.0.1:${authServer.address().port}`;
 browser=await chromium.launch({headless:true,...(process.env.FLOW_CHROMIUM_PATH?{executablePath:process.env.FLOW_CHROMIUM_PATH}:{})});const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/meetings');await page.getByRole('button',{name:'Try an example',exact:true}).waitFor();
 await page.getByLabel('Color theme').selectOption('light');await page.screenshot({path:path.join(shots,'flow-welcome-desktop.png'),fullPage:true});
 const longInput='Bob: Okay 📝.\n'+Array.from({length:35},(_,i)=>`Bob: Context note ${i}; no decision recorded.`).join('\n')+'\nMaya will send the report tomorrow.';
 await (await meetingField(page,'Meeting transcript')).fill(longInput);await (await meetingField(page,'Meeting date')).fill('2026-10-14');await page.getByRole('button',{name:'Analyze transcript',exact:true}).click();await page.getByRole('heading',{name:/Review action proposals/}).waitFor();
 await page.getByRole('button',{name:'Locate passage 1 for task 1',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.id==='saved-source');
 const longSource=page.getByRole('region',{name:'Saved source transcript',exact:true}),highlight=await longSource.locator('mark').boundingBox(),sourceBox=await longSource.boundingBox();assert.ok(highlight.y>=sourceBox.y && highlight.y+highlight.height<=sourceBox.y+sourceBox.height+1,'Located evidence must be visible inside a long source transcript');
 await page.getByRole('button',{name:'Back to task',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Locate passage 1 for task 1');
 await page.getByRole('button',{name:'New meeting',exact:true}).click();
 const input='Bob: Okay 📝. Literal <b>notes</b>.\nMaya will send the report tomorrow.\nJon will send the invoice.';
 await (await meetingField(page,'Meeting transcript')).fill(input);await (await meetingField(page,'Meeting date')).fill('2026-10-14');await (await meetingField(page,'Meeting name')).fill('Launch planning');await page.getByRole('button',{name:'Analyze transcript',exact:true}).click();await page.getByRole('heading',{name:/Review action proposals/}).waitFor();
 const metrics=page.getByRole('region',{name:'Current meeting summary'});
 const metric=label=>metrics.locator('.metric-card').filter({has:page.getByText(label,{exact:true})}).locator('strong');
 assert.equal(await metric('Proposed actions').textContent(),'2');assert.equal(await metric('Selected tasks').textContent(),'0');assert.equal(await metric('Need owner or date').textContent(),'1');assert.equal(await metric('Supporting passages').textContent(),'2');
 const source=page.getByRole('region',{name:'Saved source transcript',exact:true});assert.equal(await source.textContent(),input);assert.equal(await source.locator('b').count(),0);
 await page.getByRole('button',{name:'Locate passage 1 for task 1',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.id==='saved-source');assert.equal(await source.locator('mark').textContent(),'Maya will send the report tomorrow.');assert.equal(await source.textContent(),input);
 // Locating evidence always uses saved code-point offsets, even after input edits.
 await (await meetingField(page,'Meeting transcript')).fill('Completely different editable meeting text.');await page.getByRole('button',{name:'Locate passage 1 for task 2',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.id==='saved-source');assert.equal(await source.locator('mark').textContent(),'Jon will send the invoice.');assert.equal(await (await meetingField(page,'Meeting transcript')).inputValue(),'Completely different editable meeting text.');assert.equal(await source.textContent(),input);
 await page.getByRole('button',{name:'Discard transcript draft',exact:true}).click();assert.equal(await (await meetingField(page,'Meeting transcript')).inputValue(),input);
 await page.getByLabel('Keep task 1',{exact:true}).check();assert.equal(await metric('Selected tasks').textContent(),'1');await page.getByLabel('Deadline 2',{exact:true}).fill('2026-10-16');assert.equal(await metric('Need owner or date').textContent(),'0');
 for(const width of [1440,1180,1024,768,390,320]){
  await page.setViewportSize({width,height:1000});
  for(const theme of ['light','dark']){
   await page.getByLabel('Color theme').selectOption(theme);
   if(width===1440 || width===320)await scan(page,`review-${width}-${theme}`);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width} ${theme}`);
   const left=await page.getByRole('region',{name:'Transcript workspace',exact:true}).boundingBox(),right=await page.getByRole('region',{name:'Extraction result',exact:true}).boundingBox();
   if(width>=1180)assert.ok(left.x+left.width<=right.x+1,'Desktop source and review must sit alongside each other');
   if(width<=1024)assert.ok(right.y>=left.y+left.height-1,'Narrow layouts must stack source before review');
   if([1440,390,320].includes(width)){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(shots,`flow-review-${width}-${theme}.png`),fullPage:width<=390});}
  }
 }
 await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Confirm selected tasks',exact:true}).click();await page.getByRole('heading',{name:'Your confirmed plan',exact:true}).waitFor();assert.equal(await metric('Confirmed tasks').textContent(),'1');assert.equal(await metric('Need owner or date').textContent(),'0');
 await page.getByRole('button',{name:'Locate passage 1 for confirmed task 1',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.id==='saved-source');assert.equal(await source.locator('mark').textContent(),'Maya will send the report tomorrow.');
 const data=await (await fetch(base+'/api/runs')).json(),saved=await (await fetch(base+`/api/runs/${data[0].id}`)).json();assert.equal(saved.transcript,input);assert.equal(saved.final_tasks.length,1);assert.equal(saved.final_tasks[0].owner,'Maya');
 await page.getByRole('button',{name:'New meeting',exact:true}).click();await page.getByRole('button',{name:'Try an example',exact:true}).click();await page.getByRole('button',{name:'Analyze transcript',exact:true}).click();await page.getByRole('heading',{name:/Review action proposals/}).waitFor();await page.getByRole('button',{name:'Locate passage 1 for task 1',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.id==='saved-source');
 for(const theme of ['light','dark']){await page.getByLabel('Color theme').selectOption(theme);await page.screenshot({path:path.join(shots,`flow-showcase-${theme}.png`)});}
 const login=await context.newPage();await login.goto(authBase+'/sign-in');await login.getByRole('button',{name:'Continue with GitHub',exact:true}).waitFor();
 for(const width of [1440,768,320]){await login.setViewportSize({width,height:1000});for(const theme of ['light','dark']){await login.getByLabel('Color theme').selectOption(theme);await scan(login,`welcome-signin-${width}-${theme}`);await login.screenshot({path:path.join(shots,`flow-signin-${width}-${theme}.png`),fullPage:true});}}
 assert.deepEqual(errors,[]);console.log('Interface checks passed: compact navigation, desktop split/mobile stacked workspace, exact Unicode source highlighting, immutable saved evidence after input edits, keyboard passage focus, live summary counts, confirmation, escaped source text, responsive widths 320–1440, and light/dark accessibility for review and public sign-in.');
}finally{await writeFile(path.join(shots,'interface-accessibility.json'),JSON.stringify(checks,null,2));await browser?.close();for(const s of [server,authServer]){s.closeAllConnections();await s.shutdown();}await rm(folder,{recursive:true,force:true});}
