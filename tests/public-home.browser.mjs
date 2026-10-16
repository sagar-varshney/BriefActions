// Provider responses are fixtures; exercise the real browser SDK's PKCE exchange.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {createApp} from '../server/index.mjs';
import {loadConfig} from '../server/config.mjs';
const folder=await mkdtemp(path.join(tmpdir(),'flow-public-home-'));
const shots=process.env.FLOW_SCREENSHOTS || path.join(folder,'screenshots');await mkdir(shots,{recursive:true});
const user={id:'11111111-1111-4111-8111-111111111111',email:'alice@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-16T00:00:00Z'};
const token=`${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.fixture`;
const session={access_token:token,refresh_token:'fixture-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user};
const managed=createApp({config:{...loadConfig(),authMode:'supabase',emailEnabled:true,supabaseUrl:'https://test-project.supabase.co',supabaseKey:'sb_publishable_test'},historyPath:path.join(folder,'managed.sqlite3'),verifyAccount:async value=>value===token?user.id:null});
const local=createApp({historyPath:path.join(folder,'local.sqlite3')});
let browser;const checks=[];
try{
 for(const server of [managed,local])await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${managed.address().port}`,localBase=`http://127.0.0.1:${local.address().port}`;
 browser=await chromium.launch({headless:true,...(process.env.FLOW_CHROMIUM_PATH?{executablePath:process.env.FLOW_CHROMIUM_PATH}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],privateRequests=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',request=>{const url=new URL(request.url());if(url.origin===base && url.pathname.startsWith('/api/') && url.pathname!=='/api/auth-config')privateRequests.push(url.pathname);});
 let otp,exchange;
 await page.route('https://test-project.supabase.co/auth/v1/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname.endsWith('/authorize'))return route.fulfill({contentType:'text/html',body:'<h1>Fixture identity provider</h1>'});
  if(url.pathname.endsWith('/token')){exchange=request.postDataJSON();return route.fulfill({contentType:'application/json',body:JSON.stringify(session)});}
  if(url.pathname.endsWith('/otp')){otp={url:url.href,body:request.postDataJSON()};return route.fulfill({contentType:'application/json',body:'{}'});}
  return route.fulfill({contentType:'application/json',body:JSON.stringify(user)});
 });
 await page.goto(base);await page.getByRole('heading',{name:'Good conversations. Clear next steps.'}).waitFor();
 await page.getByRole('link',{name:'Sign in',exact:true}).first().waitFor();
 assert.deepEqual(privateRequests,[],'The public demo must not request private workspace data');
 assert.equal((await fetch(base+'/api/runs')).status,401,'Public HTML must not expose private API access');
 await page.getByRole('button',{name:'Show supporting passage for Review the release notes',exact:true}).focus();await page.keyboard.press('Enter');
 assert.equal(await page.locator('.demo-source-active').textContent(),'AlexPlease review the release notes.');assert.equal(await page.getByRole('button',{name:'Show supporting passage for Review the release notes',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByText('Do I need a technical background?',{exact:true}).click();assert.equal(await page.locator('details').first().getAttribute('open'),'');
 // The homepage keeps its art direction; choosing a theme starts at sign-in.
 assert.equal(await page.getByLabel('Color theme').count(),0);
 const palette=()=>page.evaluate(()=>Object.fromEntries(['.landing-hero','.landing-demo','.landing-how','.landing-features','.landing-faq','.landing-close'].map(selector=>{
  const el=document.querySelector(selector),style=getComputedStyle(el);let background=el;
  while(getComputedStyle(background).backgroundColor==='rgba(0, 0, 0, 0)')background=background.parentElement;
  return [selector,{background:getComputedStyle(background).backgroundColor,text:style.color}];
 })));
 const expectedPalette=await palette();
 assert.equal(expectedPalette['.landing-hero'].background,'rgb(19, 21, 24)');
 assert.equal(expectedPalette['.landing-demo'].background,'rgb(255, 255, 255)');
 assert.equal(expectedPalette['.landing-how'].background,'rgb(255, 255, 255)');
 assert.equal(expectedPalette['.landing-features'].background,'rgb(19, 21, 24)');
 assert.equal(expectedPalette['.landing-faq'].background,'rgb(255, 255, 255)');
 assert.equal(expectedPalette['.landing-close'].background,'rgb(19, 21, 24)');
 for(const preference of ['light','dark','system']){
  await page.goto(base+'/sign-in');await page.getByRole('button',{name:'Continue with GitHub',exact:true}).waitFor();
  await page.getByLabel('Color theme').selectOption(preference);
  await page.getByRole('link',{name:'← Back to home',exact:true}).click();await page.getByRole('heading',{name:'Good conversations. Clear next steps.'}).waitFor();
  for(const scheme of ['light','dark']){
   await page.emulateMedia({colorScheme:scheme});
   assert.deepEqual(await palette(),expectedPalette,'Saved preference and system appearance must not recolor the homepage');
   assert.equal(await page.evaluate(()=>localStorage.getItem('flow.theme')),preference,'The homepage must preserve the selected workspace theme');
  }
  for(const width of [1440,1024,768,390,320]){
   await page.setViewportSize({width,height:1000});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Home ${width} ${preference}: no overflow`);
   const brand=await page.getByRole('link',{name:'BriefActions home',exact:true}).boundingBox(),workflow=await page.locator('.landing-how').boundingBox();
   assert.ok(Math.abs(brand.x-workflow.x)<1,`Home ${width}: header and content must share the same alignment`);
   if(preference==='light' && [1440,320].includes(width)){
    const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();checks.push({label:`home-${width}-mixed`,violations:result.violations});assert.deepEqual(result.violations.map(({id,nodes})=>({id,targets:nodes.map(n=>n.target)})),[]);
   }
   if(preference==='light' && [1440,390].includes(width))await page.screenshot({path:path.join(shots,`homepage-${width}-mixed.png`),fullPage:true});
  }
  await page.getByRole('link',{name:'Sign in',exact:true}).first().click();await page.getByLabel('Color theme').waitFor();
  assert.equal(await page.getByLabel('Color theme').inputValue(),preference);
  assert.equal(await page.locator('html').getAttribute('data-theme'),preference==='system'?'dark':preference,'Sign-in must restore the saved theme');
  await page.reload();await page.getByRole('button',{name:'Continue with GitHub',exact:true}).waitFor();assert.equal(await page.getByLabel('Color theme').inputValue(),preference);
  await page.goto(base);await page.getByRole('heading',{name:'Good conversations. Clear next steps.'}).waitFor();
 }
 assert.deepEqual(privateRequests,[],'Theme, sample evidence and FAQs must stay public-only');
 await page.getByRole('link',{name:'Sign in',exact:true}).first().click();await page.getByRole('button',{name:'Continue with GitHub',exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,'/sign-in');
 await page.getByLabel('Email address').fill('alice@example.test');await page.getByRole('button',{name:'Email me a sign-in link',exact:true}).click();await page.getByRole('status').filter({hasText:'Check your email'}).waitFor();assert.equal(otp.body.email,'alice@example.test');assert.equal(new URL(otp.url).searchParams.get('redirect_to'),base+'/auth/callback');assert.equal(otp.body.code_challenge_method,'s256');
 await page.goto(base+'/tasks');await page.getByRole('button',{name:'Continue with GitHub',exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,'/sign-in');assert.equal(await page.evaluate(()=>sessionStorage.getItem('flow.authReturn')),'/tasks');assert.deepEqual(privateRequests,[]);
 await page.getByRole('button',{name:'Continue with GitHub',exact:true}).click();await page.getByRole('heading',{name:'Fixture identity provider'}).waitFor();
 const authorize=new URL(page.url());assert.equal(authorize.searchParams.get('provider'),'github');assert.equal(authorize.searchParams.get('redirect_to'),base+'/auth/callback');assert.equal(authorize.searchParams.get('code_challenge_method'),'s256');assert.ok(authorize.searchParams.get('code_challenge'));
 await page.goto(base+'/auth/callback?code=fixture-code');await page.getByText('alice@example.test',{exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,'/tasks');assert.equal(new URL(page.url()).search,'');assert.equal(exchange.auth_code,'fixture-code');assert.ok(exchange.code_verifier);
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('flow.authReturn')),null);
 await page.goto(base);await page.getByRole('heading',{name:'Good conversations. Clear next steps.'}).waitFor();await page.getByRole('link',{name:'Open workspace',exact:true}).first().waitFor();
 // A stored redirect is untrusted, including when it was written outside this UI.
 await page.evaluate(()=>sessionStorage.setItem('flow.authReturn','//untrusted.example/private'));await page.goto(base+'/sign-in');await page.getByText('alice@example.test',{exact:true}).waitFor();assert.equal(new URL(page.url()).origin,base);assert.equal(new URL(page.url()).pathname,'/meetings');
 // A fresh failed callback exposes no provider text or private data and allows retry.
 await context.clearCookies();await page.evaluate(()=>localStorage.clear());await page.goto(base+'/auth/callback?error=access_denied&error_description=private-provider-message');await page.getByRole('alert').filter({hasText:'couldn’t finish'}).waitFor();assert.equal(new URL(page.url()).pathname,'/sign-in');assert.equal(new URL(page.url()).search,'');assert.ok(!(await page.locator('body').textContent()).includes('private-provider-message'));await page.getByRole('button',{name:'Continue with GitHub',exact:true}).waitFor();
 await page.goto(base+'/#error=access_denied&error_description=private-provider-message');await page.getByRole('alert').filter({hasText:'couldn’t finish'}).waitFor();assert.equal(new URL(page.url()).pathname,'/sign-in');assert.equal(new URL(page.url()).hash,'');
 await page.goto(base+'/sign-in');await page.getByRole('button',{name:'Continue with GitHub',exact:true}).waitFor();await page.setViewportSize({width:1440,height:1000});await page.getByLabel('Color theme').selectOption('light');await page.screenshot({path:path.join(shots,'sign-in-light.png'),fullPage:true});
 for(const width of [1440,320])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:1000});await page.getByLabel('Color theme').selectOption(theme);const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();checks.push({label:`email-signin-${width}-${theme}`,violations:result.violations});assert.equal(result.violations.length,0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 await page.goto(localBase+'/sign-in');await page.getByRole('link',{name:'Open local workspace',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Continue with GitHub'}).count(),0);await page.getByLabel('Color theme').selectOption('dark');await page.getByRole('link',{name:'Open local workspace',exact:true}).click();await page.getByRole('button',{name:'Try an example',exact:true}).waitFor();assert.equal(await page.getByLabel('Color theme').inputValue(),'dark');assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 assert.deepEqual(errors,[]);console.log('Public entry checks passed: fixed light/dark homepage, preserved sign-in/workspace theme preferences, sample-only demo, private API gate, responsive accessibility, keyboard evidence, email and GitHub PKCE callbacks, intended route, unsafe redirect rejection, callback failure recovery, and honest local preview.');
}finally{await writeFile(path.join(shots,'public-accessibility.json'),JSON.stringify(checks,null,2));await browser?.close();for(const server of [managed,local]){server.closeAllConnections();await server.shutdown();}await rm(folder,{recursive:true,force:true});}
