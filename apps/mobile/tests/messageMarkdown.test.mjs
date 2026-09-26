import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMessageMarkdown, safeLinkUrl } from '../src/messageMarkdown.ts';

test('paragraphs, heading, emphasis, inline code and line breaks become native render nodes', () => {
  assert.deepEqual(parseMessageMarkdown('# Hello\n\nA **strong** and *soft* `x < y`\nsecond line'), [
    { kind: 'heading', level: 1, children: [{ kind: 'text', text: 'Hello' }] },
    { kind: 'paragraph', level: undefined, children: [
      { kind: 'text', text: 'A ' }, { kind: 'strong', children: [{ kind: 'text', text: 'strong' }] },
      { kind: 'text', text: ' and ' }, { kind: 'em', children: [{ kind: 'text', text: 'soft' }] },
      { kind: 'text', text: ' ' }, { kind: 'code', text: 'x < y' }, { kind: 'break' },
      { kind: 'text', text: 'second line' },
    ] },
  ]);
});

test('ordered starts, nested lists, and quotes retain hierarchy rather than flattening', () => {
  const [list, quote] = parseMessageMarkdown('3. first\n   - nested\n4. second\n\n> **note**\n> next');
  assert.equal(list.kind, 'list');
  assert.equal(list.ordered, true);
  assert.equal(list.start, 3);
  assert.equal(list.items.length, 2);
  assert.deepEqual(list.items[0].map(block => block.kind), ['paragraph', 'list']);
  assert.equal(list.items[0][1].items[0][0].children[0].text, 'nested');
  assert.equal(quote.kind, 'quote');
  assert.equal(quote.children[0].children[0].kind, 'strong');
  assert.deepEqual(quote.children[0].children.at(-1), { kind: 'text', text: 'next' });
});

test('fenced and indented code are literal; incomplete streaming fence is safe', () => {
  assert.deepEqual(parseMessageMarkdown('```js\n<script>alert(1)</script>\n```\n\n    a && b'), [
    { kind: 'code', text: '<script>alert(1)</script>\n', language: 'js' },
    { kind: 'code', text: 'a && b\n', language: '' },
  ]);
  assert.deepEqual(parseMessageMarkdown('```ts\nconst x = 1;'), [
    { kind: 'code', text: 'const x = 1;', language: 'ts' },
  ]);
  assert.equal(parseMessageMarkdown('an unfinished `backtick')[0].children.map(n => n.text || '').join(''), 'an unfinished `backtick');
});

test('HTML stays inert text, remote Markdown images become labels only', () => {
  const result = parseMessageMarkdown('<script>alert(1)</script>\n\n![cat](https://private.example/image.png)');
  assert.equal(result[0].children.map(n => n.text || '').join(''), '<script>alert(1)</script>');
  assert.deepEqual(result[1].children, [{ kind: 'image', text: 'cat' }]);
  assert.equal(JSON.stringify(result).includes('private.example'), false);
});

test('explicit web links are clickable only when sanitized; unsafe syntax stays inert', () => {
  const nodes = parseMessageMarkdown('[safe](https://example.com/a?q=1) [bad](javascript:alert%281%29) [file](file:///x) [auth](https://u:p@example.com)')[0].children;
  assert.deepEqual(nodes.filter(n => n.kind === 'link').map(n => n.href), ['https://example.com/a?q=1', null]);
  assert.equal(nodes.filter(n => n.kind === 'link')[1].children[0].text, 'auth');
  for (const unsafe of [
    'javascript:alert(1)', 'JaVaScRiPt://example.com', 'data:text/html,hi', 'file:///etc/passwd',
    'https://u:p@example.com', 'https://u@example.com', 'https://example.com\\@evil.example',
    'https://example.com\n.evil', 'https://example.com/ x', 'http://', 'https://example.com:99999',
    'mailto:a@example.com', '//example.com',
  ]) assert.equal(safeLinkUrl(unsafe), null, unsafe);
  assert.equal(safeLinkUrl('HTTP://EXAMPLE.COM/a'), 'http://example.com/a');
});

test('long unbroken text and many incremental parses remain intact', () => {
  const long = 'x'.repeat(10000);
  assert.equal(parseMessageMarkdown(long)[0].children[0].text, long);
  for (const input of ['#', '>', '- item\n  -', '```', '```js\n', '[link](', '**unfinished']) {
    assert.doesNotThrow(() => parseMessageMarkdown(input), input);
  }
});
