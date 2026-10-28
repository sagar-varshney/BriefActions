import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {createApp} from '../server/index.mjs';
import {legacyReviewDefaults,navigate,meetingField} from './browser-helpers.mjs';

const folder=await mkdtemp(path.join(tmpdir(),'briefactions-finish-'));
const shots=process.env.FLOW_SCREENSHOTS || path.join(folder,'screenshots');await mkdir(shots,{recursive:true});
const server=createApp({historyPath:path.join(folder,'history.sqlite3')});let browser;const checks=[];
async function scan(page,label){
 const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
 checks.push({label,violations:result.violations});assert.deepEqual(result.violations,[],label);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' overflow');
 await page.screenshot({path:path.join(shots,`${label}.png`),fullPage:true});
}
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,...(process.env.FLOW_CHROMIUM_PATH?{executablePath:process.env.FLOW_CHROMIUM_PATH}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await legacyReviewDefaults(page,[]);await page.goto(base+'/history');await page.getByRole('heading',{name:'No saved meetings yet.',exact:true}).waitFor();
 for(const width of [320,1440])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:1000});await page.getByLabel('Color theme').selectOption(theme);await scan(page,`finish-empty-history-${width}-${theme}`);
 }
 await page.getByRole('button',{name:'Add a meeting',exact:true}).click();
 const transcript='Maya will send the release notes tomorrow.';
 await (await meetingField(page,'Meeting transcript')).fill(transcript);await (await meetingField(page,'Meeting date')).fill('2026-10-22');
 await navigate(page,'All tasks');await page.getByRole('heading',{name:'No tasks in this view',exact:true}).waitFor();
 for(const width of [320,1440])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:1000});await page.getByLabel('Color theme').selectOption(theme);await scan(page,`finish-empty-tasks-${width}-${theme}`);
 }
 await page.getByRole('button',{name:'Add a meeting',exact:true}).click();
 assert.equal(await (await meetingField(page,'Meeting transcript')).inputValue(),transcript,'Empty-state shortcut preserves an unfinished draft');
 await navigate(page,'Meeting history');await page.getByRole('heading',{name:'No saved meetings yet.',exact:true}).waitFor();
 await page.getByRole('button',{name:'Add a meeting',exact:true}).click();assert.equal(await (await meetingField(page,'Meeting transcript')).inputValue(),transcript);
 // Disclosure links stay open within the group; Tab/Shift+Tab away closes it.
 const trigger=page.getByRole('button',{name:'Research tools',exact:true}),links=page.locator('#research-links');
 await trigger.focus();await page.keyboard.press('Enter');await page.keyboard.press('Tab');assert.ok(await links.getByRole('button').first().evaluate(el=>el===document.activeElement));
 await page.keyboard.press('Tab');assert.equal(await trigger.getAttribute('aria-expanded'),'true');await page.keyboard.press('Tab');assert.equal(await trigger.getAttribute('aria-expanded'),'false');
 await trigger.focus();await page.keyboard.press('Enter');await page.keyboard.press('Shift+Tab');assert.equal(await trigger.getAttribute('aria-expanded'),'false');
 await trigger.focus();await page.keyboard.press('Enter');await page.keyboard.press('Escape');assert.ok(await trigger.evaluate(el=>el===document.activeElement));
 await page.getByRole('button',{name:'Analyze transcript',exact:true}).click();await page.getByRole('checkbox',{name:'Keep task 1',exact:true}).check();
 await page.getByRole('button',{name:'Confirm selected tasks',exact:true}).click();await page.getByRole('heading',{name:'Your confirmed plan',exact:true}).waitFor();
 const runId=new URL(page.url()).pathname.split('/').at(-1),csvURL=`**/api/runs/${runId}/tasks.csv`;
 const csvButton=page.getByRole('button',{name:'Export CSV',exact:true}),csvControl=csvButton.locator('..');
 let requests=0,downloads=0;const received=Promise.withResolvers(),release=Promise.withResolvers();page.on('download',()=>downloads++);
 await page.route(csvURL,async route=>{
  requests++;
  if(requests===1)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'The export is temporarily unavailable.'})});
  const response=await route.fetch();received.resolve();await release.promise;await route.fulfill({response});
 });
 await csvButton.click();await csvControl.getByRole('alert').filter({hasText:'temporarily unavailable'}).waitFor();assert.ok(await csvButton.isEnabled());assert.equal(downloads,0);
 const csvDownload=page.waitForEvent('download');await csvButton.click();await received.promise;
 assert.ok(await csvButton.isDisabled());assert.equal(await csvButton.getAttribute('aria-busy'),'true');assert.equal(await csvControl.getByRole('alert').count(),0);
 await csvButton.evaluate(el=>{el.click();el.click();});
 for(const theme of ['light','dark']){await page.getByLabel('Color theme').selectOption(theme);await scan(page,'finish-download-pending-'+theme);}
 release.resolve();const csv=await csvDownload;assert.match(await readFile(await csv.path(),'utf8'),/Maya/);
 await csvControl.getByRole('status').filter({hasText:'File prepared.'}).waitFor();assert.ok(await csvButton.isEnabled());assert.equal(requests,2);assert.equal(downloads,1);
 const jsonDownload=page.waitForEvent('download');await page.getByRole('button',{name:'History JSON',exact:true}).click();const json=await jsonDownload;
 assert.ok((await readFile(await json.path(),'utf8')).includes(transcript));assert.equal(downloads,2);
 await navigate(page,'Meeting history');await page.getByLabel('Search meetings',{exact:true}).fill('no-such-meeting');
 await page.getByRole('heading',{name:'No meetings match your search.',exact:true}).waitFor();await page.getByRole('button',{name:'Show all meetings',exact:true}).click();
 await page.getByRole('button',{name:'Open meeting',exact:true}).waitFor();assert.equal(await page.getByLabel('Search meetings',{exact:true}).inputValue(),'');
 await navigate(page,'All tasks');await page.getByLabel('Search tasks',{exact:true}).fill('no-such-task');await page.getByRole('heading',{name:'No tasks in this view',exact:true}).waitFor();
 await page.getByRole('button',{name:'Show all confirmed tasks',exact:true}).click();await page.locator('.dashboard-task').waitFor();assert.equal(await page.getByLabel('Search tasks',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('Task status',{exact:true}).inputValue(),'');
 assert.deepEqual(errors,[]);console.log('Workspace finish passed: empty-state recovery preserves drafts and clears filters, keyboard disclosure dismissal, failed export recovery, one pending CSV request/download, CSV/JSON content, and light/dark mobile/desktop accessibility.');
}catch(error){const page=browser?.contexts()[0]?.pages()[0];if(page)await page.screenshot({path:path.join(shots,'finish-failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{await writeFile(path.join(shots,'workspace-finish-accessibility.json'),JSON.stringify(checks,null,2));await browser?.close();server.closeAllConnections();await server.shutdown();await rm(folder,{recursive:true,force:true});}
