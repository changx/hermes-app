import test from 'node:test';
import assert from 'node:assert/strict';
import { channelPatch, threadPatch } from '../src/channel-edits.ts';
test('channel edit permits clearing description and preserves meaningful multiline content', () => {
  assert.deepEqual(channelPatch(' 项目 ', ' '), {name: '项目', description: ''});
  assert.deepEqual(channelPatch('项目', ' a\nb '), {name: '项目', description: 'a\nb'});
});
test('invalid channel and thread titles are rejected before API writes', () => {
  for (const value of ['', '  ', 'x'.repeat(201)]) {
    assert.throws(() => channelPatch(value, ''));
    assert.throws(() => threadPatch(value));
  }
  assert.deepEqual(threadPatch(' 第一个话题 '), {title: '第一个话题'});
  assert.deepEqual(Object.keys(threadPatch('name')), ['title']);
});
