import test from 'node:test';
import assert from 'node:assert/strict';
import {issues,reviewError,validDeadline,dueMatches,localToday} from '../web/src/reviewTools.js';
import {readRoute,routePath} from '../web/src/routing.js';
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
 for(const page of ['extract','history','benchmark','annotations','data'])assert.equal(readRoute(new URL(routePath({page}),'https://flow.example')).page,page);
 const id='a'.repeat(32);assert.deepEqual(readRoute(new URL(`https://flow.example/meetings/${id}`)),{page:'extract',runId:id});
 assert.equal(readRoute(new URL('https://flow.example/meetings/not-an-id')).invalid,true);
 assert.equal(readRoute(new URL('https://flow.example/#data')).page,'data');
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
