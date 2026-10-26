import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';

// Mermaid diagrams in replies and Markdown previews. The page uses the app CSP
// (`style-src 'self'`), which blocks Mermaid's own <style> and style attributes as markup.
const diagrams = [
  'flowchart LR\n  A[Client app] -->|HTTPS| B(Gateway)\n  B --> C{Auth ok?}\n  C -->|yes| D[Agent run]\n  D --> F[(State DB)]',
  'sequenceDiagram\n  participant U as User\n  participant G as Gateway\n  U->>G: send\n  G-->>U: ack',
  'graph TD; A-->B',
  'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running: send',
];
const text = diagrams.map(source => '```mermaid\n' + source + '\n```').join('\n\n');

test('Chromium: Mermaid diagrams keep their styles, arrowheads and natural size under the app CSP', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'mermaid-diagram-'));
  const bundle = await build({ stdin: { resolveDir: new URL('../../../', import.meta.url).pathname, loader: 'tsx', contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {MessageContent} from './apps/desktop/src/renderer/message-content';
    const host=document.getElementById('root');
    createRoot(host).render(<div className="message message-assistant" style={{width:'640px'}}><MessageContent text={${JSON.stringify(text)}}/></div>);
    const done=()=>host.querySelectorAll('.mermaid-diagram svg').length===${diagrams.length};
    const report=()=>{const out={violations};out.diagrams=[...host.querySelectorAll('.mermaid-diagram svg')].map(svg=>{
      const box=svg.getBoundingClientRect();
      const black=[...svg.querySelectorAll('path,rect,polygon')].filter(e=>!e.closest('marker')&&e.getBoundingClientRect().width>20&&getComputedStyle(e).fill==='rgb(0, 0, 0)').length;
      const outside=[...svg.querySelectorAll('.node')].filter(n=>{const s=[...n.querySelectorAll('rect,polygon,path,circle')].map(x=>x.getBoundingClientRect()).filter(r=>r.width>4);const t=[...n.querySelectorAll('text')].map(x=>x.getBoundingClientRect()).filter(r=>r.width>0);if(!s.length||!t.length)return false;const l=Math.min(...s.map(r=>r.left)),r=Math.max(...s.map(r=>r.right));return t.some(b=>b.left<l-1||b.right>r+1);}).length;
      const link=svg.querySelector('.flowchart-link');
      const marker=link?.getAttribute('marker-end');
      return {type:svg.getAttribute('aria-roledescription'),width:box.width,height:box.height,black,outside,inCode:!!svg.closest('pre'),
        linkStroke:link?getComputedStyle(link).stroke:null,linkFill:link?getComputedStyle(link).fill:null,marker:marker?!!svg.querySelector(marker.slice(4,-1)):null};});
      out.sheets=document.adoptedStyleSheets.length;document.getElementById('results').textContent=JSON.stringify(out);};
    const violations=[];document.addEventListener('securitypolicyviolation',e=>violations.push(e.violatedDirective));
    const started=Date.now();const wait=()=>done()||Date.now()-started>8000?report():setTimeout(wait,50);wait();
  ` }, bundle: true, minify: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
  const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
  const csp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'";
  const files = { '/': ['text/html', '<!doctype html><link rel="stylesheet" href="/styles.css"><div id="root"></div><pre id="results"></pre><script src="/bundle.js"></script>'], '/styles.css': ['text/css', css], '/bundle.js': ['text/javascript', bundle.outputFiles[0].text] };
  const server = createServer((req, res) => { const file = files[req.url]; res.writeHead(file ? 200 : 404, { 'content-type': file?.[0] ?? 'text/plain', 'content-security-policy': csp }); res.end(file?.[1] ?? ''); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const dom = await new Promise((resolve, reject) => execFile(process.env.HERMES_TEST_CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=900,900', '--virtual-time-budget=10000', `--user-data-dir=${join(folder, 'profile')}`, '--dump-dom', `http://127.0.0.1:${server.address().port}/`], { encoding: 'utf8', timeout: 60000, maxBuffer: 4_000_000 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
    const raw = /<pre id="results">(.*?)<\/pre>/s.exec(dom)?.[1];
    assert.ok(raw, 'no results');
    const r = JSON.parse(raw.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    assert.equal(r.diagrams.length, diagrams.length, 'every diagram rendered');
    assert.equal(r.sheets, diagrams.length, 'one adopted sheet per diagram');
    for (const d of r.diagrams) {
      assert.equal(d.black, 0, `${d.type}: no shape falls back to a black fill`);
      assert.equal(d.outside, 0, `${d.type}: every label is inside its shape`);
      assert.equal(d.inCode, false, `${d.type}: not inside a code block`);
    }
    const [flow, , small] = r.diagrams;
    assert.ok(flow.linkStroke !== 'none' && flow.linkFill === 'none', `flowchart edges are lines: ${JSON.stringify(flow)}`);
    assert.equal(flow.marker, true, 'arrowhead marker is kept');
    assert.ok(small.width < 150 && small.height < 250, `a small diagram keeps its natural size: ${small.width}x${small.height}`);
  } finally { server.close(); await rm(folder, { recursive: true, force: true }); }
});
