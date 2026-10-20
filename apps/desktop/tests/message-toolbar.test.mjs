import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

test('Chromium: final replies carry Branch, Copy, References, Export and Retry; notices open short links', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'message-toolbar-'));
  try {
    const bundle = await build({ stdin: { resolveDir: new URL('../../../', import.meta.url).pathname, loader: 'tsx', contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import {DesktopShellView} from './apps/desktop/src/renderer/shell';
      const calls=[];
      window.hermesDesktop={getRuntimeInfo:()=>({platform:'linux',versions:{}}),getSnapshot:async()=>base,
        branchFromMessage:async ref=>{calls.push(['branch',ref]);return ref===2?{ok:true}:{ok:false,reason:'busy'}},
        messageSources:async ref=>{calls.push(['sources',ref]);return [{url:'https://www.example.com/doc',kind:'read'},{url:'https://example.org/',kind:'cited'}]},
        copyText:async text=>{calls.push(['copy',text])},
        exportMessage:async text=>{calls.push(['export',text]);return {ok:true,saved:true}},
        exportConversation:async()=>{calls.push(['export-conversation']);return {ok:true,saved:false}},
        retryLatest:async()=>{calls.push(['retry'])},
        openSessionLink:async url=>{calls.push(['link',url])},
        copySessionLink:async()=>{}};
      const root=createRoot(document.getElementById('root'));
      const msg=(id,role,text,extra={})=>({id,role,text,toolCalls:[],attachments:[],createdAt:1700000000,...extra});
      const messages=[msg('u1','user','Q1',{refSeq:1}),msg('f1','assistant','First **answer**',{displayKind:'final',refSeq:2,model:'claude-opus-5-5'}),
        msg('u2','user','Q2',{refSeq:3}),msg('f2','assistant','Second answer',{displayKind:'final',refSeq:4}),
        msg('n','system','Branched to [Side](hermesapp://session/th_side0001)',{displayKind:'system_notice',noticeKind:'branch',refSeq:5})];
      const base={revision:1,phase:'connected',connectionState:'online',connectionLabel:'Online',channels:[{id:'p',name:'P'}],threads:[{id:'t',channelId:'p',title:'T',running:false}],selectedChannelId:'p',selectedThreadId:'t',interactions:[],canLoadOlder:false,messages};
      const render=extra=>flushSync(()=>root.render(<DesktopShellView viewRole="tab" snapshot={{...base,...extra}}/>));
      const labels=el=>[...el.querySelectorAll('button')].map(b=>b.getAttribute('aria-label'));
      const tick=()=>new Promise(r=>setTimeout(r,0));
      (async()=>{
        const out={};
        render({supportsThreadBranch:true,supportsMessageSources:true,supportsThreadExport:true});
        let bars=[...document.querySelectorAll('.message-final .message-toolbar')];
        out.full=bars.map(labels);
        const modelBox=el=>{const m=el.querySelector('.message-model');if(!m)return null;const box=m.getBoundingClientRect(),bar=el.getBoundingClientRect(),btn=el.querySelector('button').getBoundingClientRect();
          return {text:m.textContent,title:m.getAttribute('title'),rightGap:bar.right-box.right,center:Math.abs((box.top+box.bottom)/2-(btn.top+btn.bottom)/2),last:el.lastElementChild===m,color:getComputedStyle(m).color,label:getComputedStyle(el.querySelector('button')).color,height:box.height};};
        out.models=bars.map(modelBox);
        out.session=labels(document.querySelector('.status-actions'));
        const press=(bar,label)=>bar.querySelector('[aria-label="'+label+'"]').click();
        press(bars[0],'Branch');await tick();
        press(bars[1],'Branch');await tick();await tick();
        out.busyNote=bars[1].querySelector('.message-toolbar-note')?.textContent??'';
        press(bars[0],'References');await tick();await tick();
        out.sources=[...document.querySelectorAll('.message-sources a')].map(a=>[a.textContent,a.getAttribute('href'),a.target]);
        out.cited=[...document.querySelectorAll('.message-sources small')].map(s=>s.textContent);
        press(bars[0],'Copy');await tick();
        press(bars[0],'Export');await tick();await tick();
        out.savedNote=bars[0].querySelector('.message-toolbar-note')?.textContent??'';
        press(bars[1],'Retry');await tick();
        document.querySelector('[aria-label="Export conversation"]').click();await tick();
        const link=[...document.querySelectorAll('.message-system a')].find(a=>a.textContent==='Side');
        out.noticeHref=link?.getAttribute('href');link?.click();await tick();
        out.calls=calls;
        // Running agent: Branch and Retry are disabled; an older server shows no Branch/References/Export conversation.
        render({supportsThreadBranch:true,supportsMessageSources:true,threads:[{...base.threads[0],running:true}],messages:[...messages.slice(0,4),msg('u3','user','Q3',{refSeq:6,receiptState:'running',processing:'running'})]});
        bars=[...document.querySelectorAll('.message-final .message-toolbar')];
        out.running=bars.map(bar=>[...bar.querySelectorAll('button')].filter(b=>b.disabled).map(b=>b.getAttribute('aria-label')));
        out.runningRetry=bars.map(bar=>!!bar.querySelector('[aria-label="Retry"]'));
        render({});
        out.old=[...document.querySelectorAll('.message-final .message-toolbar')].map(labels);
        out.oldSession=labels(document.querySelector('.status-actions'));
        const svg=document.querySelector('.message-toolbar svg');
        out.icon={w:svg.getBoundingClientRect().width,stroke:getComputedStyle(svg).stroke!=='none',emoji:/\\p{Extended_Pictographic}/u.test(document.querySelector('.message-toolbar').textContent)};
        document.getElementById('results').textContent=JSON.stringify(out);
      })();
    ` }, bundle: true, minify: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
    const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    await writeFile(join(folder, 'bundle.js'), bundle.outputFiles[0].text);
    const file = join(folder, 'check.html');
    await writeFile(file, `<!doctype html><style>${css}</style><div id="root"></div><pre id="results"></pre><script src="bundle.js"></script>`);
    const dom = execFileSync(process.env.HERMES_TEST_CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=1280,900', '--virtual-time-budget=3000', `--user-data-dir=${join(folder, 'profile')}`, '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 30000, maxBuffer: 4_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const raw = /<pre id="results">(.*?)<\/pre>/s.exec(dom)?.[1];
    assert.ok(raw, 'no results');
    const r = JSON.parse(raw.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    assert.deepEqual(r.full, [['Branch', 'Copy', 'References', 'Export'], ['Branch', 'Copy', 'References', 'Export', 'Retry']]);
    // The model sits at the right end of the row, vertically centered, in the muted label color.
    const [model, none] = r.models;
    assert.equal(none, null, 'a reply without a model shows nothing');
    assert.equal(model.text, 'claude-opus-5-5'); assert.equal(model.title, 'Generated by claude-opus-5-5');
    assert.ok(model.last && Math.abs(model.rightGap) <= 1, JSON.stringify(model));
    assert.ok(model.center <= 1.5 && model.height > 0, JSON.stringify(model));
    assert.equal(model.color, model.label);
    assert.ok(r.session.includes('Export conversation'));
    assert.equal(r.busyNote, 'Wait until the current reply finishes, then try again.');
    assert.deepEqual(r.sources, [['example.com/doc', 'https://www.example.com/doc', '_blank'], ['example.org', 'https://example.org/', '_blank']]);
    assert.deepEqual(r.cited, ['cited']);
    assert.equal(r.savedNote, 'Saved');
    assert.equal(r.noticeHref, 'hermesapp://session/th_side0001');
    assert.deepEqual(r.calls, [['branch', 2], ['branch', 4], ['sources', 2], ['copy', 'First **answer**'], ['export', 'First **answer**'],
      ['retry'], ['export-conversation'], ['link', 'hermesapp://session/th_side0001']]);
    assert.deepEqual(r.running, [['Branch'], ['Branch']]);
    assert.deepEqual(r.runningRetry, [false, false], 'a pending input moves Retry away');
    assert.deepEqual(r.old, [['Copy', 'Export'], ['Copy', 'Export', 'Retry']]);
    assert.ok(!r.oldSession.includes('Export conversation'));
    assert.equal(r.icon.w, 16); assert.ok(r.icon.stroke); assert.equal(r.icon.emoji, false);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
