import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

// A sent message passes through queued (Cancel shown) to running (Cancel gone).
// Cancel sits in the time line, so the message height must not change.
test('source: Cancel is in the user time line on desktop and mobile, not in a separate row', async () => {
  const shell = await readFile(new URL('../src/renderer/shell.tsx', import.meta.url), 'utf8');
  const mobile = await readFile(new URL('../../mobile/src/ChatTimeline.tsx', import.meta.url), 'utf8');
  assert.match(shell, /className="user-message-time">\{message\.receiptId && message\.receiptState === "queued" \? <button type="button" className="user-message-cancel"/);
  assert.doesNotMatch(shell, /message-warning">[^\n]*cancelQueued/);
  assert.match(mobile, /testID="user-message-time" style=\{styles\.messageTime\}>\{row\.receipt\?\.state === 'queued' && <Pressable testID="user-message-cancel"/);
  assert.doesNotMatch(mobile, /messageWarning\}>[\s\S]{0,200}Cancel queued message/);
});

test('Chromium: Cancel appears and disappears without moving the message or the time', {skip:!process.env.HERMES_TEST_CHROME}, async()=>{
  const folder=await mkdtemp(join(tmpdir(),'send-cancel-inline-'));
  try {
    const bundle=await build({stdin:{resolveDir:new URL('../../../',import.meta.url).pathname,loader:'tsx',contents:`
      import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import {DesktopShellView} from './apps/desktop/src/renderer/shell';
      const cancelled=[];
      window.hermesDesktop={getRuntimeInfo:()=>({platform:'linux',versions:{}}),getSnapshot:async()=>base,copyText:async()=>{},cancelQueued:async id=>{cancelled.push(id);}};
      const root=createRoot(document.getElementById('root'));
      const now=new Date(2026,9,5,22,11).getTime()/1000;
      const user={id:'u',role:'user',text:'hello',toolCalls:[],attachments:[],createdAt:now,clientMessageId:'u'};
      const base={revision:1,phase:'connected',connectionState:'online',connectionLabel:'Online',channels:[{id:'p',name:'P'}],threads:[{id:'t',channelId:'p',title:'T',running:false}],selectedChannelId:'p',selectedThreadId:'t',interactions:[],canLoadOlder:false};
      const rect=e=>{const b=e.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,height:b.height}};
      const steps=[['saved',{...user,optimistic:true,receiptState:'queued'}],['queued',{...user,optimistic:true,receiptState:'queued',receiptId:'r1'}],['confirmed',{...user,receiptState:'queued',receiptId:'r1',refSeq:1}],['running',{...user,receiptState:'running',processing:'running',receiptId:'r1',refSeq:1}]];
      const results=steps.map(([name,message])=>{
        flushSync(()=>root.render(<DesktopShellView viewRole="tab" snapshot={{...base,messages:[message]}}/>));
        const row=document.querySelector('.message-user'),cancel=row.querySelector('.user-message-cancel');
        return {name,box:rect(row),time:rect(row.querySelector('time')),line:rect(row.querySelector('.user-message-time')),cancel:cancel?{...rect(cancel),label:cancel.getAttribute('aria-label'),text:cancel.textContent}:null,separate:!!row.querySelector('.message-warning')};
      });
      flushSync(()=>root.render(<DesktopShellView viewRole="tab" snapshot={{...base,messages:[steps[1][1]]}}/>));
      document.querySelector('.user-message-cancel').click();
      setTimeout(()=>{document.getElementById('results').textContent=JSON.stringify({results,cancelled});},50);
    `},bundle:true,minify:true,platform:'browser',format:'iife',write:false,define:{'process.env.NODE_ENV':'"production"'}});
    const css=await readFile(new URL('../src/renderer/styles.css',import.meta.url),'utf8');
    await writeFile(join(folder,'bundle.js'),bundle.outputFiles[0].text);
    const file=join(folder,'check.html');
    await writeFile(file,`<!doctype html><style>${css}</style><div id="root"></div><pre id="results"></pre><script src="bundle.js"></script>`);
    const dom=execFileSync(process.env.HERMES_TEST_CHROME,['--headless','--no-sandbox','--disable-gpu','--window-size=1280,900','--virtual-time-budget=1000',`--user-data-dir=${join(folder,'profile')}`,'--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:30000,maxBuffer:4_000_000,stdio:['ignore','pipe','pipe']});
    const result=JSON.parse(/<pre id="results">(.*?)<\/pre>/.exec(dom)?.[1]??'null');assert.ok(result);
    const [saved,queued,confirmed,running]=result.results;
    assert.equal(saved.cancel,null);assert.equal(running.cancel,null);
    for(const step of [queued,confirmed]){
      assert.ok(step.cancel,`${step.name}: Cancel shown`);
      assert.equal(step.cancel.text,'Cancel');assert.equal(step.cancel.label,'Cancel queued message');
      assert.ok(step.cancel.right<=step.time.left,'Cancel sits left of the time');
      assert.ok(step.cancel.top>=step.line.top-0.5&&step.cancel.bottom<=step.line.bottom+0.5,'Cancel stays inside the time line');
    }
    for(const step of result.results){
      assert.equal(step.separate,false,`${step.name}: no separate warning row`);
      assert.ok(Math.abs(step.box.height-saved.box.height)<0.5,`${step.name}: message height unchanged (${step.box.height} vs ${saved.box.height})`);
      assert.ok(Math.abs(step.time.right-saved.time.right)<0.5&&Math.abs(step.time.top-saved.time.top)<0.5,`${step.name}: time does not move`);
    }
    assert.deepEqual(result.cancelled,['r1']);
  } finally {await rm(folder,{recursive:true,force:true});}
});
