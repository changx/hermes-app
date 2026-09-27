import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMessageMarkdown, safeLinkUrl, messageNeedsViewport } from '../src/messageMarkdown.ts';

test('CJK punctuation bold renders around a table without losing surrounding content', () => {
  const source = '先说结论：**中文结论。**所以继续。\n\n| 产品 | 收入 | 渠道 |\n|---|---|---|\n| **甲** | 未公开 | **无法确认。**(来源) |\n| 乙 | 订阅 | 官网 |\n| 丙 | 积分 | 分享 |\n\n**粗略判断：**仍需验证。';
  const blocks = parseMessageMarkdown(source);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].children[1].kind, 'strong');
  assert.equal(blocks[0].children[1].children[0].text, '中文结论。');
  assert.equal(blocks[0].children[2].text, '所以继续。');
  assert.equal(blocks[1].header.length, 3);
  assert.equal(blocks[1].rows.length, 3);
  assert.equal(blocks[2].children[0].kind, 'strong');
  assert.equal(blocks[2].children.at(-1).text, '仍需验证。');
  const nested = parseMessageMarkdown('前**（中文 *嵌套*。）**后')[0].children[1];
  assert.equal(nested.kind, 'strong');
  assert.ok(nested.children.some(n => n.kind === 'em'));
  assert.equal(parseMessageMarkdown('** bold **')[0].children[0].text, '** bold **');
  assert.equal(parseMessageMarkdown(String.raw`\*\*中文。\*\*后`)[0].children[0].text, '**中文。**后');
  assert.equal(parseMessageMarkdown('`**中文。**后`')[0].children[0].kind, 'code');
  assert.equal(parseMessageMarkdown('```text\n**中文。**后\n```')[0].text, '**中文。**后\n');
});

test('normal prose stays intrinsic while nested native viewports get usable width', () => {
  for (const text of ['好', '**hello**', '# 标题', '> 引用', '- 简短列表', '[link](https://example.com)', '`inline code`']) assert.equal(messageNeedsViewport(text), false, text);
  for (const text of ['```mermaid\nflowchart TD\nA-->B\n```', '```js\nx\n```', '|a|b|\n|-|-|\n|1|2|', '$$x$$', '![img](https://example.com/a.png)', '> $x$', '- ![v](https://example.com/a.mp4)']) assert.equal(messageNeedsViewport(text), true, text);
});

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

test('video URLs, strict HTML video and media safety keep text around inline clips', () => {
  const [line, html] = parseMessageMarkdown('before ![clip](https://example.com/a.MP4?q=1) after\n\n<video src="https://example.com/b.webm" controls></video>');
  assert.deepEqual(line.children.map(x => x.kind), ['text', 'video', 'text']);
  assert.equal(line.children[1].src, 'https://example.com/a.MP4?q=1');
  assert.deepEqual(line.children.filter(x => x.kind === 'text').map(x => x.text), ['before ', ' after']);
  assert.equal(html.kind, 'video');
  assert.equal(html.src, 'https://example.com/b.webm');
  assert.equal(html.text, 'Video');
  assert.equal(parseMessageMarkdown('<video src="https://u@example.com/b.mp4" controls></video>')[0].kind, 'paragraph');
  assert.equal(parseMessageMarkdown('<video src="https://example.com/b.mp4" autoplay></video>')[0].kind, 'paragraph');
  assert.equal(parseMessageMarkdown('![bad](https://u@example.com/b.mp4)')[0].children[0].src, null);
  assert.equal(parseMessageMarkdown(`![long](https://example.com/${'x'.repeat(2100)}.mp4)`)[0].children[0].src, null);
});

test('math delimiters preserve trailing prose, escapes, currency and code; Mermaid only in fence', () => {
  const parsed = parseMessageMarkdown('$$x^2$$ after **bold**\n\n$$\na+b\n$$ and more\n\nstart $a+b$ end\\n\\$5 and $10 `x $z$`');
  assert.deepEqual(parsed.slice(0, 4).map(x => x.kind), ['math', 'paragraph', 'math', 'paragraph']);
  assert.equal(parsed[0].text, 'x^2');
  assert.equal(parsed[1].children[0].text, 'after ');
  assert.equal(parsed[1].children[1].kind, 'strong');
  assert.equal(parsed[2].text, 'a+b');
  assert.equal(parsed[3].children[0].text, 'and more');
  assert.deepEqual(parsed[4].children.map(x => x.kind), ['text', 'math', 'text', 'code']);
  assert.equal(parsed[4].children[1].text, 'a+b');
  assert.equal(parseMessageMarkdown('$$unterminated')[0].kind, 'paragraph');
  assert.equal(parseMessageMarkdown('```mermaid\ngraph LR\nA-->B\n```')[0].kind, 'diagram');
  assert.equal(parseMessageMarkdown('```js\n$z$\n```')[0].kind, 'code');
});


test('long unbroken text and many incremental parses remain intact', () => {
  const long = 'x'.repeat(10000);
  assert.equal(parseMessageMarkdown(long)[0].children[0].text, long);
  for (const input of ['#', '>', '- item\n  -', '```', '```js\n', '[link](', '**unfinished']) {
    assert.doesNotThrow(() => parseMessageMarkdown(input), input);
  }
});
