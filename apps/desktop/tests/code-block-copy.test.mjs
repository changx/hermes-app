import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const python = 'def total(items):\n    return sum(i * 2 for i in items)  # ' + 'x'.repeat(200);
const text = [
  'Run `npm test` first. See [`docs/a.md`](https://example.com/a).',
  '', '```python', python, '```',
  '', '```bash', 'npm run desktop:check', '```',
  '', '```', 'plain one line with  two spaces', '```',
  '', '    indented line',
  '', '```mermaid', 'graph TD; A-->B', '```',
].join('\n');

test('Chromium: code copies — multi-line blocks have a corner button; one-line blocks, inline code and tool commands copy on click', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'code-block-copy-'));
  try {
    const bundle = await build({ stdin: { resolveDir: new URL('../../../', import.meta.url).pathname, loader: 'tsx', contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import {DesktopShellView} from './apps/desktop/src/renderer/shell';
      const calls=[];const web=[];
      const tick=()=>new Promise(r=>setTimeout(r,0));
      const out={};
      window.onerror=(m)=>{out.error=String(m);document.getElementById('results').textContent=JSON.stringify(out);};
      window.hermesDesktop={getRuntimeInfo:()=>({platform:'linux',versions:{}}),getSnapshot:async()=>({}),copyText:async t=>{calls.push(t);}};
      const messages=[{id:'a',role:'assistant',displayKind:'final',text:${JSON.stringify(text)},attachments:[],
        toolCalls:[{id:'c',name:'terminal',label:'Run command',detail:'git status --short'}]}];
      const snapshot={revision:1,phase:'connected',connectionState:'online',channels:[{id:'p',name:'P'}],threads:[{id:'t',channelId:'p',title:'T'}],selectedThreadId:'t',messages,interactions:[],canLoadOlder:false};
      const host=document.getElementById('root');
      flushSync(()=>createRoot(host).render(<div style={{width:'620px'}}><DesktopShellView viewRole="tab" snapshot={snapshot}/></div>));
      (async()=>{
        const frames=[...host.querySelectorAll('.code-block-frame')];
        const lines=[...host.querySelectorAll('pre.code-block-line')];
        out.frames=frames.length;out.lines=lines.length;
        out.lineButtons=lines.reduce((n,l)=>n+l.querySelectorAll('button').length,0);
        out.lineRoles=lines.map(l=>[l.getAttribute('role'),l.tabIndex,getComputedStyle(l).cursor]);
        out.inline=[...host.querySelectorAll('.message-markdown p code')].map(c=>[c.textContent,c.classList.contains('click-copy')]);
        out.mermaidCopy=host.querySelectorAll('.mermaid-diagram .click-copy, .mermaid-diagram .code-copy').length;
        // Multi-line block: the corner button stays put while the block scrolls sideways.
        const pre=frames[0].querySelector('pre');const before=frames[0].querySelector('button').getBoundingClientRect().left;
        pre.scrollLeft=200;out.scrolled=pre.scrollLeft>0;out.buttonMoved=frames[0].querySelector('button').getBoundingClientRect().left-before;
        frames[0].querySelector('button').click();await tick();
        // One-line blocks: a click anywhere in the line copies, including the empty right part.
        for(const l of lines){const b=l.getBoundingClientRect();l.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:b.right-4,clientY:b.top+b.height/2}));await tick();}
        out.lineNote=lines[0].getAttribute('data-copy-note');
        out.noteShown=getComputedStyle(lines[0],'::after').content;
        // Inline code copies on click; code inside a link does not.
        const [npm,doc]=host.querySelectorAll('.message-markdown p code');
        npm.click();await tick();doc.closest('a').addEventListener('click',e=>e.preventDefault());doc.click();await tick();
        // Keyboard: Enter on the tool command copies it.
        const command=host.querySelector('.tool-command');out.commandRole=command.getAttribute('role');
        command.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await tick();
        // Selecting part of a line and releasing the mouse does not copy.
        const node=lines[0].querySelector('code').firstChild;const range=document.createRange();range.setStart(node,0);range.setEnd(node,3);
        getSelection().removeAllRanges();getSelection().addRange(range);lines[0].click();await tick();getSelection().removeAllRanges();
        out.calls=[...calls];
        // A failed copy says so.
        window.hermesDesktop.copyText=async()=>{throw new Error('denied');};
        lines[1].click();await tick();await tick();
        out.failNote=lines[1].getAttribute('data-copy-note');
        // Markdown preview page: no app API, the web clipboard is used.
        delete window.hermesDesktop;
        Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>{web.push(t);}}});
        npm.click();await tick();
        out.web=web;
        document.getElementById('results').textContent=JSON.stringify(out);
      })().catch(e=>{out.error=String(e);document.getElementById('results').textContent=JSON.stringify(out);});
    ` }, bundle: true, minify: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
    const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    await writeFile(join(folder, 'bundle.js'), bundle.outputFiles[0].text);
    const file = join(folder, 'check.html');
    await writeFile(file, `<!doctype html><style>${css}</style><div id="root"></div><pre id="results"></pre><script src="bundle.js"></script>`);
    const dom = execFileSync(process.env.HERMES_TEST_CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=1000,900', '--virtual-time-budget=3000', `--user-data-dir=${join(folder, 'profile')}`, '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 30000, maxBuffer: 4_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const raw = /<pre id="results">(.*?)<\/pre>/s.exec(dom)?.[1];
    assert.ok(raw, 'no results');
    const r = JSON.parse(raw.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    assert.equal(r.error, undefined);
    assert.equal(r.frames, 1, 'only the multi-line block has a corner button');
    assert.equal(r.lines, 3, 'bash, plain and indented one-line blocks copy on click');
    assert.equal(r.lineButtons, 0);
    assert.deepEqual(r.lineRoles, [['button', 0, 'pointer'], ['button', 0, 'pointer'], ['button', 0, 'pointer']]);
    assert.deepEqual(r.inline, [['npm test', true], ['docs/a.md', false]], 'inline code copies; code in a link opens the link');
    assert.equal(r.mermaidCopy, 0);
    assert.ok(r.scrolled && r.buttonMoved === 0, 'corner button stays put while the block scrolls');
    assert.equal(r.lineNote, 'Copied');
    assert.equal(r.noteShown, '"Copied"');
    assert.equal(r.commandRole, 'button');
    assert.deepEqual(r.calls, [python, 'npm run desktop:check', 'plain one line with  two spaces', 'indented line', 'npm test', 'git status --short']);
    assert.equal(r.failNote, 'Could not copy.');
    assert.deepEqual(r.web, ['npm test']);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
