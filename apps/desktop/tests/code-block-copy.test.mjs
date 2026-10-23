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
  'Run `npm test` first.',
  '', '```python', python, '```',
  '', '```bash', 'npm run desktop:check', '```',
  '', '```', 'plain one line with  two spaces', '```',
  '', '    indented line',
  '', '```mermaid', 'graph TD; A-->B', '```',
].join('\n');

test('Chromium: each code block has a copy button that copies its exact text and stays in the corner', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'code-block-copy-'));
  try {
    const bundle = await build({ stdin: { resolveDir: new URL('../../../', import.meta.url).pathname, loader: 'tsx', contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import {MessageContent} from './apps/desktop/src/renderer/message-content';
      const calls=[];const web=[];
      const tick=()=>new Promise(r=>setTimeout(r,0));
      const host=document.getElementById('root');const root=createRoot(host);
      const render=()=>flushSync(()=>root.render(<div className="message message-final" style={{width:'520px'}}><MessageContent text={${JSON.stringify(text)}}/></div>));
      (async()=>{
        const out={};
        // Session page: copy goes through the app API.
        window.hermesDesktop={copyText:async t=>{calls.push(t);}};
        render();
        const frames=[...host.querySelectorAll('.code-block-frame')];
        out.frames=frames.length;
        out.inlineButtons=host.querySelectorAll('p .code-copy').length;
        out.mermaidButtons=host.querySelectorAll('.mermaid-diagram .code-copy, .mermaid-diagram + .code-copy').length;
        out.labels=frames.map(f=>f.querySelector('button').getAttribute('aria-label'));
        const geometry=frame=>{const pre=frame.querySelector('pre').getBoundingClientRect(),b=frame.querySelector('button').getBoundingClientRect();
          return {top:b.top-pre.top,right:pre.right-b.right,inside:b.bottom<=pre.bottom&&b.left>=pre.left,preHeight:pre.height,button:b.height};};
        out.geometry=frames.map(geometry);
        // A one-line block: its text ends before the button starts.
        const line=frames[1].querySelector('code');const range=document.createRange();range.selectNodeContents(line);
        out.lineClear=range.getBoundingClientRect().right<=frames[1].querySelector('button').getBoundingClientRect().left;
        // Scrolling a wide block sideways does not move the button.
        const pre=frames[0].querySelector('pre');const before=frames[0].querySelector('button').getBoundingClientRect().left;
        pre.scrollLeft=200;out.scrolled=pre.scrollLeft>0;out.buttonMoved=frames[0].querySelector('button').getBoundingClientRect().left-before;
        for(const f of frames){f.querySelector('button').click();await tick();}
        out.note=frames[3].querySelector('.code-copy-note')?.textContent??'';
        out.calls=calls;
        // A failed copy says so.
        window.hermesDesktop={copyText:async()=>{throw new Error('denied');}};
        frames[0].querySelector('button').click();await tick();await tick();
        out.failNote=frames[0].querySelector('.code-copy-note')?.textContent??'';
        // Markdown preview page: no app API, the web clipboard is used.
        delete window.hermesDesktop;
        Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>{web.push(t);}}});
        frames[1].querySelector('button').click();await tick();
        out.web=web;
        document.getElementById('results').textContent=JSON.stringify(out);
      })();
    ` }, bundle: true, minify: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
    const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    await writeFile(join(folder, 'bundle.js'), bundle.outputFiles[0].text);
    const file = join(folder, 'check.html');
    await writeFile(file, `<!doctype html><style>${css}</style><div id="root"></div><pre id="results"></pre><script src="bundle.js"></script>`);
    const dom = execFileSync(process.env.HERMES_TEST_CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=1000,900', '--virtual-time-budget=3000', `--user-data-dir=${join(folder, 'profile')}`, '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 30000, maxBuffer: 4_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const raw = /<pre id="results">(.*?)<\/pre>/s.exec(dom)?.[1];
    assert.ok(raw, 'no results');
    const r = JSON.parse(raw.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    assert.equal(r.frames, 4, 'python, bash, plain and indented blocks have a frame; Mermaid does not');
    assert.equal(r.inlineButtons, 0, 'inline code has no button');
    assert.equal(r.mermaidButtons, 0, 'a diagram has no button');
    assert.deepEqual(r.labels, ['Copy code', 'Copy code', 'Copy code', 'Copy code']);
    for (const g of r.geometry) {
      assert.ok(g.inside, `button inside block: ${JSON.stringify(g)}`);
      assert.ok(Math.abs(g.top - 8) <= 1 && Math.abs(g.right - 8) <= 1, `button in top-right corner: ${JSON.stringify(g)}`);
    }
    assert.ok(r.lineClear, 'one-line text does not run under the button');
    assert.ok(r.scrolled && r.buttonMoved === 0, 'button stays put while the block scrolls');
    assert.deepEqual(r.calls, [python, 'npm run desktop:check', 'plain one line with  two spaces', 'indented line']);
    assert.equal(r.note, 'Copied');
    assert.equal(r.failNote, 'Could not copy.');
    assert.deepEqual(r.web, ['npm run desktop:check']);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
