import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

test('Chromium: early Working merges into process, completion hides feedback, and date/time stay aligned', {skip:!process.env.HERMES_TEST_CHROME}, async()=>{
  const folder=await mkdtemp(join(tmpdir(),'message-date-working-'));
  try {
    const bundle=await build({stdin:{resolveDir:new URL('../../../',import.meta.url).pathname,loader:'tsx',contents:`
      import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import {DesktopShellView} from './apps/desktop/src/renderer/shell';
      window.hermesDesktop={getRuntimeInfo:()=>({platform:'linux',versions:{}}),getSnapshot:async()=>base};
      const root=createRoot(document.getElementById('root'));
      const now=new Date(2026,9,5,22,11).getTime()/1000;
      const msg=(id,role,text,extra={})=>({id,role,text,toolCalls:[],attachments:[],createdAt:now,...extra});
      const u=msg('u','user','Request',{receiptState:'queued',clientMessageId:'u',optimistic:true});
      const a=msg('a','assistant','Public explanation',{createdAt:now+1});
      const f=msg('f','assistant','Result',{displayKind:'final',createdAt:now+10});
      const base={revision:1,phase:'connected',connectionState:'online',connectionLabel:'Online',channels:[{id:'p',name:'P'}],threads:[{id:'t',channelId:'p',title:'T',running:false}],selectedChannelId:'p',selectedThreadId:'t',interactions:[],canLoadOlder:false};
      const results=[];
      const render=(name,messages,running=false,interactions=[])=>{
        flushSync(()=>root.render(<DesktopShellView viewRole="tab" snapshot={{...base,messages,interactions,threads:[{...base.threads[0],running}]}}/>));
        const list=document.querySelector('.message-list');
        results.push({name,working:[...list.querySelectorAll('.work-heading')].filter(x=>x.textContent.startsWith('Working')).length,placeholder:!!list.querySelector('.awaiting-agent-work'),dates:[...list.querySelectorAll('.chat-date-separator')].map(x=>x.textContent),normalReceipt:!!list.querySelector('.receipt-completed,.receipt-running,.receipt-received'),warning:list.querySelector('.message-warning')?.textContent??'',times:[...list.querySelectorAll('.message-user time')].map(x=>({text:x.textContent,date:x.dateTime,title:x.title})),assistantTimes:list.querySelectorAll('.message-assistant time').length});
        return list;
      };
      render('optimistic',[u]);
      const runningUser={...u,optimistic:false,receiptState:'running',processing:'running'};
      render('ack',[runningUser]);
      render('first-output',[runningUser,a]);
      render('followup',[runningUser,a,msg('followup','user','More',{receiptState:'queued'})],true);
      render('final',[{...runningUser,processing:'completed'},a,f],true);
      render('direct',[u,{...f,displayKind:'direct'}],true);
      render('failed',[{...u,receiptState:'failed',processing:'failed'}]);
      render('unknown',[{...u,receiptState:'unknown',processing:'unknown'}]);
      render('cancelled',[{...u,receiptState:'interrupted',processing:'interrupted'}]);
      render('approval',[runningUser],true,[{id:'i',kind:'approval',prompt:'Approval needed',choices:['Approve']}]);
      render('cold-running',[runningUser],true);
      render('cold-completed',[{...runningUser,receiptState:'completed',processing:'completed'},f]);
      const rich='A long user message\\n\\n'+Array.from({length:10},()=>'- A long list item that wraps naturally. '.repeat(4)).join('\\n');
      const layouts=[];
      for(const width of [390,720,1280]){
        document.documentElement.style.width=width+'px';document.body.style.width=width+'px';
        const list=render('layout-'+width,[{...u,receiptState:'completed',processing:'completed'},msg('u2','user',rich,{createdAt:now+86400}),f]);
        document.querySelector('.session-tab-page').style.width=width+'px';
        const rect=e=>{const b=e.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width}};
        layouts.push({width,scroll:list.scrollWidth,client:list.clientWidth,dates:[...list.querySelectorAll('.chat-date-separator')].map(x=>({box:rect(x),style:getComputedStyle(x).textAlign})),users:[...list.querySelectorAll('.message-user')].map(x=>({box:rect(x),content:rect(x.querySelector('.message-markdown')),time:rect(x.querySelector('time')),font:parseFloat(getComputedStyle(x.querySelector('time')).fontSize),body:parseFloat(getComputedStyle(x).fontSize)}))});
      }
      document.getElementById('results').textContent=JSON.stringify({results,layouts});
    `},bundle:true,minify:true,platform:'browser',format:'iife',write:false,define:{'process.env.NODE_ENV':'"production"'}});
    const css=await readFile(new URL('../src/renderer/styles.css',import.meta.url),'utf8');
    await writeFile(join(folder,'bundle.js'),bundle.outputFiles[0].text);
    const file=join(folder,'check.html');
    await writeFile(file,`<!doctype html><style>${css}</style><div id="root"></div><pre id="results"></pre><script src="bundle.js"></script>`);
    const dom=execFileSync(process.env.HERMES_TEST_CHROME,['--headless','--no-sandbox','--disable-gpu','--window-size=1280,900','--virtual-time-budget=1000',`--user-data-dir=${join(folder,'profile')}`,'--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:30000,maxBuffer:4_000_000,stdio:['ignore','pipe','pipe']});
    const result=JSON.parse(/<pre id="results">(.*?)<\/pre>/.exec(dom)?.[1]??'null');assert.ok(result);
    const byName=Object.fromEntries(result.results.map(row=>[row.name,row]));
    for(const name of ['optimistic','ack','first-output','followup','cold-running'])assert.equal(byName[name].working,1,name);
    assert.equal(byName['optimistic'].placeholder,true);assert.equal(byName['first-output'].placeholder,false);
    for(const name of ['final','direct','failed','unknown','cancelled','approval','cold-completed'])assert.equal(byName[name].working,0,name);
    assert.ok(byName.failed.warning.includes('Failed'));assert.ok(byName.unknown.warning.includes('Outcome unknown'));
    for(const row of result.results){assert.equal(row.normalReceipt,false);assert.equal(row.assistantTimes,0);assert.ok(row.times.every(time=>time.text==='22:11'&&time.date&&time.title));}
    for(const layout of result.layouts){
      assert.ok(layout.scroll<=layout.client,'timeline stays within viewport');
      for(const date of layout.dates)assert.equal(date.style,'center');
      for(const user of layout.users){assert.ok(user.time.top>=user.content.bottom);assert.ok(user.time.bottom<=user.box.bottom);assert.ok(Math.abs(user.time.right-(user.box.right-14))<1);assert.ok(user.font<user.body);}
    }
  } finally {await rm(folder,{recursive:true,force:true});}
});
