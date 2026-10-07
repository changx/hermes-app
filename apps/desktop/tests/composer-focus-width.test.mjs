import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const root = new URL('..', import.meta.url).pathname;

test('composerEnterAction: single line Enter sends, multiline needs Cmd/Ctrl+Enter, Shift+Enter adds a line', async () => {
  const output = await build({ stdin: { resolveDir: root, loader: 'ts', contents: `export { composerEnterAction } from './src/renderer/shell';` }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react', 'react-dom', 'react/jsx-runtime'], loader: { '.woff2': 'empty', '.woff': 'empty', '.ttf': 'empty', '.css': 'empty' } });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(require, mod, mod.exports);
  const { composerEnterAction: action } = mod.exports;
  const keys = (extra = {}) => ({ shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...extra });
  assert.equal(action('hello', keys()), 'send');
  assert.equal(action('', keys()), 'send');
  assert.equal(action('hello', keys({ shiftKey: true })), 'newline');
  assert.equal(action('hello', keys({ metaKey: true })), 'send');
  assert.equal(action('line 1\nline 2', keys()), 'newline');
  assert.equal(action('line 1\n', keys()), 'newline');
  assert.equal(action('line 1\nline 2', keys({ metaKey: true })), 'send');
  assert.equal(action('line 1\nline 2', keys({ ctrlKey: true })), 'send');
  assert.equal(action('line 1\nline 2', keys({ shiftKey: true, metaKey: true })), 'newline');
  assert.equal(action('hello', keys({ altKey: true })), 'newline');
});

test('Chromium: session page focuses the composer, keeps focus after send, applies Enter rules and a 768px column', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { flushSync } from 'react-dom';
    import { DesktopShellView } from './src/renderer/shell';
    const sent=[],checks=[];let pending;
    const ensure=(name,value)=>{if(!value)throw Error(name);checks.push(name);};
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    window.hermesDesktop={sendMessage:input=>{sent.push(input.text);return new Promise(r=>{pending=r;});},loadOlder:async()=>{},markResultRead:async()=>{},getRuntimeInfo:()=>({viewRole:'tab'})};
    const long='A long assistant reply that should wrap inside the content column. '.repeat(40);
    const base={revision:1,phase:'connected',connectionState:'online',channels:[{id:'p',name:'Project'}],threads:[{id:'t',channelId:'p',title:'Example',running:false},{id:'u',channelId:'p',title:'Other',running:false}],
      selectedChannelId:'p',selectedThreadId:'t',selectedThreadTitle:'Example',messages:[{id:'m1',role:'user',text:'Question',toolCalls:[],attachments:[]},{id:'m2',role:'assistant',text:long,toolCalls:[],attachments:[]}],interactions:[],canLoadOlder:false,tabKind:'session'};
    const root=createRoot(document.getElementById('root'));
    const render=snapshot=>flushSync(()=>root.render(<DesktopShellView viewRole="tab" snapshot={snapshot}/>));
    const box=()=>document.querySelector('textarea[aria-label="Message"]');
    const type=value=>{const el=box();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));};
    const enter=(extra={})=>{const event=new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true,...extra});box().dispatchEvent(event);return event;};
    (async()=>{try {
      // A hidden tab never takes focus.
      render({...base,tabActive:false});await wait(20);
      ensure('hidden tab does not focus',document.activeElement!==box());
      render({...base,tabActive:true});await wait(20);
      ensure('entering session focuses composer',document.activeElement===box());
      box().blur();render({...base,selectedThreadId:'u',selectedThreadTitle:'Other',tabActive:true});await wait(20);
      ensure('switching session focuses composer',document.activeElement===box());
      render({...base,tabActive:true});await wait(20);

      const sendColor=()=>getComputedStyle(document.querySelector('.composer-toolbar .send-button')).backgroundColor;
      ensure('empty draft send is gray',sendColor()==='rgb(215, 215, 217)');
      type('hello');await wait(10);
      ensure('ready send is black',sendColor()==='rgb(31, 35, 41)');
      let event=enter({shiftKey:true});
      ensure('shift enter adds a line',!event.defaultPrevented&&sent.length===0);
      event=enter({isComposing:true});
      ensure('IME composition never sends',!event.defaultPrevented&&sent.length===0);
      event=enter();
      ensure('single line enter sends',event.defaultPrevented&&sent.length===1&&sent[0]==='hello');
      await wait(10);ensure('composer disabled during send',box().disabled);
      pending();await wait(30);
      ensure('cleared after send',box().value==='');
      ensure('focus kept after enter send',document.activeElement===box()&&!box().disabled);

      type('line 1\\nline 2');await wait(10);
      event=enter();
      ensure('multiline enter does not send',!event.defaultPrevented&&sent.length===1);
      event=enter({metaKey:true});
      ensure('multiline cmd enter sends',event.defaultPrevented&&sent.length===2&&sent[1]==='line 1\\nline 2');
      pending();await wait(30);
      ensure('focus kept after cmd enter send',document.activeElement===box());
      type('ctrl');await wait(10);event=enter({ctrlKey:true});
      ensure('ctrl enter sends',event.defaultPrevented&&sent.length===3);pending();await wait(30);

      const widths={};
      for(const width of [700,1000,1600]) {
        document.getElementById('root').style.width=width+'px';await wait(20);
        const page=document.querySelector('.session-tab-page').getBoundingClientRect();
        const column=document.querySelector('.timeline-content').getBoundingClientRect();
        const row=document.querySelector('.composer-box').getBoundingClientRect();
        const list=document.querySelector('.message-list').getBoundingClientRect();
        const expected=Math.min(768,document.querySelector('.message-list').clientWidth);
        widths[width]={column:column.width,composer:row.width};
        ensure('content max 768 '+width,Math.abs(column.width-expected)<=1);
        ensure('content centered '+width,Math.abs((column.left-list.left)-(list.left+document.querySelector('.message-list').clientWidth-column.right))<=1);
        ensure('composer max 768 '+width,row.width<=768.5&&Math.abs((row.left+row.right)/2-(page.left+page.right)/2)<=1);
        ensure('scroll area keeps full width '+width,Math.abs(list.width-page.width)<=1);
        const user=document.querySelector('.message-user').getBoundingClientRect();
        ensure('user bubble inside column '+width,user.right<=column.right+0.5&&user.left>=column.left-0.5);
      }
      ensure('wide window caps at 768',Math.abs(widths[1600].column-768)<=1&&Math.abs(widths[1600].composer-768)<=1);
      document.getElementById('results').textContent=JSON.stringify({ok:true,checks:checks.length,widths});
    } catch(error) {document.getElementById('results').textContent=JSON.stringify({ok:false,error:String(error&&error.stack||error)});}})();
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false, loader: { '.woff2': 'empty', '.woff': 'empty', '.ttf': 'empty' } });
  const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
  const folder = await mkdtemp(join(tmpdir(), 'composer-focus-'));
  try {
    const file = join(folder, 'check.html');
    await writeFile(file, `<!doctype html><style>${css} #root{height:800px}</style><div id="root"></div><pre id="results"></pre><script>${bundle.outputFiles[0].text}</script>`);
    const dom = execFileSync(process.env.HERMES_TEST_CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=5000', '--window-size=2000,1000', '--dump-dom', `--user-data-dir=${join(folder, 'profile')}`, pathToFileURL(file).href], { encoding: 'utf8', timeout: 60000, maxBuffer: 20_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const result = JSON.parse(/<pre id="results">(.*?)<\/pre>/s.exec(dom)?.[1] ?? 'null');
    assert.equal(result?.ok, true, result?.error ?? 'Missing browser results');
    console.log('COMPOSER_FOCUS_WIDTH ' + JSON.stringify(result));
    assert.ok(result.checks >= 25);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
