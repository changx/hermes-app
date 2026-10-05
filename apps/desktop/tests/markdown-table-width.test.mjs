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
for (const surface of ['session','standalone','user-bubble']) test(`Chromium: desktop ${surface} tables obey parent content widths and resize`, { skip:!process.env.HERMES_TEST_CHROME }, async () => {
  await checkTableLayout(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><main style="display:grid;grid-template-columns:minmax(0,1fr)"><article class="${surface==='session' ? 'message message-final' : surface==='user-bubble' ? 'message message-user' : ''}" style="min-width:0;padding:12px">${html}</article></main></body></html>`,'.markdown-table',surface==='user-bubble'?[320,390,480,768,1024,320]:undefined);
});
