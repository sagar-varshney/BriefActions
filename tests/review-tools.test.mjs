import test from 'node:test';
import assert from 'node:assert/strict';
import {issues,reviewError,validDeadline,dueMatches,localToday} from '../web/src/reviewTools.js';
import {readRoute,routePath} from '../web/src/routing.js';
import {actionPlan} from '../web/src/actionPlan.js';
test('Review attention and final validation distinguish unknown metadata from invalid dates',()=>{
 assert.deepEqual(issues({task:'Send report',owner:'Unknown',deadline:'Unknown'}).map(i=>i.field),['owner','deadline']);
 for(const date of ['2028-02-29','0001-01-01','Unknown'])assert.ok(validDeadline(date),date);
 for(const date of ['2026-02-29','2026-02-30','0000-01-01','20261015','unknown',''])assert.ok(!validDeadline(date),date);
 assert.equal(reviewError([{task:'Send report',owner:'Unknown',deadline:'Unknown'}]),null);
 assert.equal(reviewError([{task:'Send report',owner:'Maya',deadline:'2026-02-30'}]).field,'deadline');
});
test('Due date filters exclude done tasks and handle seven-day and calendar boundaries',()=>{
 const task={deadline:'2027-01-02'};
 assert.ok(dueMatches(task,'todo','upcoming','2026-12-29'));
 assert.ok(!dueMatches(task,'done','upcoming','2026-12-29'));
 assert.ok(dueMatches({deadline:'2026-12-28'},'todo','overdue','2026-12-29'));
 assert.ok(!dueMatches({deadline:'2026-12-28'},'done','overdue','2026-12-29'));
 assert.ok(dueMatches({deadline:'2026-12-29'},'todo','today','2026-12-29'));
 assert.ok(dueMatches({deadline:'Unknown'},'todo','unknown','2026-12-29'));
 assert.ok(!dueMatches({deadline:'2027-01-06'},'todo','upcoming','2026-12-29'));
 assert.equal(localToday(new Date(2026,9,14,23,30)),'2026-10-14');
});
test('Workspace routes encode sections and validated meeting identifiers without input content',()=>{
 for(const page of ['extract','tasks','history','benchmark','annotations','data'])assert.equal(readRoute(new URL(routePath({page}),'https://flow.example')).page,page);
 const id='a'.repeat(32);assert.deepEqual(readRoute(new URL(`https://flow.example/meetings/${id}`)),{page:'extract',runId:id});
 assert.equal(readRoute(new URL('https://flow.example/meetings/not-an-id')).invalid,true);
 assert.equal(readRoute(new URL('https://flow.example/#data')).page,'data');
});

test('Task links round-trip regular and manually added IDs without putting transcript text into URLs',()=>{
 const runId='a'.repeat(32);
 for(const taskId of ['b'.repeat(16),'manual-'+('c'.repeat(32))]){
  const route={page:'extract',runId,taskId};assert.deepEqual(readRoute(new URL(routePath(route),'https://flow.example')),route);
 }
 assert.equal(readRoute(new URL(`https://flow.example/meetings/${runId}?task=%3Cscript%3E`)).taskId,undefined);
});

test('Review explanations flag competing dates without treating distinct assignments as a proven conflict',()=>{
 const one={proposal_id:'one',task:'Send the report',owner:'Maya',deadline:'2026-10-16'},two={proposal_id:'two',task:'Send report',owner:'Maya',deadline:'2026-10-19'};
 const reason=issues(one,[one,two])[0];assert.equal(reason.label,'Different deadlines');assert.match(reason.description,/2026-10-19/);
 assert.deepEqual(issues(one,[one,{...two,owner:'Jon'}]),[]);
 assert.deepEqual(issues(one,[one,{...two,deadline:one.deadline}]),[]);
 assert.deepEqual(issues(one,[one,{...two,task:'Review report'}]),[]);
 assert.equal(issues({...one,owner:'Unknown'})[0].label,'Owner unknown');
 assert.match(issues({...one,deadline:'Unknown'})[0].description,/keep|stay Unknown/);
 assert.deepEqual(issues({...one,task:'Review café A'},[{...two,task:'Review café B'}]),[]);
 assert.deepEqual(issues({...one,task:'Review 東京'},[{...two,task:'Review 京都'}]),[]);
 assert.equal(issues({...one,task:'Review 東京'},[{...two,task:'Review 東京'}])[0].label,'Different deadlines');
 assert.equal(reviewError([one,two]),null,'Competing proposals are a review aid, not a confirmation prohibition');
});

test('Readable plan exports preserve confirmed values, Unknown metadata and evidence without changing with progress',()=>{
 const run={id:'a'.repeat(32),status:'confirmed',title:'Planning 📝',reference_date:'2026-10-16',final_tasks:[
  {proposal_id:'one',task:'Send report',owner:'Unknown',deadline:'Unknown',evidence:[{text:'Please send the report.\nNo deadline was given.'}]},
  {proposal_id:'two',task:'Review report',owner:'Ada',deadline:'2026-10-19',evidence:[{text:'Ada: I will review it by Monday.'}]}]};
 const before=structuredClone(run),text=actionPlan(run);
 assert.ok(text.indexOf('Owner: Ada')<text.indexOf('Owner: Unknown'));
 for(const task of run.final_tasks)for(const field of ['task','owner','deadline'])assert.ok(text.includes(task[field]));
 assert.ok(text.includes('Please send the report.\n    No deadline was given.'));
 assert.ok(actionPlan(run,{groupBy:'none'}).indexOf('Send report')<actionPlan(run,{groupBy:'none'}).indexOf('Review report'));
 assert.ok(actionPlan(run,{groupBy:'deadline'}).indexOf('Deadline: 2026-10-19')<actionPlan(run,{groupBy:'deadline'}).indexOf('Deadline: Unknown'));
 assert.deepEqual(run,before);
 assert.equal(actionPlan({...run,task_progress:{one:{status:'done',version:1}}}),text);
 assert.match(actionPlan({...run,final_tasks:[]}),/No tasks were confirmed/);
 assert.throws(()=>actionPlan({...run,status:'review'}),/Confirm/);
 assert.throws(()=>actionPlan(run,{groupBy:'untrusted'}));
});

test('Markdown exports escape active markup in meeting names, tasks, owners and supporting text',()=>{
 const attack='![image](https://example.com/track) <script>alert(1)</script> & **bold**';
 const run={status:'confirmed',title:attack,reference_date:'2026-10-16',final_tasks:[{task:attack,owner:attack,deadline:'Unknown',evidence:[{text:attack}]}]};
 const md=actionPlan(run,{format:'markdown'});
 assert.ok(!md.includes('![image]('));assert.ok(!md.includes('<script>'));assert.ok(md.includes('&lt;script&gt;'));
 assert.ok(md.includes('\\!\\[image\\]\\(https://example\\.com/track\\)'));
 assert.ok(actionPlan(run).includes(attack),'Plain text remains literal rather than HTML');
});

test('Keyboard passage selection preserves Unicode characters and selection anchors',async()=>{
 const {movePassageSelection:move}=await import('../web/src/passageSelection.js');
 const text='A📊B';
 assert.deepEqual(move(text,1,1,'forward','ArrowRight',true),{start:1,end:3,direction:'forward'});
 assert.deepEqual(move(text,3,3,'forward','ArrowLeft',true),{start:1,end:3,direction:'backward'});
 assert.deepEqual(move(text,1,3,'backward','ArrowRight',true),{start:3,end:3,direction:'forward'});
 assert.deepEqual(move(text,0,4,'forward','ArrowLeft',false),{start:0,end:0,direction:'forward'});
 assert.deepEqual(move(text,0,4,'backward','ArrowRight',false),{start:4,end:4,direction:'forward'});
 assert.deepEqual(move(text,0,0,'forward','ArrowLeft',true),{start:0,end:0,direction:'forward'});
 assert.deepEqual(move(text,4,4,'forward','ArrowRight',true),{start:4,end:4,direction:'forward'});
});

test('Authentication destinations keep task context while rejecting external, public and malformed routes',async()=>{
 const {workspaceDestination:destination,authScreen}=await import('../web/src/authRouting.js'),origin='https://flow.example',runId='a'.repeat(32);
 assert.equal(destination(`/meetings/${runId}?task=manual-123&code=secret#private`,origin),`/meetings/${runId}?task=manual-123`);
 for(const value of [null,'https://untrusted.example/tasks','//untrusted.example/tasks','/\\untrusted.example/tasks','/sign-in','/auth/callback','/privacy','/missing','/meetings/not-an-id','/?code=secret'])assert.equal(destination(value,origin),'/meetings',String(value));
 assert.equal(destination('/#data',origin),'/account');assert.equal(destination('/tasks?unused=value',origin),'/tasks');
 for(const [path,screen] of [['/','landing'],['/#how','landing'],['/sign-in/','signin'],['/auth/callback?code=secret','callback'],['/?code=secret','callback'],['/#access_token=secret','callback'],['/#error=access_denied','callback'],['/?error_description=expired','callback'],['/#data','workspace'],['/tasks','workspace']])assert.equal(authScreen(new URL(path,origin)),screen);
});
