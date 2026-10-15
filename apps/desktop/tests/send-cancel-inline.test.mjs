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
  assert.match(shell, /: <span className="user-message-cancel user-message-cancel-slot" aria-hidden="true">Cancel<\/span>/);
  assert.doesNotMatch(shell, /message-warning">[^\n]*cancelQueued/);
  assert.match(mobile, /testID="user-message-time" style=\{styles\.messageTime\}>\{row\.receipt\?\.state === 'queued'\s*\? <Pressable testID="user-message-cancel"/);
  assert.match(mobile, /: <View testID="user-message-cancel-slot" pointerEvents="none"[^>]*importantForAccessibility="no-hide-descendants" style=\{\[styles\.inlineCancel, styles\.cancelSlot\]\}><Text style=\{styles\.cancelText\}>Cancel<\/Text>/);
  assert.doesNotMatch(mobile, /messageWarning\}>[\s\S]{0,200}Cancel queued message/);
});

test('Chromium: Cancel appears and disappears without changing a short bubble\'s size or moving the time', {skip:!process.env.HERMES_TEST_CHROME}, async()=>{
  const folder=await mkdtemp(join(tmpdir(),'send-cancel-inline-'));
  try {
    const bundle=await build({stdin:{resolveDir:new URL('../../../',import.meta.url).pathname,loader:'tsx',contents:`
      import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import {DesktopShellView} from './apps/desktop/src/renderer/shell';
      const cancelled=[];
      window.hermesDesktop={getRuntimeInfo:()=>({platform:'linux',versions:{}}),getSnapshot:async()=>base,copyText:async()=>{},cancelQueued:async id=>{cancelled.push(id);}};
      const root=createRoot(document.getElementById('root'));
      const now=new Date(2026,9,5,22,11).getTime()/1000;
      const user={id:'u',role:'user',text:'ok',toolCalls:[],attachments:[],createdAt:now,clientMessageId:'u'};
      const base={revision:1,phase:'connected',connectionState:'online',connectionLabel:'Online',channels:[{id:'p',name:'P'}],threads:[{id:'t',channelId:'p',title:'T',running:false}],selectedChannelId:'p',selectedThreadId:'t',interactions:[],canLoadOlder:false};
      const rect=e=>{const b=e.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,height:b.height,width:b.width}};
      const steps=[['history',{...user,receiptState:'completed',processing:'completed',receiptId:'r1',refSeq:1}],['saved',{...user,optimistic:true,receiptState:'queued'}],['queued',{...user,optimistic:true,receiptState:'queued',receiptId:'r1'}],['confirmed',{...user,receiptState:'queued',receiptId:'r1',refSeq:1}],['running',{...user,receiptState:'running',processing:'running',receiptId:'r1',refSeq:1}]];
      const results=[];
      for(const font of ['14px','18px']){document.documentElement.style.setProperty('--app-font-size',font);for(const [name,message] of steps){
        flushSync(()=>root.render(<DesktopShellView viewRole="tab" snapshot={{...base,messages:[message]}}/>));
        const row=document.querySelector('.message-user'),cancel=row.querySelector('button.user-message-cancel'),slot=row.querySelector('.user-message-cancel-slot');
        results.push({name,font,slot:slot?{visibility:getComputedStyle(slot).visibility,hidden:slot.getAttribute('aria-hidden')}:null,box:rect(row),time:rect(row.querySelector('time')),line:rect(row.querySelector('.user-message-time')),cancel:cancel?{...rect(cancel),label:cancel.getAttribute('aria-label'),text:cancel.textContent}:null,separate:!!row.querySelector('.message-warning')});
      }}
      document.documentElement.style.setProperty('--app-font-size','14px');
      flushSync(()=>root.render(<DesktopShellView viewRole="tab" snapshot={{...base,messages:[steps[2][1]]}}/>));
      document.querySelector('button.user-message-cancel').click();
      setTimeout(()=>{document.getElementById('results').textContent=JSON.stringify({results,cancelled});},50);
    `},bundle:true,minify:true,platform:'browser',format:'iife',write:false,define:{'process.env.NODE_ENV':'"production"'}});
    const css=await readFile(new URL('../src/renderer/styles.css',import.meta.url),'utf8');
    await writeFile(join(folder,'bundle.js'),bundle.outputFiles[0].text);
    const file=join(folder,'check.html');
    await writeFile(file,`<!doctype html><style>${css}</style><div id="root"></div><pre id="results"></pre><script src="bundle.js"></script>`);
    const dom=execFileSync(process.env.HERMES_TEST_CHROME,['--headless','--no-sandbox','--disable-gpu','--window-size=1280,900','--virtual-time-budget=1000',`--user-data-dir=${join(folder,'profile')}`,'--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:30000,maxBuffer:4_000_000,stdio:['ignore','pipe','pipe']});
    const result=JSON.parse(/<pre id="results">(.*?)<\/pre>/.exec(dom)?.[1]??'null');assert.ok(result);
    for(const font of ['14px','18px']){
    const steps=result.results.filter(step=>step.font===font);
    const [history,saved,queued,confirmed,running]=steps;
    for(const step of [history,saved,running]){assert.equal(step.cancel,null);assert.deepEqual(step.slot,{visibility:'hidden',hidden:'true'},`${step.name}: invisible placeholder keeps the space`);}
    for(const step of [queued,confirmed]){assert.equal(step.slot,null);
      assert.ok(step.cancel,`${step.name}: Cancel shown`);
      assert.equal(step.cancel.text,'Cancel');assert.equal(step.cancel.label,'Cancel queued message');
      assert.ok(step.cancel.right<=step.time.left,'Cancel sits left of the time');
      assert.ok(step.cancel.top>=step.line.top-0.5&&step.cancel.bottom<=step.line.bottom+0.5,'Cancel stays inside the time line');
    }
    for(const step of steps){
      assert.equal(step.separate,false,`${step.name}: no separate warning row`);
      assert.ok(Math.abs(step.box.height-saved.box.height)<0.5,`${font} ${step.name}: height unchanged (${step.box.height} vs ${saved.box.height})`);
      assert.ok(Math.abs(step.box.width-saved.box.width)<0.5&&Math.abs(step.box.left-saved.box.left)<0.5,`${font} ${step.name}: short bubble width unchanged (${step.box.width} vs ${saved.box.width})`);
      assert.ok(Math.abs(step.time.right-saved.time.right)<0.5&&Math.abs(step.time.top-saved.time.top)<0.5,`${font} ${step.name}: time does not move`);
    }
    // The bubble is wider than Cancel + copy + time, with at least the 8px margin left of Cancel.
    assert.ok(queued.cancel.left-queued.box.left>=14+8-0.5,`${font}: margin left of Cancel`);
    }
    assert.deepEqual(result.cancelled,['r1']);
  } finally {await rm(folder,{recursive:true,force:true});}
});
