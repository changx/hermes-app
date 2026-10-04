import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
test('desktop defines an explicit shared 16px text default', () => {
  assert.match(css, /--app-font-size: 16px;/);
  assert.match(css, /font-size: var\(--app-font-size\);/);
  assert.match(css, /button, input, textarea, select \{ color: inherit; font-family: inherit; font-size: inherit; \}/);
});

test('Chromium: production UI and content use 16px at narrow and wide widths', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const bundle = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname, loader: 'tsx', contents: `
    import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server';
    import { DesktopShellView } from './src/renderer/shell';
    import { NewSessionPage } from './src/renderer/new-session-page';
    const snapshot = {revision:1,phase:'connected',connectionState:'online',channels:[{id:'p',name:'Example'}],threads:[{id:'t',channelId:'p',title:'Font preview',running:true,lastMessageAt:Date.now()/1000}],selectedChannelId:'p',selectedThreadId:'t',interactions:[],canLoadOlder:false,errorMessage:'Example error',messages:[
      {id:'u',role:'user',text:'User text',toolCalls:[],attachments:[]},
      {id:'a',role:'assistant',displayKind:'direct',text:${JSON.stringify('Paragraph and `inline code`.\n\n- List text\n\n| Name | Value |\n| --- | --- |\n| Example | Text |\n\n```text\nFenced code\n```')},toolCalls:[{id:'cmd',name:'terminal',label:'Run command',detail:'git status --short'}],attachments:[]},
      {id:'f',role:'assistant',displayKind:'final',text:'Final text',toolCalls:[],attachments:[]},
      {id:'w',role:'assistant',text:'Working text',toolCalls:[],attachments:[]}]};
    export const html = renderToStaticMarkup(<DesktopShellView snapshot={snapshot}/>);
    export const extra = renderToStaticMarkup(<><DesktopShellView snapshot={{...snapshot,phase:'unpaired'}}/><DesktopShellView viewRole="workspace" snapshot={snapshot}/><NewSessionPage snapshot={snapshot}/></>);
  ` }, bundle:true, platform:'node', format:'cjs', external:['react','react/jsx-runtime','react-dom/server'], write:false });
  const mod = {exports:{}};
  new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
  const folder = await mkdtemp(join(tmpdir(),'desktop-font-'));
  try {
    const file = join(folder,'check.html');
    const selectors = ['html','body','.channel-toggle strong','.thread-title','.thread-status','.sidebar-new-chat','.conversation-header h2','.conversation-actions button','.message-user p','.message-assistant p','.message-final p','.message li','.message th','.message td','.message code','.code-block code','.tool-record','.tool-command','.work-toggle','.composer textarea','.agent-running','.error-banner','.pairing-card label','.pairing-card input','.pairing-actions button','.new-chat-project','.new-chat-form textarea','.new-chat-project select','.new-chat-actions span','.new-chat-send'];
    await writeFile(file, `<!doctype html><style>${css}</style><div id="root">${mod.exports.html}</div><div hidden>${mod.exports.extra}</div><pre id="results"></pre><script>
      const results=[];for(const width of [720,1280,1800]) {
        document.documentElement.style.width=width+'px';document.body.style.width=width+'px';
        for(const selector of ${JSON.stringify(selectors)}) {
          const node=document.querySelector(selector),style=node?getComputedStyle(node):null;
          results.push({width,selector,size:style?.fontSize??'MISSING',lineHeight:style?.lineHeight,paddingLeft:style?.paddingLeft});
        }
      }
      document.getElementById('results').textContent=JSON.stringify(results);document.currentScript.remove();
    </script>`);
    const dom = execFileSync(process.env.HERMES_TEST_CHROME,['--headless','--no-sandbox','--disable-gpu',`--user-data-dir=${join(folder,'profile')}`,'--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:30000,maxBuffer:2_000_000,stdio:['ignore','pipe','pipe']});
    const rows = JSON.parse(/<pre id="results">(.*?)<\/pre>/.exec(dom)?.[1]??'null');
    assert.equal(rows?.length,selectors.length*3);
    for(const row of rows) {
      assert.equal(row.size,'16px',`${row.width} ${row.selector}`);
      if (['.composer textarea','.tool-record'].includes(row.selector)) assert.ok(Math.abs(parseFloat(row.lineHeight)-24)<0.01, row.selector);
      if (row.selector === '.composer textarea') assert.equal(row.paddingLeft,'12px');
    }
  } finally { await rm(folder,{recursive:true,force:true}); }
});
