// Bare URLs followed by CJK punctuation, e.g. `登录 https://my.telegram.org，进入 API`.
// linkify-it stops at `，` but kept `。`, `）` and glued Chinese text in the link.
// Desktop has the same rule (apps/desktop/tests/cjk-autolinks.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMessageMarkdown } from '../src/messageMarkdown.ts';

const inlineText = nodes => nodes.map(node => node.text ?? inlineText(node.children ?? [])).join('');
function links(text, options) {
  const found = [];
  const walk = nodes => { for (const node of nodes) { if (node.kind === 'link') found.push([node.href, inlineText(node.children)]); if (node.children) walk(node.children); } };
  for (const block of parseMessageMarkdown(text, options)) if (block.children) walk(block.children);
  return found;
}
const prose = text => parseMessageMarkdown(text).map(block => inlineText(block.children ?? [])).join('\n');

const cases = [
  ['用新号登录 https://my.telegram.org，进入 API development tools', [['https://my.telegram.org/', 'https://my.telegram.org']]],
  ['见 https://example.com/docs/a?b=1。然后', [['https://example.com/docs/a?b=1', 'https://example.com/docs/a?b=1']]],
  ['打开（https://example.com/x）看', [['https://example.com/x', 'https://example.com/x']]],
  ['网址 https://example.com/x.，后面', [['https://example.com/x', 'https://example.com/x']]],
  ['访问 www.example.com、然后', [['http://www.example.com/', 'www.example.com']]],
  ['打开 https://my.telegram.org进入', [['https://my.telegram.org/', 'https://my.telegram.org']]],
  ['本地 http://localhost:3000。然后', [['http://localhost:3000/', 'http://localhost:3000']]],
];

for (const [name, options] of [['chat message', {}], ['direct reply', { lines: true }]]) {
  test(`${name}: bare links end at CJK punctuation and the rest stays text`, () => {
    for (const [text, expected] of cases) {
      assert.deepEqual(links(text, options), expected, text);
      assert.equal(prose(text), text, `no text is lost: ${text}`);
    }
  });
}

test('Chinese paths, ASCII links and explicit links stay unchanged', () => {
  assert.deepEqual(links('见 https://zh.wikipedia.org/wiki/中文 页面'), [['https://zh.wikipedia.org/wiki/%E4%B8%AD%E6%96%87', 'https://zh.wikipedia.org/wiki/中文']]);
  assert.deepEqual(links('See https://example.com/a_b?c=1, then.'), [['https://example.com/a_b?c=1', 'https://example.com/a_b?c=1']]);
  assert.deepEqual(links('[说明](https://example.com/x) 和 <https://example.com/a，b>').map(([, label]) => label), ['说明', 'https://example.com/a，b']);
  assert.deepEqual(links('`https://example.com，x`'), []);
});
