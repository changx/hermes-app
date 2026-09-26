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

test('HTML stays inert and image sources pass the same web URL gate', () => {
  const result = parseMessageMarkdown('<script>alert(1)</script>\n\n![cat](https://private.example/image.png)');
  assert.equal(result[0].children.map(n => n.text || '').join(''), '<script>alert(1)</script>');
  assert.deepEqual(result[1].children, [{ kind: 'image', text: 'cat', src: 'https://private.example/image.png' }]);
  assert.deepEqual(parseMessageMarkdown('![bad](https://u:p@example.com/i.png)')[0].children,
    [{ kind: 'image', text: 'bad', src: null }]);
});

test('explicit web links are clickable only when sanitized; unsafe syntax stays inert', () => {
  const nodes = parseMessageMarkdown('[safe](https://example.com/a?q=1) [bad](javascript:alert%281%29) [file](file:///x) [auth](https://u:p@example.com)')[0].children;
  assert.deepEqual(nodes.filter(n => n.kind === 'link').map(n => n.href), ['https://example.com/a?q=1', null]);
  assert.equal(nodes.filter(n => n.kind === 'link')[1].children[0].text, 'auth');
  for (const unsafe of [
    'javascript:alert(1)', 'JaVaScRiPt://example.com', 'data:text/html,hi', 'file:///etc/passwd',
    'https://u:p@example.com', 'https://u@example.com', 'https://example.com\\@evil.example',
    'https://example.com\n.evil', 'https://example.com/ x', 'http://', 'https://example.com:99999',
    'mailto:a@example.com', '//example.com', 'https://example.com/\u0085bad',
    'https://example.com/\u202Ebad', 'https://example.com/\tbad',
  ]) assert.equal(safeLinkUrl(unsafe), null, unsafe);
  assert.equal(safeLinkUrl('HTTP://EXAMPLE.COM/a'), 'http://example.com/a');
});

test('all heading levels, nested formatting, strike, thematic rules, escapes and entities', () => {
  const parsed = parseMessageMarkdown(Array.from({ length: 6 }, (_, i) => `${'#'.repeat(i + 1)} level ${i + 1}`).join('\n\n') +
    '\n\n***\n\n**bold *em ~~gone~~*** &amp; \\*escaped\\*');
  assert.deepEqual(parsed.slice(0, 6).map(n => n.level), [1, 2, 3, 4, 5, 6]);
  assert.equal(parsed[6].kind, 'rule');
  assert.equal(parsed[7].children[0].kind, 'strong');
  assert.equal(parsed[7].children[0].children[1].kind, 'em');
  assert.equal(parsed[7].children[0].children[1].children[1].kind, 'strike');
  assert.equal(parsed[7].children.at(-1).text, ' & *escaped*');
});

test('reference links, autolinks and bare web URLs stay clickable only when safe', () => {
  const nodes = parseMessageMarkdown('[ref][id] <https://example.org/a> https://example.com/b www.example.net [bad](https://u@example.com)\n\n[id]: https://example.org/ref')[0].children;
  assert.deepEqual(nodes.filter(n => n.kind === 'link').map(n => n.href), [
    'https://example.org/ref', 'https://example.org/a', 'https://example.com/b', 'http://www.example.net/', null,
  ]);
  assert.equal(parseMessageMarkdown('<user@example.com>')[0].children[0].href, null);
});

test('table retains escaped pipes, empty cells, alignment, inline contents and image', () => {
  const [table] = parseMessageMarkdown('| a\\|b | | **bold** [url](https://a.test) |\n|:--|--:|:-:|\n| x | | ![alt](https://a.test/i.png) |');
  assert.equal(table.kind, 'table');
  assert.deepEqual(table.header.map(c => c.align), ['left', 'right', 'center']);
  assert.equal(table.header[0].children[0].text, 'a|b');
  assert.deepEqual(table.header[1].children, []);
  assert.equal(table.header[2].children[0].kind, 'strong');
  assert.equal(table.header[2].children[2].href, 'https://a.test/');
  assert.deepEqual(table.rows[0][1].children, []);
  assert.deepEqual(table.rows[0][2].children, [{ kind: 'image', text: 'alt', src: 'https://a.test/i.png' }]);
});

test('task list checkbox applies only to genuine list-item prefixes, including nested items', () => {
  const [paragraph, list] = parseMessageMarkdown('[x] ordinary\n\n- [x] done\n  - [ ] child\n  - \\[x] escaped\n- regular [x] inside\n- &#91;x] entity');
  assert.equal(paragraph.children[0].text, '[x] ordinary');
  assert.deepEqual(list.checks, [true, null, null]);
  assert.equal(list.items[0][0].children[0].text, 'done');
  assert.deepEqual(list.items[0][1].checks, [false, null]);
  assert.equal(list.items[0][1].items[1][0].children[0].text, '[x] escaped');
  assert.equal(list.items[1][0].children[0].text, 'regular [x] inside');
  assert.equal(list.items[2][0].children[0].text, '[x] entity');
});

test('long unbroken text and many incremental parses remain intact', () => {
  const long = 'x'.repeat(10000);
  assert.equal(parseMessageMarkdown(long)[0].children[0].text, long);
  for (const input of ['#', '>', '- item\n  -', '```', '```js\n', '[link](', '**unfinished']) {
    assert.doesNotThrow(() => parseMessageMarkdown(input), input);
  }
});
