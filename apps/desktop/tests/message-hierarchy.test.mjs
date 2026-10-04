import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const bundle = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname, loader: 'tsx', contents: `
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HierarchyRow } from './src/renderer/shell';
const tool = (id, name, label, detail) => ({ id, name, label, detail });
const msg = (id, text, toolCalls = [], extra = {}) => ({ id, role: 'assistant', text, createdAt: 1700000000, toolCalls, attachments: [], ...extra });
const snapshot = {
 revision: 1, phase: 'connected', selectedThreadId: 'test-thread', connectionState: 'online', connectionLabel: 'Connected', channels: [], threads: [], interactions: [], canLoadOlder: false,
 messages: [msg('a','Checking'), msg('b','',[tool('read','read_file','Read file','src/file.ts · offset=10')]), msg('c','',[tool('cmd','terminal','Run command','git status --short')]), msg('d','Result',[],{displayKind:'final'}), msg('e','Direct reply',[],{displayKind:'direct'}), msg('f','Next', [tool('legacy',undefined,'Unknown action','Safe detail')]), msg('g','',[{...tool('server','read_file','Read file','path=/repo/private/long/a.py · offset=1 · limit=2'),caption:'Reading a.py L1-2',icon:'📖'}])]
};
// Row presentation is tested in its explicitly expanded state. Cold folding is
// exercised separately by work-collapse and render-resource-reuse.
export const html = renderToStaticMarkup(createElement('div', null, snapshot.messages.map((message, index) => createElement(HierarchyRow, { key: message.id, message, continuation: index > 0 && !message.displayKind && !snapshot.messages[index - 1].displayKind }))));
` }, bundle: true, plugins: [{ name: 'expose-row', setup(builder) { builder.onLoad({ filter: /[\\/]shell\.tsx$/ }, async args => ({ contents: (await readFile(args.path, 'utf8')) + '\nexport const HierarchyRow = MessageRow;', loader: 'tsx' })); } }], external: ['react', 'react/jsx-runtime', 'react-dom/server'], format: 'cjs', platform: 'node', write: false });
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
test('all assistant records omit timestamps and empty headers; grouping stays unchanged', () => {
 assert.equal((html.match(/class="message-role"/g) || []).length, 0);
 assert.equal((html.match(/<time class="message-time"/g) || []).length, 0);
 assert.doesNotMatch(html, /class="message-role">(?:Hermes|You|Notice)/);
 assert.equal((html.match(/message-continuation/g) || []).length, 3);
 assert.equal((html.match(/message-tools-only/g) || []).length, 3);
 assert.match(html, /Safe detail/);
 assert.equal((html.match(/message-final/g) || []).length, 1);
 assert.match(html, /Reading a.py L1-2/);
});

test('only the explicit final row gets the enlarged gap and pale result treatment', async () => {
 const styles=await readFile(new URL('../src/renderer/styles.css',import.meta.url),'utf8');
 assert.match(styles,/\.message-final \{[^}]*margin-top: 32px;[^}]*background: #f7f5ef;/);
 assert.match(html,/<article class="message message-assistant message-final"><div class="message-markdown">/);
 assert.doesNotMatch(html,/<article class="[^"]*message-final[^"]*message-continuation/);
});
