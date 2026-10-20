import {meetingField} from './browser-helpers.mjs';
// Managed auth responses are fixtures; live OAuth settings still need launch verification.
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server/index.mjs';
import {loadConfig} from '../server/config.mjs';

const folder=await mkdtemp(path.join(tmpdir(),'flow-auth-browser-'));
const screenshotDir=process.env.FLOW_SCREENSHOTS || path.join(folder,'screenshots');await mkdir(screenshotDir,{recursive:true});
const alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222';
const session=id=>({access_token:`${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.fixture`,refresh_token:'fixture-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id,email:id===alice?'alice@example.test':'bob@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-12T00:00:00Z'}});
const first=session(alice),second=session(bob);
const config={...loadConfig(),authMode:'supabase',supabaseUrl:'https://test-project.supabase.co',supabaseKey:'sb_publishable_test'};
let failDeletion=true;const deleted=[];
const server=createApp({config,historyPath:path.join(folder,'history.sqlite3'),verifyAccount:async token=>token===first.access_token?alice:token===second.access_token && !deleted.includes(bob)?bob:null,deleteAccount:async id=>{assert.equal(id,bob);if(failDeletion)throw new Error('provider unavailable');deleted.push(id);}});
let browser;
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,...(process.env.FLOW_CHROMIUM_PATH?{executablePath:process.env.FLOW_CHROMIUM_PATH}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://test-project.supabase.co/auth/v1/**',route=>route.fulfill({status:route.request().url().includes('/logout')?204:200,contentType:'application/json',body:route.request().url().includes('/logout')?'':JSON.stringify(first.user)}));
  await page.goto(base);await page.getByRole('heading',{name:'Good conversations. Clear next steps.'}).waitFor();await page.getByRole('link',{name:'Sign in',exact:true}).first().click();await page.getByRole('button',{name:'Continue with GitHub'}).waitFor();assert.equal(await (await meetingField(page,'Meeting transcript')).count(),0);
  await page.getByLabel('Color theme').selectOption('dark');await page.screenshot({path:path.join(screenshotDir,'sign-in-dark.png'),fullPage:true});
  await page.evaluate(value=>localStorage.setItem('sb-test-project-auth-token',JSON.stringify(value)),first);await page.reload();
  await page.getByText('alice@example.test',{exact:true}).waitFor();await page.getByText('START HERE · EXTRACT & REVIEW',{exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,'/meetings');await page.getByRole('button',{name:'Try an example',exact:true}).click();await page.getByRole('button',{name:'Analyze transcript'}).click();await page.getByRole('heading',{name:/Review action proposals/}).waitFor();
  for(const width of [1600,1440,1366,1280]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Signed-in navigation must fit at ${width}px`);}
  await page.setViewportSize({width:1440,height:1000});
  const active=await page.evaluate(id=>localStorage.getItem(`flow.account.${id}.flow.activeRun`),alice);assert.match(active,/^[a-f0-9]{32}$/);
  await page.getByLabel('Keep task 1',{exact:true}).check();await page.getByRole('button',{name:'Confirm selected tasks'}).click();await page.getByRole('heading',{name:'Your confirmed plan'}).waitFor();
  // A returning account on a fresh browser still starts at My day, without a visit flag.
  const fresh=await browser.newPage();await fresh.route('https://test-project.supabase.co/auth/v1/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(first.user)}));
  await fresh.goto(base+'/sign-in');await fresh.getByRole('button',{name:'Continue with GitHub',exact:true}).waitFor();await fresh.evaluate(value=>localStorage.setItem('sb-test-project-auth-token',JSON.stringify(value)),first);await fresh.reload();await fresh.getByRole('heading',{name:'My day',exact:true}).waitFor();assert.equal(new URL(fresh.url()).pathname,'/today');await fresh.close();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export CSV'}).click();assert.ok((await readFile(await (await download).path(),'utf8')).includes('Arjun'));
  await page.evaluate(()=>sessionStorage.setItem('flow.authReturn','/history'));await page.goto(base+'/auth/callback');await page.getByRole('heading',{name:'Your meeting history.',exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,'/history');await page.getByRole('button',{name:'Open meeting',exact:true}).click();await page.getByRole('heading',{name:'Your confirmed plan',exact:true}).waitFor();
  const saved=await (await fetch(base+`/api/runs/${active}`,{headers:{Authorization:`Bearer ${first.access_token}`}})).json(),taskId=saved.final_tasks[0].proposal_id;
  await page.evaluate(()=>localStorage.removeItem('sb-test-project-auth-token'));await page.goto(base+`/meetings/${active}?task=${taskId}`);await page.getByRole('button',{name:'Continue with GitHub',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('flow.authReturn')),`/meetings/${active}?task=${taskId}`);
  await page.evaluate(value=>localStorage.setItem('sb-test-project-auth-token',JSON.stringify(value)),first);await page.goto(base+'/auth/callback');await page.getByRole('heading',{name:'Your confirmed plan',exact:true}).waitFor();assert.equal(new URL(page.url()).search,`?task=${taskId}`);await page.waitForFunction(()=>document.activeElement?.id?.startsWith('confirmed-task-'));
  await (await meetingField(page,'Meeting transcript')).fill('Alice-only unsubmitted browser draft.');
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('button',{name:'Continue with GitHub'}).waitFor();assert.equal(await page.getByRole('heading',{name:'Your confirmed plan'}).count(),0);
  // Same browser, different account: the previous run and drafts remain inaccessible.
  await page.evaluate(value=>localStorage.setItem('sb-test-project-auth-token',JSON.stringify(value)),second);await page.reload();
  await page.getByText('bob@example.test',{exact:true}).waitFor();await page.getByText('START HERE · EXTRACT & REVIEW',{exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,'/meetings');assert.equal(await (await meetingField(page,'Meeting transcript')).inputValue(),'');assert.equal(await page.getByRole('heading',{name:'Your confirmed plan'}).count(),0);
  await page.getByRole('button',{name:'Meeting history',exact:true}).click();await page.getByRole('heading',{name:'No saved meetings yet.'}).waitFor();
  await page.getByRole('button',{name:'Extract & review',exact:true}).click();await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(screenshotDir,'mobile-account-dark.png'),fullPage:true});
  await page.getByLabel('Color theme').selectOption('light');await page.screenshot({path:path.join(screenshotDir,'mobile-account-light.png'),fullPage:true});
  await page.getByRole('button',{name:'Try an example',exact:true}).click();await page.getByRole('button',{name:'Analyze transcript',exact:true}).click();await page.getByRole('heading',{name:/Review action proposals/}).waitFor();
  await page.evaluate(id=>localStorage.setItem(`flow.account.${id}.flow.draft.fake`,'private unfinished text'),bob);
  await page.getByRole('button',{name:'Data & account',exact:true}).click();await page.getByRole('button',{name:'Delete my account',exact:true}).waitFor();
  await page.getByRole('button',{name:'Delete my account',exact:true}).click();await page.getByLabel('Deletion confirmation').fill('DELETE MY ACCOUNT');
  await page.getByRole('dialog').getByRole('button',{name:'Delete my account',exact:true}).click();
  await page.getByRole('dialog').getByRole('alert').filter({hasText:'Sign-in account deletion is pending'}).waitFor();
  assert.equal(await page.evaluate(id=>localStorage.getItem(`flow.account.${id}.flow.draft.fake`),bob),null);
  assert.equal(await page.evaluate(id=>localStorage.getItem(`flow.account.${id}.flow.activeRun`),alice),active);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.ok(!await page.getByRole('button',{name:'Extract & review',exact:true}).isEnabled());
  await page.goto(base+'/workspace');await page.getByRole('button',{name:'Retry account deletion',exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,'/account');
  await page.screenshot({path:path.join(screenshotDir,'mobile-account-deletion-retry.png'),fullPage:true});
  failDeletion=false;await page.getByRole('button',{name:'Retry account deletion',exact:true}).click();await page.getByLabel('Deletion confirmation').fill('DELETE MY ACCOUNT');
  await page.getByRole('dialog').getByRole('button',{name:'Delete my account',exact:true}).click();await page.getByRole('button',{name:'Continue with GitHub',exact:true}).waitFor();assert.deepEqual(deleted,[bob]);
  assert.deepEqual(errors,[]);console.log('Authenticated browser checks passed: sign-in gate, SDK session, authenticated CSV, sign-out, account-scoped history/browser drafts, desktop/mobile themes, confirmed account erasure, provider-failure/reload retry, cache cleanup, and unaffected second account.');
}finally{await browser?.close();server.closeAllConnections();await server.shutdown();await rm(folder,{recursive:true,force:true});}
