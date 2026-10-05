import test from 'node:test';
import assert from 'node:assert/strict';
import { chatClock, chatDate, chatDateSeparators, hasWaitingRequest, needsWorkPlaceholder } from '../src/chatPresentation.ts';
import { workGroups } from '../src/workPresentation.ts';
const user = { key:'u', role:'user', waiting:true };
const process = { key:'a', role:'assistant' };
const final = { key:'f', role:'assistant', kind:'final' };
const show = (messages, running=false) => needsWorkPlaceholder(messages, workGroups(messages, running || hasWaitingRequest(messages)), running);

test('pending sends immediately show one heading without changing message records', () => {
  const messages=[user];const copy=JSON.stringify(messages);
  assert.equal(show(messages),true);assert.equal(JSON.stringify(messages),copy);
  assert.equal(show([user,process],true),false);
  assert.equal(show([user,process,{...user,key:'followup'}],true),false);
});
test('explicit final/direct ends placeholder, system notices cannot reopen it', () => {
  for(const kind of ['final','direct']) {
    const messages=[user,{...final,kind}];
    assert.equal(show(messages,true),false);
    assert.equal(show([...messages,{key:'notice',role:'system',kind:'system_notice'}],true),false);
    assert.equal(show([...messages,{...user,key:'new'}]),true);
  }
});
test('a historical terminal request alone does not create feedback; active cold state does', () => {
  assert.equal(show([{...user,waiting:false}]),false);
  assert.equal(show([user]),true);
  assert.equal(show([],true),true);
});
test('clock is fixed local HH:mm and unavailable times are never replaced by now', () => {
  assert.equal(chatClock(new Date(2026,9,5,22,11).getTime()/1000),'22:11');
  for(const value of [undefined,null,NaN,Infinity,-1,8.64e12+1])assert.equal(chatClock(value),'—');
  assert.notEqual(chatClock(0),'—');
});
test('local date grouping handles epoch, unknown times, midnight, years and prepend', () => {
  const now=new Date(2026,9,5).getTime();
  const t=new Date(2026,9,5,23,59).getTime()/1000;
  const messages=[{key:'u',role:'user',seconds:t},{key:'unknown',role:'assistant'},{key:'a',role:'assistant',seconds:t+30},{key:'b',role:'user',seconds:t+60}];
  assert.deepEqual([...chatDateSeparators(messages,now)],[['u','October 5'],['b','October 6']]);
  const prepended=[{key:'older',role:'user',seconds:t-60},...messages];
  assert.deepEqual([...chatDateSeparators(prepended,now)],[['older','October 5'],['b','October 6']]);
  assert.equal(chatDate(new Date(2025,9,5).getTime()/1000,now),'October 5, 2025');
  assert.equal(chatDate(undefined,now),undefined);assert.ok(chatDate(0,now));
});
