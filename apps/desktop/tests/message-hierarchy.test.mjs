import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const bundle = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname, loader: 'tsx', contents: `
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DesktopShellView } from './src/renderer/shell';
const tool = (id, name, label, detail) => ({ id, name, label, detail });
const msg = (id, text, toolCalls = [], extra = {}) => ({ id, role: 'assistant', text, toolCalls, attachments: [], ...extra });
export const html = renderToStaticMarkup(createElement(DesktopShellView, { snapshot: {
 revision: 1, phase: 'connected', selectedThreadId: 'test-thread', connectionState: 'online', connectionLabel: 'Connected', channels: [], threads: [], interactions: [], canLoadOlder: false,
 messages: [msg('a','Checking'), msg('b','',[tool('read','read_file','Read file','src/file.ts · offset=10')]), msg('c','',[tool('cmd','terminal','Run command','git status --short')]), msg('d','Result'), msg('e','Direct reply',[],{displayKind:'direct'}), msg('f','Next', [tool('legacy',undefined,'Unknown action','Safe detail')])]
}}));` }, bundle: true, external: ['react', 'react/jsx-runtime', 'react-dom/server'], format: 'cjs', platform: 'node', write: false });
const out = { exports: {} };
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url), out, out.exports);
const html = out.exports.html;
test('tools are compact visible action records, not collapsed cards or success claims', () => {
 assert.match(html, /📖/); assert.match(html, /💻/); assert.match(html, /⚙️/);
 assert.match(html, /src\/file.ts · offset=10/);
 assert.match(html, /Reading file.ts L10/);
 assert.match(html, /<pre class="tool-command">git status --short<\/pre>/);
 assert.doesNotMatch(html, /<details|<summary|✅/);
 assert.ok(html.indexOf('Checking') < html.indexOf('Reading'));
 assert.ok(html.indexOf('terminal') < html.indexOf('Result'));
});
test('only continuous assistant records share a byline; direct replies break grouping', () => {
 assert.equal((html.match(/class="message-role"/g) || []).length, 3);
 assert.equal((html.match(/message-continuation/g) || []).length, 3);
 assert.equal((html.match(/message-tools-only/g) || []).length, 2);
 assert.match(html, /Safe detail/);
 assert.doesNotMatch(html, /message-final/);
});
