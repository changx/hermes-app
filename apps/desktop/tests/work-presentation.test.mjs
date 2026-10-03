import test from 'node:test';
import assert from 'node:assert/strict';
import { workGroups, workIsExpanded, workDuration } from '../../../packages/client/src/workPresentation.ts';
const row=(key,role='assistant',kind,seconds)=>({key,role,kind,seconds});
test('public work follows explicit finals; user and system rows remain separate and identity/order are untouched',()=>{
 const rows=[row('user','user'),row('a','assistant',undefined,100),row('notice','system','system_notice'),row('followup','user'),row('tool','assistant',undefined,110),row('f','assistant','final',120),row('direct','assistant','direct',130),row('next','assistant',undefined,140)];
 const before=JSON.stringify(rows),groups=workGroups(rows,true),g=groups.get('a');
 assert.equal(g,groups.get('tool'));assert.deepEqual(g.members,['a','tool']);assert.equal(g.label,'Worked for 20s');assert.equal(g.completion,'f');assert.equal(workIsExpanded(g),false);
 for(const key of ['user','notice','followup','f','direct']) assert.equal(groups.has(key),false);
 assert.equal(groups.get('next').label,'Working');assert.equal(JSON.stringify(rows),before);
});
test('final arrival collapses active overrides immediately; reopening survives updates to same final',()=>{
 const active=workGroups([row('a','assistant',undefined,100)],true).get('a');
 assert.equal(workIsExpanded(active),true);assert.equal(workIsExpanded(active,{expanded:false}),false);
 const done=workGroups([row('a','assistant',undefined,100),row('f','assistant','final',120)],true).get('a');
 assert.equal(workIsExpanded(done,{expanded:true}),false);
 assert.equal(workIsExpanded(done,{completion:'f',expanded:true}),true);
 assert.equal(workIsExpanded(done,{completion:'other',expanded:true}),false);
});
test('absent finals never claim completed work; missing/backwards/invalid times never invent durations',()=>{
 assert.equal(workGroups([row('a')],false).get('a').label,'Work recorded');
 assert.equal(workGroups([row('a'),row('d','assistant','direct')],true).get('a').label,'Work recorded');
 for(const [a,b] of [[undefined,100],[100,undefined],[120,100],[NaN,100],[100,Infinity],[0,100]]) assert.equal(workDuration(a,b),'—');
 assert.equal(workDuration(100,120),'20s');assert.equal(workDuration(100,165),'1m 5s');assert.equal(workDuration(100,3765),'1h 1m');
 assert.equal(workGroups([row('a'),row('f','assistant','final')],false).get('a').label,'Worked for —');
});
