// Internal release rehearsal: invented content, a disposable database and auth fixtures.
// This exercises the real SDK and application; it does not verify live GitHub OAuth.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {createApp} from '../server/index.mjs';
import {loadConfig} from '../server/config.mjs';
import {meetingField,navigate} from './browser-helpers.mjs';

const refresh=process.argv.includes('--refresh-screenshots');
const folder=await mkdtemp(path.join(tmpdir(),'briefactions-release-'));
const shots=refresh?path.resolve('docs/screenshots'):process.env.FLOW_SCREENSHOTS||path.join(folder,'screenshots');
await mkdir(shots,{recursive:true});
const account='33333333-3333-4333-8333-333333333333';
const deviceTime='2026-10-24T08:00:00Z',now=Math.floor(new Date(deviceTime).getTime()/1000),session={
 access_token:`${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({sub:account,exp:now+3600})).toString('base64url')}.fixture`,
 refresh_token:'invented-release-refresh',expires_at:now+3600,expires_in:3600,token_type:'bearer',
 user:{id:account,email:'demo@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-24T00:00:00Z'}
};
// Ignore inherited hosting settings: even a shell with production credentials
// must rehearse against this disposable local database and fixture provider.
const server=createApp({historyPath:path.join(folder,'history.sqlite3'),config:{...loadConfig({}),authMode:'supabase',supabaseUrl:'https://test-project.supabase.co',supabaseKey:'sb_publishable_test'},verifyAccount:async token=>token===session.access_token?account:null});
const checks=[],errors=[];let browser,page,expiredRefreshes=0;
const transcript="Maya: I'll send the launch checklist tomorrow.\nJon: I'll review the onboarding flow by Monday.\nAction item: Update the FAQ.";
async function scan(label){
 const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
 checks.push({label,violations:result.violations,incomplete:result.incomplete.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))});
 assert.deepEqual(result.violations,[],label);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' horizontal overflow');
}
async function screenshot(name){
 const original=page.viewportSize(),mobile=original.width===320;
 // Include the actual task fields and calendar entries, rather than clipping the
 // showcase immediately below its heading. Do not alter the application DOM.
 if(!mobile&&/^(review|calendar)-/.test(name))await page.setViewportSize({width:original.width,height:1500});
 await page.evaluate(()=>scrollTo(0,0));await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:path.join(shots,name),animations:'disabled',fullPage:mobile});
 if(!mobile)await page.setViewportSize(original);
}
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,...(process.env.FLOW_CHROMIUM_PATH?{executablePath:process.env.FLOW_CHROMIUM_PATH}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Kolkata',reducedMotion:'reduce'});
 page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 // Hold the device day still, without advancing JWT expiry or intercepting application APIs.
 await page.clock.setFixedTime(new Date(deviceTime));
 await page.route('https://test-project.supabase.co/auth/v1/**',route=>{
  if(route.request().url().includes('/token')){expiredRefreshes++;return route.fulfill({status:400,json:{code:'refresh_token_not_found',msg:'Invalid Refresh Token: fixture expired'}});}
  return route.fulfill({status:200,json:session.user});
 });
 await page.goto(base+'/');await page.getByRole('heading',{name:'Good conversations. Clear next steps.',exact:true}).waitFor();await screenshot('homepage.png');
 await page.getByRole('link',{name:'Sign in',exact:true}).first().click();await page.getByRole('button',{name:'Continue with GitHub',exact:true}).waitFor();
 await page.getByLabel('Color theme').selectOption('light');await scan('sign-in-light');await screenshot('sign-in-light.png');
 await page.evaluate(value=>localStorage.setItem('sb-test-project-auth-token',JSON.stringify(value)),session);await page.reload();
 await page.getByText('START HERE · EXTRACT & REVIEW',{exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,'/meetings');
 await (await meetingField(page,'Meeting name')).fill('Launch planning · invented example');
 await (await meetingField(page,'Meeting date')).fill('2026-10-22');
 await (await meetingField(page,'Meeting transcript')).fill(transcript);
 await page.getByRole('button',{name:'Analyze transcript',exact:true}).click();await page.getByRole('heading',{name:/Review action proposals/}).waitFor();
 assert.equal(await page.getByLabel(/^Keep task \d+$/).count(),3);
 assert.equal(await page.getByLabel('Owner 3',{exact:true}).inputValue(),'Unknown');assert.equal(await page.getByLabel('Deadline 3',{exact:true}).inputValue(),'Unknown');
 await page.getByRole('button',{name:'Locate passage 1 for task 1',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.id==='saved-source');
 assert.equal(await page.locator('#saved-source mark').textContent(),"Maya: I'll send the launch checklist tomorrow.");
 await page.getByRole('button',{name:'Back to task',exact:true}).click();
 await page.getByLabel('Owner 2',{exact:true}).fill('Jordan');
 await page.getByLabel('Keep task 1',{exact:true}).check();await page.getByLabel('Keep task 2',{exact:true}).check();
 await page.locator('.save-feedback').getByText('Saved',{exact:true}).waitFor();
 for(const theme of ['light','dark']){
  await page.getByLabel('Color theme').selectOption(theme);await scan('review-desktop-'+theme);await screenshot('review-'+theme+'.png');
  await page.setViewportSize({width:320,height:844});await scan('review-mobile-'+theme);
  await page.getByLabel('Keep task 2',{exact:true}).focus();await page.keyboard.press('Space');await page.keyboard.press('Space');
  assert.ok(await page.getByLabel('Keep task 2',{exact:true}).isChecked(),'Keyboard selection must remain usable on mobile');
  await screenshot('review-mobile-'+theme+'.png');await page.setViewportSize({width:1440,height:1000});
 }
 await page.locator('.save-feedback').getByText('Saved',{exact:true}).waitFor();
 const runId=await page.evaluate(id=>localStorage.getItem(`flow.account.${id}.flow.activeRun`),account);assert.match(runId,/^[a-f0-9]{32}$/);
 const unfinished='Unfinished notes for a later review. Keep this browser draft.';
 await (await meetingField(page,'Meeting transcript')).fill(unfinished);
 // Force a rejected refresh through the SDK, then sign back into the same isolated account.
 await page.evaluate(value=>localStorage.setItem('sb-test-project-auth-token',JSON.stringify({...value,expires_at:1})),session);
 await page.reload();await page.getByRole('button',{name:'Continue with GitHub',exact:true}).waitFor();assert.ok(expiredRefreshes>0);
 assert.equal(await page.getByRole('heading',{name:/Review action proposals/}).count(),0,'An expired session must unmount private workspace content');
 await page.evaluate(value=>localStorage.setItem('sb-test-project-auth-token',JSON.stringify(value)),session);await page.goto(base+'/auth/callback');
 await page.getByRole('heading',{name:/Review action proposals/}).waitFor();
 assert.equal(await page.getByLabel('Owner 2',{exact:true}).inputValue(),'Jordan');assert.ok(await page.getByLabel('Keep task 2',{exact:true}).isChecked());
 assert.equal(await (await meetingField(page,'Meeting transcript')).inputValue(),unfinished);
 assert.equal(await page.locator('#saved-source').textContent(),transcript,'Recovering edits must keep original evidence intact');
 await page.getByRole('button',{name:'Discard transcript draft',exact:true}).click();
 await page.getByRole('button',{name:'Confirm selected tasks',exact:true}).click();await page.getByRole('heading',{name:'Your confirmed plan',exact:true}).waitFor();
 assert.equal(await page.locator('.confirmed-card').count(),2,'Unselected proposals must not become tasks');
 await page.getByLabel('Progress for task 1',{exact:true}).selectOption('in_progress');
 await page.getByRole('status').filter({hasText:'Task progress saved'}).waitFor();
 await page.getByRole('button',{name:'Correct deadline for task 1',exact:true}).click();
 await page.getByLabel('New deadline for task 1',{exact:true}).fill('2026-10-27');
 await page.getByLabel('Reason for correction for task 1',{exact:true}).fill('Agreed at the follow-up: checklist due Tuesday.');
 await page.getByRole('button',{name:'Save deadline correction',exact:true}).click();await page.getByRole('status').filter({hasText:'Deadline corrected. Calendar'}).waitFor();
 await navigate(page,'All tasks');await page.getByRole('status').filter({hasText:'2 tasks'}).waitFor();
 for(const theme of ['light','dark']){await page.getByLabel('Color theme').selectOption(theme);await scan('all-tasks-'+theme);await screenshot('all-tasks-'+theme+'.png');}
 await navigate(page,'Calendar');await page.getByLabel('Calendar month',{exact:true}).fill('2026-10');await page.getByLabel('Selected calendar date',{exact:true}).fill('2026-10-27');
 const detail=page.locator('.calendar-detail');await detail.locator('.calendar-entry-task').waitFor();
 assert.match(await detail.innerText(),/launch checklist/);assert.match(await detail.innerText(),/In progress/);
 for(const theme of ['light','dark']){await page.getByLabel('Color theme').selectOption(theme);await scan('calendar-desktop-'+theme);await screenshot('calendar-'+theme+'.png');await page.setViewportSize({width:320,height:844});await scan('calendar-mobile-'+theme);await page.setViewportSize({width:1440,height:1000});}
 // A failed read must offer a nearby recovery action and must not lose the selection.
 await page.route('**/api/calendar?**',route=>route.fulfill({status:503,json:{error:'Calendar temporarily unavailable.'}}),{times:1});
 await page.getByRole('button',{name:'Refresh calendar',exact:true}).click();await page.getByRole('button',{name:'Retry calendar loading',exact:true}).click();
 await detail.locator('.calendar-entry-task').waitFor();assert.equal(await page.getByLabel('Selected calendar date',{exact:true}).inputValue(),'2026-10-27');
 await detail.getByRole('button',{name:'Open task & evidence',exact:true}).click();await page.getByRole('heading',{name:'Your confirmed plan',exact:true}).waitFor();
 await page.getByRole('button',{name:'Locate passage 1 for confirmed task 1',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.id==='saved-source');
 assert.equal(await page.locator('#saved-source mark').textContent(),"Maya: I'll send the launch checklist tomorrow.");
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export CSV',exact:true}).click();assert.equal(await (await download).failure(),null);
 const response=await fetch(base+`/api/runs/${runId}`,{headers:{Authorization:`Bearer ${session.access_token}`}});assert.ok(response.ok);const saved=await response.json();
 assert.equal(saved.final_tasks.length,2);assert.equal(saved.final_tasks[0].deadline,'2026-10-23');assert.equal(saved.current_tasks[0].deadline,'2026-10-27');assert.equal(saved.final_tasks[1].owner,'Jordan');assert.equal(saved.transcript,transcript);
 assert.deepEqual(errors,[]);
 console.log('Release journey passed: first-use routing, real extraction and evidence, Unknown metadata, correction/selection, expired-refresh/re-auth draft recovery, explicit confirmation, progress, traceable deadline/calendar update, read retry and CSV; desktop/mobile accessibility in both themes. Auth is fixture-backed, not live OAuth.');
}catch(error){if(page){await page.screenshot({path:path.join(shots,'release-journey-failure.png'),fullPage:true}).catch(()=>{});await writeFile(path.join(shots,'release-journey-failure.txt'),await page.locator('body').innerText().catch(()=>''));}throw error;}
finally{await writeFile(path.join(refresh?folder:shots,'release-journey-accessibility.json'),JSON.stringify(checks,null,2));await browser?.close();server.closeAllConnections();await server.shutdown();await rm(folder,{recursive:true,force:true});}
