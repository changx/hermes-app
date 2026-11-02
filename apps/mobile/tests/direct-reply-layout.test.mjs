// Direct (native command) replies: one paragraph per line. See docs/direct-reply-layout.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMessageMarkdown } from '../src/messageMarkdown.ts';

// Shape of the real Hermes `/commands` reply: single `\n` between entries.
const commands = [
  '📚 **Commands** (204 total, page 1/11)',
  '',
  '`/start` -- Acknowledge platform start pings without a reply',
  '`/new [name]` -- Start a new session (alias: `/reset`)',
  '`/pause [reason | off]` -- Pause new work globally',
  '',
  'next → `/commands 2`',
].join('\n');

test('a direct reply parses each line as its own paragraph', () => {
  const blocks = parseMessageMarkdown(commands, { lines: true });
  assert.equal(blocks.length, 5);
  assert.ok(blocks.every(block => block.kind === 'paragraph'));
  assert.ok(blocks.every(block => !block.children.some(node => node.kind === 'break')));
  assert.deepEqual(blocks[1].children, [{ kind: 'code', text: '/start' }, { kind: 'text', text: ' -- Acknowledge platform start pings without a reply' }]);
  assert.deepEqual(blocks[3].children[0], { kind: 'code', text: '/pause [reason | off]' });
});

test('ordinary messages keep line breaks inside one paragraph', () => {
  const blocks = parseMessageMarkdown(commands);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[1].children.filter(node => node.kind === 'break').length, 2);
});

test('direct replies keep code blocks and lists intact', () => {
  const blocks = parseMessageMarkdown('a\nb\n\n```\none\ntwo\n```\n\n- x\n- y', { lines: true });
  assert.deepEqual(blocks.map(block => block.kind), ['paragraph', 'paragraph', 'code', 'list']);
  assert.equal(blocks[2].text, 'one\ntwo\n');
});
