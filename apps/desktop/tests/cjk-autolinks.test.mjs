// Bare URLs followed by CJK punctuation, e.g. `登录 https://my.telegram.org，进入 API`.
// GFM links run until whitespace, so the comma and the Chinese words became part of the link.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const bundle = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname, loader: 'tsx', contents: `
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageContent } from './src/renderer/message-content';
export const render = (props) => renderToStaticMarkup(createElement(MessageContent, props));
` }, bundle: true, external: ['react', 'react/jsx-runtime', 'react-dom/server'], format: 'cjs', platform: 'node', write: false });
const out = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, out, out.exports);
const { render } = out.exports;
const links = html => [...html.matchAll(/<a href="([^"]*)"[^>]*>(.*?)<\/a>/g)].map(match => [match[1], match[2]]);

const cases = [
  ['用新号登录 https://my.telegram.org，进入 API development tools', [['https://my.telegram.org/', 'https://my.telegram.org']], '</a>，进入 API'],
  ['见 https://example.com/docs/a?b=1。然后', [['https://example.com/docs/a?b=1', 'https://example.com/docs/a?b=1']], '</a>。然后'],
  ['打开（https://example.com/x）看', [['https://example.com/x', 'https://example.com/x']], '</a>）看'],
  ['网址 https://example.com/x.，后面', [['https://example.com/x', 'https://example.com/x']], '</a>.，后面'],
  ['访问 www.example.com、然后', [['http://www.example.com/', 'www.example.com']], '</a>、然后'],
  ['打开 https://my.telegram.org进入', [['https://my.telegram.org/', 'https://my.telegram.org']], '</a>进入'],
  ['本地 http://localhost:3000，然后', [['http://localhost:3000/', 'http://localhost:3000']], '</a>，然后'],
];

for (const [name, props] of [['chat message', {}], ['direct reply', { lines: true }], ['Markdown file', { document: true }]]) {
  test(`${name}: bare links end at CJK punctuation`, () => {
    for (const [text, expected, after] of cases) {
      const html = render({ text, ...props });
      assert.deepEqual(links(html), expected, text);
      assert.ok(html.includes(after), `${text}\n${html}`);
    }
  });
}

test('Chinese paths, ASCII links and explicit links stay unchanged', () => {
  assert.deepEqual(links(render({ text: '见 https://zh.wikipedia.org/wiki/中文 页面' })), [['https://zh.wikipedia.org/wiki/%E4%B8%AD%E6%96%87', 'https://zh.wikipedia.org/wiki/中文']]);
  assert.deepEqual(links(render({ text: 'See https://example.com/a_b?c=1, then.' })), [['https://example.com/a_b?c=1', 'https://example.com/a_b?c=1']]);
  assert.deepEqual(links(render({ text: '[说明](https://example.com/x，y) 和 <https://example.com/a，b>' })).map(([, label]) => label), ['说明', 'https://example.com/a，b']);
  assert.deepEqual(links(render({ text: '`https://example.com，x`' })), []);
});
