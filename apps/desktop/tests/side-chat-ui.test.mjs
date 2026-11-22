import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

// Side chats (docs/side-chat.md) in real Chromium: the Session page (button, anchor marks, Send to main fill),
// a side chat panel page, and the main window (right column tabs, sidebar tree).
test('Chromium: side chat button, anchor marks, panel page, right column and sidebar tree', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'side-chat-ui-'));
  try {
    const bundle = await build({ stdin: { resolveDir: new URL('../../../', import.meta.url).pathname, loader: 'tsx', contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import {DesktopShellView} from './apps/desktop/src/renderer/shell';
      import {NativeWorkspace} from './apps/desktop/src/renderer/native-workspace';
      const calls=[];let fill;
      window.hermesDesktop={getRuntimeInfo:()=>({platform:'linux',versions:{}}),getSnapshot:async()=>({}),
        loadLocalDrafts:async()=>({}),saveLocalDraft:async()=>{},
        sideFromMessage:async ref=>{calls.push(['side',ref]);return ref===2?{ok:true}:{ok:false,reason:'busy'}},
        openSideChat:async id=>{calls.push(['open',id])},sendToMain:async ref=>{calls.push(['main',ref])},
        branchFromMessage:async()=>({ok:true}),messageSources:async()=>[],copyText:async()=>{},exportMessage:async()=>({ok:true,saved:false}),
        showContextMenu:async items=>{calls.push(['menu',items.map(i=>i.label)]);return items[1].id},
        onFillComposer:listener=>{fill=listener;return()=>{fill=undefined}},
        setContentBounds:async()=>{},newTab:async()=>{},selectThread:async id=>{calls.push(['select',id])},browserAction:async()=>{},openBrowser:async()=>{},activateTab:async()=>{},closeTab:async()=>{},
        setSidePanelBounds:async b=>{calls.push(['bounds',b.visible,b.width>0&&b.height>0])},focusSideAnchor:async id=>{calls.push(['anchor',id])},
        closeSidePanel:async id=>{calls.push(['close',id])},selectRightTab:async key=>{calls.push(['front',key])},listAutomations:async()=>({supported:false,automations:[],failed:[]})};
      const msg=(id,role,text,extra={})=>({id,role,text,toolCalls:[],attachments:[],createdAt:1700000000,...extra});
      const now=Date.now()/1000;
      const t=(id,title,extra={})=>({id,channelId:'p',title,markers:[],running:false,lastMessageAt:now-60,...extra});
      const sides=[t('s1','Side: one',{sideOf:{threadId:'t',anchorRefSeq:2}}),t('s2','Side: two',{running:true,sideOf:{threadId:'t',anchorRefSeq:4}}),t('s3','Side: three',{completedUnread:true,sideOf:{threadId:'t',anchorRefSeq:4}})];
      const messages=[msg('u1','user','Q1',{refSeq:1}),msg('f1','assistant','First',{displayKind:'final',refSeq:2}),msg('u2','user','Q2',{refSeq:3}),msg('f2','assistant','TG line',{displayKind:'final',refSeq:4})];
      const base={revision:1,phase:'connected',connectionState:'online',connectionLabel:'Online',channels:[{id:'p',name:'P'}],threads:[t('t','Main'),...sides],selectedChannelId:'p',selectedThreadId:'t',interactions:[],canLoadOlder:false,messages,tabActive:true,
        supportsThreadBranch:true,supportsThreadSide:true,draftIdentity:'one'};
      const root=createRoot(document.getElementById('root'));
      const tick=(ms=0)=>new Promise(r=>setTimeout(r,ms));
      const labels=el=>[...el.querySelectorAll('button')].map(b=>b.getAttribute('aria-label'));
      (async()=>{const out={};try{
        // 1. The source Session page.
        flushSync(()=>root.render(<DesktopShellView viewRole="tab" snapshot={base}/>));await tick(20);
        let bars=[...document.querySelectorAll('.message-final .message-toolbar')];
        out.toolbars=bars.map(labels);
        out.marks=[...document.querySelectorAll('.message-final')].map(m=>m.querySelector('.side-mark')?.getAttribute('aria-label')??null);
        out.markText=[...document.querySelectorAll('.side-mark span:not(.side-mark-dot)')].map(s=>s.textContent);
        document.querySelectorAll('.side-mark')[0].click();await tick();
        document.querySelectorAll('.side-mark')[1].click();await tick();await tick();
        bars[0].querySelector('[aria-label="Side chat"]').click();await tick();await tick();
        bars[1].querySelector('[aria-label="Side chat"]').click();await tick();await tick();
        out.sideNote=bars[1].querySelector('.message-toolbar-note')?.textContent??'';
        out.statusSide=document.querySelector('.status-side-chats')?.getAttribute('aria-label');
        const field=document.querySelector('.composer textarea');
        fill('From side chat [Side: one](hermesapp://session/s1):\\n\\nResult');await tick(30);
        out.filled=field.value;out.filledFocus=document.activeElement===field;
        fill('Second');await tick(30);out.appended=field.value;
        // A running Session keeps the Side chat button enabled (the server waits); Branch is disabled.
        flushSync(()=>root.render(<DesktopShellView viewRole="tab" snapshot={{...base,threads:[t('t','Main',{running:true}),...sides]}}/>));await tick(20);
        out.runningDisabled=[...document.querySelectorAll('.message-final .message-toolbar')].map(bar=>[...bar.querySelectorAll('button')].filter(b=>b.disabled).map(b=>b.getAttribute('aria-label')));
        // 2. A side chat panel page: Send to main, no Branch or Side chat, no anchor marks or Side chats list.
        flushSync(()=>root.render(<DesktopShellView viewRole="tab" snapshot={{...base,sidePanel:true,selectedThreadId:'s1',messages:[msg('n','system','Side chat from [Main](hermesapp://session/t)',{displayKind:'system_notice',noticeKind:'branch',refSeq:1}),msg('u','user','Why?',{refSeq:2}),msg('r','assistant','Because.',{displayKind:'final',refSeq:3})]}}/>));await tick(20);
        out.panelToolbar=[...document.querySelectorAll('.message-final .message-toolbar')].map(labels);
        out.panelStatusSide=!!document.querySelector('.status-side-chats');
        document.querySelector('[aria-label="Send to main"]').click();await tick();
        // 3. The main window: right column tabs and the sidebar tree.
        root.unmount();
        const root2=createRoot(document.getElementById('root'));
        const many=Array.from({length:12},(_,i)=>t('m'+i,'Many '+i,{lastMessageAt:now-100-i,sideOf:{threadId:'t',anchorRefSeq:4}}));
        const shell={...base,selectedThreadId:'t',threads:[t('t','Main'),t('u','Other'),...sides,...many],tabs:[{id:'tab1',kind:'session',threadId:'t',title:'Main'}],activeTabId:'tab1',
          sidePanels:[{id:'panel1',threadId:'s1',title:'Side: one'},{id:'panel2',threadId:'s2',title:'Side: two'}],rightTab:'panel1'};
        const ws=snapshot=>flushSync(()=>root2.render(<NativeWorkspace snapshot={snapshot} draftThreads={new Set()} onEditLabels={()=>{}} onCreateProject={()=>{}} onProjectOptions={()=>{}} onSettings={()=>{}} overlayOpen={false}/>));
        ws(shell);await tick(50);
        out.rightTabs=[...document.querySelectorAll('.right-tab [role="tab"]')].map(b=>[b.textContent,b.getAttribute('aria-selected')]);
        out.panelTitle=document.querySelector('.side-panel-title span')?.textContent;
        const slot=document.querySelector('.side-panel-slot').getBoundingClientRect(), column=document.querySelector('.right-column').getBoundingClientRect(), main=document.querySelector('.native-view-slot').getBoundingClientRect();
        out.layout={slotW:slot.width,slotH:slot.height,columnRight:Math.round(column.right),innerWidth:window.innerWidth,mainW:main.width,overlap:main.right>column.left+1};
        document.querySelector('[aria-label="Show the starting message"]').click();await tick();
        document.querySelectorAll('.right-tab [role="tab"]')[1].click();await tick();
        document.querySelector('[aria-label="Close side chat: Side: two"]').click();await tick();
        // Sidebar: side chats only under their source; first level never lists them.
        const tree=()=>document.querySelector('.channel-tree');
        out.firstLevel=[...tree().querySelectorAll('.thread-children > .tree-thread, .thread-children > .tree-thread-group > .tree-thread-with-sides > .tree-thread')].map(b=>b.querySelector('.thread-title').textContent);
        const children=()=>[...tree().querySelectorAll('.tree-side-children .tree-thread')].map(b=>b.querySelector('.thread-title').textContent);
        out.children=children();
        const child=tree().querySelector('.tree-side-children .tree-thread'), parent=tree().querySelector('.tree-thread-with-sides .tree-thread'), toggle=tree().querySelector('.tree-side-toggle');
        out.indent={child:child.getBoundingClientRect().left,parent:parent.getBoundingClientRect().left,childTitle:child.querySelector('.thread-title').getBoundingClientRect().left,parentTitle:parent.querySelector('.thread-title').getBoundingClientRect().left,toggleLeft:toggle.getBoundingClientRect().left,toggleRight:toggle.getBoundingClientRect().right,parentRight:parent.getBoundingClientRect().right,toggleW:toggle.getBoundingClientRect().width,toggleOpacity:getComputedStyle(toggle).opacity,sibling:tree().querySelector('.thread-children > .tree-thread .thread-title').getBoundingClientRect().left,childIcon:!!child.querySelector('.tree-side-icon svg'),childFont:getComputedStyle(child).fontSize,childColor:getComputedStyle(child.querySelector('.thread-title')).color,siblingColor:getComputedStyle(tree().querySelector('.thread-children > .tree-thread:not(.selected) .thread-title')).color};
        out.selectedSide=[...tree().querySelectorAll('.tree-side-children .tree-thread.selected')].map(b=>b.querySelector('.thread-title').textContent);
        out.recentFirst=[...document.querySelectorAll('#sidebar-recents-list > .tree-thread, #sidebar-recents-list > .tree-thread-group > .tree-thread-with-sides > .tree-thread')].map(b=>b.querySelector('.thread-title').textContent);
        tree().querySelector('.tree-side-more').click();await tick(20);out.afterMore=children().length;out.moreLeft=!!tree().querySelector('.tree-side-more');
        tree().querySelector('.tree-side-children .tree-thread').click();await tick();
        tree().querySelector('.tree-side-toggle').click();await tick(20);
        { const t=tree().querySelector('.tree-side-toggle'); out.foldedToggle=[t.textContent.replace(/[\ue000-\uefff]/g,''),getComputedStyle(t).opacity]; }
        out.folded=[tree().querySelectorAll('.tree-side-children').length,document.querySelectorAll('.tree-side-children').length,localStorage.getItem('hermes.sidebar.side-chats-collapsed')];
        // An archived source hides its side chats everywhere.
        ws({...shell,threads:[t('u','Other'),...sides],sidePanels:undefined,rightTab:undefined});await tick(20);
        out.orphans=[...document.querySelectorAll('.channel-tree .tree-thread .thread-title, #sidebar-recents-list .tree-thread .thread-title')].map(s=>s.textContent);
        out.noColumn=!document.querySelector('.right-column');
        out.calls=calls;
      }catch(error){out.error=String(error&&error.stack||error)}
      document.getElementById('results').textContent=JSON.stringify(out);})();
    ` }, bundle: true, minify: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
    const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    await writeFile(join(folder, 'bundle.js'), bundle.outputFiles[0].text);
    const file = join(folder, 'check.html');
    await writeFile(file, `<!doctype html><style>${css} html,body,#root{height:100%;margin:0}</style><div id="root"></div><pre id="results"></pre><script src="bundle.js"></script>`);
    const dom = execFileSync(process.env.HERMES_TEST_CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=1400,900', '--virtual-time-budget=5000', `--user-data-dir=${join(folder, 'profile')}`, '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 40000, maxBuffer: 4_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const raw = /<pre id="results">(.*?)<\/pre>/s.exec(dom)?.[1];
    assert.ok(raw, 'no results');
    const r = JSON.parse(raw.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    assert.equal(r.error, undefined, r.error);
    assert.deepEqual(r.toolbars, [['Side chat', 'Branch', 'Copy', 'Export'], ['Side chat', 'Branch', 'Copy', 'Export', 'Retry']]);
    assert.deepEqual(r.marks, ['Side chat', 'Side chat · 2, running, unread result']);
    assert.deepEqual(r.markText, ['Side chat', 'Side chat · 2']);
    assert.equal(r.sideNote, 'The session stayed busy for 10 minutes. Try again later.');
    assert.equal(r.statusSide, 'Side chats: 3');
    assert.equal(r.filled, 'From side chat [Side: one](hermesapp://session/s1):\n\nResult');
    assert.equal(r.filledFocus, true);
    assert.equal(r.appended, 'From side chat [Side: one](hermesapp://session/s1):\n\nResult\n\nSecond', 'a second fill keeps the draft');
    assert.deepEqual(r.runningDisabled, [['Branch'], ['Branch', 'Retry']]);
    assert.deepEqual(r.panelToolbar, [['Send to main', 'Copy', 'Export', 'Retry']]);
    assert.equal(r.panelStatusSide, false);
    assert.deepEqual(r.rightTabs, [['Side: one', 'true'], ['Side: two', 'false']]);
    assert.equal(r.panelTitle, 'Side: one');
    assert.ok(r.layout.slotW > 200 && r.layout.slotH > 200 && r.layout.columnRight === r.layout.innerWidth && r.layout.mainW >= 360 && !r.layout.overlap, JSON.stringify(r.layout));
    assert.deepEqual(r.firstLevel, ['Main', 'Other']);
    // The source title lines up with the other first-level rows; its side chats sit one step (17px) right of it.
    // The fold control is at the right end of the source row, hidden until hover or focus, and shown with the count while folded.
    assert.equal(Math.round(r.indent.parentTitle), Math.round(r.indent.sibling), JSON.stringify(r.indent));
    assert.ok(r.indent.child > r.indent.parent && r.indent.childTitle - r.indent.parentTitle >= 14, JSON.stringify(r.indent));
    assert.ok(r.indent.toggleW > 0 && r.indent.toggleLeft > r.indent.parentTitle && r.indent.toggleRight <= r.indent.parentRight, JSON.stringify(r.indent));
    assert.equal(r.indent.toggleOpacity, '0');
    assert.equal(r.indent.childIcon, true, 'side chat rows carry the side chat icon');
    assert.equal(r.indent.childColor, r.indent.siblingColor, 'side chat titles keep the normal text color');
    assert.deepEqual(r.foldedToggle, ['15', '1']);
    assert.deepEqual(r.children.slice(0, 2), ['Side: two', 'Side: one'], 'running first, then newest');
    assert.equal(r.children.length, 1 + 10, 'every running side chat plus the 10 newest others');
    assert.deepEqual(r.selectedSide, ['Side: one'], 'the front panel\'s row is selected');
    assert.deepEqual(r.recentFirst, ['Main', 'Other']);
    assert.equal(r.afterMore, 15); assert.equal(r.moreLeft, false);
    assert.deepEqual(r.folded.slice(0, 2), [0, 0], 'folding hides the side chats in every list of the source');
    assert.deepEqual(JSON.parse(r.folded[2]), ['t']);
    assert.deepEqual(r.orphans, ['Other', 'Other'], 'side chats of an archived source are hidden');
    assert.equal(r.noColumn, true);
    const calls = r.calls.filter(c => c[0] !== 'bounds' && c[0] !== 'select');
    assert.deepEqual(calls, [['open', 's1'], ['menu', ['Side: two · Running', 'Side: three · Unread']], ['open', 's3'], ['side', 2], ['side', 4], ['main', 3],
      ['anchor', 'panel1'], ['front', 'panel2'], ['close', 'panel2'], ['open', 's2']]);
    assert.ok(r.calls.some(c => c[0] === 'bounds' && c[1] === true && c[2] === true), 'the panel slot reports visible bounds');
  } finally { await rm(folder, { recursive: true, force: true }); }
});
