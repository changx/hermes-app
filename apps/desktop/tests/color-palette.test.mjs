import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
const rgb = hex => `rgb(${hex.match(/\w\w/g).map(x => parseInt(x, 16)).join(', ')})`;
const mobile = name => readFile(new URL(`../../mobile/src/${name}`, import.meta.url), 'utf8');

test('Chromium: production screens resolve neutral chrome and mobile content colors at all widths', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const bundle = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname, loader: 'tsx', contents: `
    import { createElement } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { DesktopShellView } from './src/renderer/shell';
    import { NewSessionPage } from './src/renderer/new-session-page';
    const snapshot = { revision: 1, phase: 'connected', connectionState: 'online', channels: [{id:'a',name:'Example'}], threads:[{id:'t',channelId:'a',title:'Palette preview',running:true,lastMessageAt:Date.now()/1000}], selectedChannelId:'a',selectedThreadId:'t',interactions:[],canLoadOlder:false,errorMessage:'Example error',messages:[
      {id:'u',role:'user',text:'A user message',toolCalls:[],attachments:[]},
      {id:'a',role:'assistant',displayKind:'direct',text:${JSON.stringify('[A link](https://example.com) and inline `code`.\n\n| Name | Value |\n| --- | --- |\n| Example | Light theme |\n\n```text\nExample code\n```')},toolCalls:[{id:'cmd',name:'terminal',label:'Run command',detail:'git status --short'}],attachments:[]},
      {id:'f',role:'assistant',displayKind:'final',text:'Final reply',toolCalls:[],attachments:[]}
    ]};
    export const shell = renderToStaticMarkup(createElement(DesktopShellView,{snapshot}));
    export const pairing = renderToStaticMarkup(createElement(DesktopShellView,{snapshot:{...snapshot,phase:'unpaired'}}));
    export const dialog = renderToStaticMarkup(createElement(NewSessionPage,{snapshot}));
    export const workspace = renderToStaticMarkup(createElement(DesktopShellView,{snapshot,viewRole:'workspace'}));
  ` }, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/jsx-runtime', 'react-dom/server'], write: false });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports);
  const folder = await mkdtemp(join(tmpdir(), 'desktop-palette-'));
  try {
    const file = join(folder, 'preview.html');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="root">${mod.exports.shell}</div><div hidden>${mod.exports.pairing}${mod.exports.dialog}${mod.exports.workspace}</div><pre id="results" hidden></pre><script>
      const cases = [];
      const style = (selector, property) => { const element = document.querySelector(selector); return element ? getComputedStyle(element)[property] : 'MISSING'; };
      for (const width of [720,1280,1800]) {
        document.documentElement.style.width = width+'px';document.body.style.width = width+'px';document.querySelector('.session-tab-page').style.width = width+'px';
        const checks = [
          ['body','color','1f2937'],['.desktop-tabs','backgroundColor','f3f4f6'],['.native-sidebar','backgroundColor','f3f4f6'],['.session-tab-page','backgroundColor','f9fafb'],
          ['.tree-thread.selected','backgroundColor','e6edf7'],['.conversation-header','borderBottomColor','e5e7eb'],['.message-user','backgroundColor','f3f3f3'],['.message-final','backgroundColor','f7f5ef'],['.message-assistant','color','172a40'],
          ['.message a','color','215ca7'],['.message code','backgroundColor','dce5f0'],['.code-block','backgroundColor','e8eef6'],['.code-block code','color','20314a'],['.tool-command','backgroundColor','e8eef6'],['.tool-command','color','20314a'],['.message-markdown th','backgroundColor','e5ecf5'],
          ['.composer textarea','backgroundColor','ffffff'],['.composer textarea','color','172a40'],['.composer-row > button:last-child','backgroundColor','285ea5'],['.composer-row .attach-button','backgroundColor','e7eef7'],['.running-row .stop-button','color','425874'],
          ['.error-banner','backgroundColor','fff0f2'],['.error-banner','color','9d1b32'],['.thread-status','color','237a35'],
          ['.pairing-card','backgroundColor','ffffff'],['.connection-screen','backgroundColor','f9fafb'],['.pairing-actions button','backgroundColor','2960ad'],['.pairing-card input','borderTopColor','d1d5db'],
          ['.new-chat-page','backgroundColor','f9fafb'],['.new-chat-form textarea','color','1f2937'],['.new-chat-send','backgroundColor','294e7b']
        ];
        cases.push({width,colors:checks.map(([selector,property,expected])=>({selector,property,expected,actual:style(selector,property)})),scheme:style('html','colorScheme')});
      }
      document.getElementById('results').textContent=JSON.stringify(cases);
    </script></body></html>`;
    await writeFile(file, html);
    const args = ['--headless', '--no-sandbox', '--disable-gpu', '--force-dark-mode', `--user-data-dir=${join(folder, 'profile')}`, '--dump-dom', pathToFileURL(file).href];
    const dom = execFileSync(process.env.HERMES_TEST_CHROME, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 2_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const results = JSON.parse(/<pre id="results" hidden="">(.*?)<\/pre>/.exec(dom)?.[1] ?? 'null');
    assert.ok(results, 'browser completed computed-style checks');
    for (const row of results) {
      assert.equal(row.scheme, 'light');
      for (const value of row.colors) assert.equal(value.actual, rgb(value.expected), `${row.width} ${value.selector} ${value.property}`);
    }
    if (process.env.HERMES_PALETTE_EVIDENCE) {
      await mkdir(process.env.HERMES_PALETTE_EVIDENCE, { recursive: true });
      await writeFile(join(process.env.HERMES_PALETTE_EVIDENCE, 'computed-colors.json'), JSON.stringify(results, null, 2)+'\n');
      await writeFile(join(process.env.HERMES_PALETTE_EVIDENCE, 'preview.html'), html);
      execFileSync(process.env.HERMES_TEST_CHROME, ['--headless','--no-sandbox','--disable-gpu',`--user-data-dir=${join(folder,'screenshot-profile')}`,'--window-size=1280,900',`--screenshot=${join(process.env.HERMES_PALETTE_EVIDENCE,'preview.png')}`,pathToFileURL(file).href], { timeout:30000, stdio:'pipe' });
    }
  } finally { await rm(folder, { recursive: true, force: true }); }
});
