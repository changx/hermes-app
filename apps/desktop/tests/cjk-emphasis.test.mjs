// Bold that ends in CJK punctuation directly before CJK text, e.g.
// `**每笔收汇都有记录：**国际收支`. Plain CommonMark leaves the `**` as text;
// remark-cjk-friendly closes it. Mobile has the same rule (apps/mobile/src/messageMarkdown.ts).
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

const reply = [
  '**每笔收汇都有记录：**国际收支申报数据由外汇局掌握。',
  '**可能被限制出境：**欠税人或法定代表人可以被阻止出境（第 44 条）。',
  '**信用影响：** 情节严重的会列入名单。',
].join('\n');

for (const [name, props] of [['chat message', {}], ['direct reply', { lines: true }], ['Markdown file', { document: true }]]) {
  test(`${name}: bold closes after CJK punctuation before CJK text`, () => {
    const html = render({ text: reply, ...props });
    assert.match(html, /<strong>每笔收汇都有记录：<\/strong>国际收支/);
    assert.match(html, /<strong>可能被限制出境：<\/strong>欠税人/);
    assert.match(html, /<strong>信用影响：<\/strong> 情节/);
    assert.doesNotMatch(html, /\*\*/);
  });
}

test('Latin emphasis keeps the standard rules', () => {
  const html = render({ text: '**bold** and snake_case_name and 2 * 3 * 4' });
  assert.match(html, /<strong>bold<\/strong> and snake_case_name and 2 \* 3 \* 4/);
});
