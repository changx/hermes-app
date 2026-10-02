import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { checkTableLayout, wideTables } from '../../../tests/markdown-table-layout.mjs';

const bundle = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname, loader:'tsx', contents:`
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageContent } from './src/renderer/message-content';
export const html = renderToStaticMarkup(createElement(MessageContent, { text:${JSON.stringify(wideTables)} }));
` }, bundle:true, external:['react','react/jsx-runtime','react-dom/server'], format:'cjs', platform:'node', write:false });
const out = { exports:{} };
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),out,out.exports);
const html = out.exports.html;
const css = await readFile(new URL('../src/renderer/styles.css',import.meta.url),'utf8');

test('every desktop table fills its container with fixed-layout wrapping columns', () => {
  assert.equal((html.match(/class="markdown-table"/g)||[]).length,6);
  assert.doesNotMatch(html, /Scrollable table/);
  assert.match(css,/\.message-markdown table \{[^}]*width: 100%;[^}]*table-layout: fixed;/);
  assert.ok(html.includes('last-column') && html.includes('After'));
});
for (const surface of ['session','standalone']) test(`Chromium: desktop ${surface} tables obey parent content widths and resize`, { skip:!process.env.HERMES_TEST_CHROME }, async () => {
  await checkTableLayout(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><main style="display:grid;grid-template-columns:minmax(0,1fr)"><article class="${surface==='session' ? 'message message-final' : ''}" style="min-width:0;padding:12px">${html}</article></main></body></html>`,'.markdown-table');
});
