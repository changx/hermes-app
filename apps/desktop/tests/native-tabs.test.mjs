import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import test from 'node:test';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);
const compiled = await build({ entryPoints: [new URL('../src/main/tab-manager.ts', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', external: ['electron'], write: false });
let counter = 0;
class Contents extends EventEmitter {
  id = ++counter; sent = []; destroyed = false; focused = false;
  loadFile() { return Promise.resolve(); } getURL() { return 'file:///app/index.html'; } send(name, value) { this.sent.push(value); (this.channels ??= []).push(name); }
  isDestroyed() { return this.destroyed; } close() { this.destroyed = true; } setAudioMuted(value) { this.muted = value; }
  focus() { this.focused = true; } isCrashed() { return false; } isLoading() { return false; }
}
class View { webContents = new Contents(); constructor(options) { this.options = options; } setVisible(v) { this.visible = v; } setBounds(v) { this.bounds = v; } }
const mod = { exports: {} };
new Function('require','module','exports',compiled.outputFiles[0].text)(name => name === 'electron' ? { WebContentsView: View } : require(name), mod, mod.exports);
const { DesktopTabManager } = mod.exports;
function fixture() {
  const views = [], closed = [], snapshot = { revision: 1, phase: 'connected', connectionKey: 'identity', channels: [{ id:'p', name:'Project' }],
    threads: ['a','b'].map(id=>({id, channelId:'p', title:id, running:false})), messages: [], interactions: [], canLoadOlder: false };
  const window = { webContents: new Contents(), contentView: { addChildView(v){views.push(v);}, removeChildView(v){views.splice(views.indexOf(v),1);} }, isDestroyed:()=>false, getContentSize:()=>[1280,820], title:'Hermes', getTitle(){return this.title;}, setTitle(value){this.title=value;} };
  const service = { snapshot(id){return {...snapshot, selectedThreadId:id ?? snapshot.selectedThreadId, messages:id ? [{id:`${id}-message`,role:'assistant',text:id,toolCalls:[],attachments:[]}] : []};},
    selectThread(id){snapshot.selectedThreadId=id; manager.sync(snapshot); return Promise.resolve();}, deactivateThread(){snapshot.selectedThreadId=undefined;manager.sync(snapshot);},
    closeSessionPage(id){closed.push(id);manager.sync(snapshot);},
    hasConnection(key){return !!key && key===snapshot.connectionKey;}, connectionForChannel(){return snapshot.connectionKey;},
    connectionForAutomation(id){if(id.startsWith('gone:'))throw new Error('Connection unavailable');return snapshot.connectionKey;},
    activeGroupId(){return null;}, visibleConnectionKeys(){return new Set([snapshot.connectionKey]);} };
  const manager = new DesktopTabManager(window, service, '/app/main', ()=>{});
  return {manager,service,snapshot,views,closed,window};
}
/** Two connections: `w` (group Work) and `h` (group Home); Project `pw` with Session `a`, Project `ph` with Session `b`. */
function groupFixture() {
  const views = [], groups = { active: null };
  const keyOf = id => id === 'a' || id === 'pw' ? 'w' : 'h';
  const snapshot = { revision: 1, phase: 'connected', connectionKey: 'w', messages: [], interactions: [], canLoadOlder: false,
    channels: [{ id:'pw', name:'Work project', connectionKey:'w' }, { id:'ph', name:'Home project', connectionKey:'h' }],
    threads: [{ id:'a', channelId:'pw', title:'a', running:false }, { id:'b', channelId:'ph', title:'b', running:false }],
    connections: [{ id:'cw', name:'Work', server:'', state:'online', connectionKey:'w', groupId:'gw' }, { id:'ch', name:'Home', server:'', state:'online', connectionKey:'h', groupId:'gh' }] };
  const window = { webContents: new Contents(), contentView: { addChildView(v){views.push(v);}, removeChildView(v){views.splice(views.indexOf(v),1);} }, isDestroyed:()=>false, getContentSize:()=>[1280,820], title:'Hermes', getTitle(){return this.title;}, setTitle(value){this.title=value;} };
  const selected = [];
  const service = { snapshot(id){return {...snapshot, selectedThreadId:id ?? snapshot.selectedThreadId, connectionKey: id ? keyOf(id) : snapshot.connectionKey};},
    selectThread(id){selected.push(id);snapshot.selectedThreadId=id;snapshot.connectionKey=keyOf(id);manager.sync(snapshot);return Promise.resolve();},
    deactivateThread(){snapshot.selectedThreadId=undefined;manager.sync(snapshot);}, closeSessionPage(){},
    hasConnection(key){return key==='w'||key==='h';}, connectionForChannel(id){return id?keyOf(id):snapshot.connectionKey;},
    activeGroupId(){return groups.active;}, visibleConnectionKeys(){return new Set(groups.active===null?['w','h']:groups.active==='gw'?['w']:['h']);},
    // Switching groups: the service selection moves to a connection of the new group, like DesktopConnections.current().
    setGroup(id){groups.active=id;if(snapshot.selectedThreadId&&!this.visibleConnectionKeys().has(keyOf(snapshot.selectedThreadId)))snapshot.selectedThreadId=undefined;manager.sync(snapshot);} };
  const manager = new DesktopTabManager(window, service, '/app/main', ()=>{});
  return {manager,service,snapshot,selected};
}
test('connection groups: the tab strip and lists show the active group; each group gets its last tab back', async()=>{
  const f=groupFixture();await f.service.selectThread('a');await f.service.selectThread('b');
  const [a,b]=[...f.manager.tabs.values()];
  assert.equal(f.manager.activeTabId,b.id);assert.deepEqual(f.manager.snapshot().tabs.map(t=>t.threadId),['a','b']);
  f.service.setGroup('gw');
  const work=f.manager.snapshot();
  assert.deepEqual(work.tabs.map(t=>t.threadId),['a'],'Home tabs are hidden, not closed');
  assert.equal(f.manager.tabs.size,2);assert.equal(b.view.webContents.destroyed,false);
  assert.equal(f.manager.activeTabId,a.id);assert.equal(a.view.visible,true);assert.equal(b.view.visible,false);
  assert.deepEqual(work.channels.map(c=>c.id),['pw']);assert.deepEqual(work.threads.map(t=>t.id),['a']);assert.deepEqual(work.connections.map(c=>c.id),['cw']);
  // A tab keeps its own connection's Projects; other groups' Projects are not listed.
  assert.deepEqual(f.manager.snapshot(a.view.webContents).channels.map(c=>c.id),['pw']);
  // Menus and Cmd+Tab act on the shown tabs only.
  assert.deepEqual(f.manager.menu(a.id).map(i=>i.enabled),[true,false,false]);
  f.service.setGroup('gh');assert.equal(f.manager.activeTabId,b.id);assert.deepEqual(f.manager.snapshot().tabs.map(t=>t.threadId),['b']);
  f.manager.newTab('ph');const draft=[...f.manager.tabs.values()][2];assert.equal(f.manager.activeTabId,draft.id);
  f.service.setGroup('gw');assert.equal(f.manager.activeTabId,a.id,'Work gets its last tab back');
  f.service.setGroup('gh');assert.equal(f.manager.activeTabId,draft.id,'Home gets its New chat tab back');
  assert.deepEqual(f.manager.snapshot().tabs.map(t=>t.kind),['session','new']);
  // A selection on a hidden connection never activates its tab while another group shows.
  f.service.setGroup('gw');f.snapshot.selectedThreadId='b';f.manager.sync(f.snapshot);
  assert.equal(f.manager.activeTabId,a.id);assert.deepEqual(f.manager.snapshot().tabs.map(t=>t.threadId),['a']);
  // All shows every tab again.
  f.service.setGroup(null);assert.equal(f.manager.snapshot().tabs.length,3);assert.equal(f.manager.snapshot().channels.length,2);
});
test('each session has one secure retained WebContentsView; activation never destroys another tab', async()=>{
  const f=fixture();await f.service.selectThread('a');const a=[...f.manager.tabs.values()][0];await f.service.selectThread('b');const b=[...f.manager.tabs.values()][1];
  assert.equal(a.view.visible,false);assert.equal(b.view.visible,true);
  f.manager.activate(a.id);assert.equal(f.views.length,2);assert.equal(a.view.visible,true);assert.equal(b.view.webContents.destroyed,false);
  await f.service.selectThread('a');assert.equal(f.manager.tabs.size,2);
  assert.deepEqual(a.view.options.webPreferences,{preload:'/app/preload/index.cjs',additionalArguments:['--hermes-tab-view'],nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,webviewTag:false,allowRunningInsecureContent:false});
  assert.equal(f.manager.snapshot(a.view.webContents).messages[0].text,'a');assert.equal(f.manager.snapshot(b.view.webContents).messages[0].text,'b');
  assert.equal(f.manager.snapshot().messages.length,0);assert.equal(f.manager.target(b.view.webContents),'b');
  f.manager.dispose();assert.ok(a.view.webContents.destroyed);assert.ok(b.view.webContents.destroyed);
});
test('new tab promotes in place; closing active tab activates adjacent new tab without recreating session', async()=>{
  const f=fixture();await f.service.selectThread('a');const a=[...f.manager.tabs.values()][0];f.manager.newTab('p');const draft=[...f.manager.tabs.values()][1];
  assert.throws(()=>f.manager.target(draft.view.webContents),/unavailable/);
  const view=draft.view;draft.threadId='b';f.manager.complete(view.webContents);
  assert.equal(f.manager.tabs.size,2);assert.equal(draft.id,f.manager.activeTabId);assert.equal(draft.view,view);assert.equal(draft.kind,'session');
  f.manager.newTab('p');const next=[...f.manager.tabs.values()][2];f.manager.activate(draft.id);f.manager.close(draft.id);
  assert.equal(f.manager.activeTabId,next.id);assert.equal(next.kind,'new');assert.deepEqual(f.closed,['b']);assert.equal(a.view.webContents.destroyed,false);
});
test('modal coverage silences and deactivates all tabs; identity changes and window close release every view',async()=>{
  const f=fixture();await f.service.selectThread('a');const tab=[...f.manager.tabs.values()][0];
  f.manager.setBounds({x:280,y:48,width:1000,height:772,visible:false});assert.equal(tab.view.visible,false);assert.equal(tab.view.webContents.muted,true);assert.equal(f.manager.snapshot(tab.view.webContents).tabActive,false);
  f.manager.setBounds({x:0,y:48,width:1280,height:772,visible:true});assert.equal(tab.view.visible,true);assert.equal(tab.view.bounds.x,0);
  assert.throws(()=>f.manager.authorize(new Contents(),'file:///app/index.html'),/Untrusted/);
  f.snapshot.connectionKey='another';f.snapshot.selectedThreadId=undefined;f.manager.sync(f.snapshot);assert.equal(f.manager.tabs.size,0);assert.equal(tab.view.webContents.destroyed,true);
});
test('tab menu: close tab, close tabs to the right and close other tabs keep tab order and active page', async()=>{
  const f=fixture();f.snapshot.threads.push({id:'c',channelId:'p',title:'c',running:false},{id:'d',channelId:'p',title:'d',running:false});
  for(const id of ['a','b','c','d']) await f.service.selectThread(id);
  const [a,b,c,d]=[...f.manager.tabs.values()];
  assert.deepEqual(f.manager.menu(d.id).map(i=>[i.action,i.label,i.enabled]),[['close','Close Tab',true],['close-right','Close Tabs to the Right',false],['close-others','Close Other Tabs',true]]);
  assert.equal(f.manager.menu(a.id)[1].enabled,true);
  // Active tab d is to the right of b: closing it activates b, the menu's tab.
  d.view.webContents.focused=false;
  f.manager.menuAction(b.id,'close-right');
  assert.deepEqual([...f.manager.tabs.keys()],[a.id,b.id]);assert.equal(f.manager.activeTabId,b.id);
  assert.ok(c.view.webContents.destroyed&&d.view.webContents.destroyed);assert.equal(b.view.webContents.focused,true);
  assert.deepEqual(f.closed.slice(-2).sort(),['c','d']);
  // An inactive right side leaves the active tab unchanged.
  await f.service.selectThread('c');const c2=[...f.manager.tabs.values()][2];f.manager.activate(a.id);
  f.manager.menuAction(b.id,'close-right');assert.equal(f.manager.activeTabId,a.id);assert.equal(c2.view.webContents.destroyed,true);
  f.manager.menuAction(b.id,'close-others');assert.deepEqual([...f.manager.tabs.keys()],[b.id]);assert.equal(f.manager.activeTabId,b.id);
  assert.equal(f.manager.menu(b.id)[2].enabled,false);
  f.manager.menuAction(b.id,'close');assert.equal(f.manager.tabs.size,0);assert.equal(f.manager.activeTabId,undefined);
  assert.throws(()=>f.manager.menu('missing'),/unavailable/);
});
test('tab menu keeps a busy tab open and still closes the other tabs', async()=>{
  const f=fixture();f.snapshot.threads.push({id:'c',channelId:'p',title:'c',running:false});
  for(const id of ['a','b','c']) await f.service.selectThread(id);
  const [a,b,c]=[...f.manager.tabs.values()];b.busy=true;
  assert.throws(()=>f.manager.menuAction(a.id,'close-others'),/Wait/);
  assert.deepEqual([...f.manager.tabs.keys()],[a.id,b.id]);assert.equal(c.view.webContents.destroyed,true);assert.equal(f.manager.activeTabId,a.id);
});
test('opening a session or a new tab focuses its view; a background sync does not steal focus', async()=>{
  const f=fixture();await f.service.selectThread('a');const a=[...f.manager.tabs.values()][0];
  assert.equal(a.view.webContents.focused,true);
  a.view.webContents.focused=false;f.manager.sync(f.snapshot);assert.equal(a.view.webContents.focused,false);
  f.manager.newTab('p');const draft=[...f.manager.tabs.values()][1];assert.equal(draft.view.webContents.focused,true);
  a.view.webContents.focused=false;a.view.webContents.emit('did-finish-load');assert.equal(a.view.webContents.focused,false);
  draft.view.webContents.focused=false;draft.view.webContents.emit('did-finish-load');assert.equal(draft.view.webContents.focused,true);
});
test('the window becoming active focuses only a visible Session page and asks it to focus its composer', async()=>{
  const f=fixture();await f.service.selectThread('a');const a=[...f.manager.tabs.values()][0];
  const asked=tab=>(tab.view.webContents.channels??[]).filter(n=>n==='desktop:focus-composer').length;
  a.view.webContents.focused=false;f.manager.windowFocused();
  assert.equal(a.view.webContents.focused,true);assert.equal(asked(a),1);
  f.manager.setBounds({x:280,y:48,width:1000,height:772,visible:false});a.view.webContents.focused=false;f.manager.windowFocused();
  assert.equal(a.view.webContents.focused,false,'a dialog in the main window covers the page: no focus change');assert.equal(asked(a),1);
  f.manager.setBounds({x:280,y:48,width:1000,height:772,visible:true});
  f.manager.newTab('p');const draft=[...f.manager.tabs.values()][1];draft.view.webContents.focused=false;a.view.webContents.focused=false;f.manager.windowFocused();
  assert.equal(draft.view.webContents.focused,false,'New chat page is not a Session page');assert.equal(asked(draft),0);assert.equal(a.view.webContents.focused,false,'hidden tabs never take focus');
  f.manager.openAutomation('job-1','Daily');const job=[...f.manager.tabs.values()][2];job.view.webContents.focused=false;f.manager.windowFocused();
  assert.equal(job.view.webContents.focused,false);assert.equal(asked(job),0);
  f.manager.dispose();f.manager.windowFocused();
});
test('an automation opens one tab per job without selecting a session; its page targets only its own job', async()=>{
  const f=fixture();await f.service.selectThread('a');const session=[...f.manager.tabs.values()][0];
  f.manager.openAutomation('job-1','Daily digest');const tab=[...f.manager.tabs.values()][1];
  assert.equal(tab.kind,'automation');assert.equal(f.manager.activeTabId,tab.id);assert.equal(f.snapshot.selectedThreadId,undefined);assert.equal(tab.view.webContents.focused,true);
  const page=f.manager.snapshot(tab.view.webContents);
  assert.equal(page.tabKind,'automation');assert.equal(page.automationId,'job-1');assert.equal(page.selectedThreadId,undefined);assert.equal(page.messages.length,0);
  assert.deepEqual(f.manager.snapshot().tabs.map(t=>[t.kind,t.title,t.automationId]),[['session','a',undefined],['automation','Daily digest','job-1']]);
  // Session actions from the Automation page have no target; only its own job is readable.
  assert.throws(()=>f.manager.target(tab.view.webContents),/unavailable/);
  assert.equal(f.manager.automationTarget(tab.view.webContents).automationId,'job-1');
  assert.throws(()=>f.manager.automationTarget(session.view.webContents),/unavailable/);
  // Opening the same job again activates the existing tab.
  f.manager.activate(session.id);f.manager.openAutomation('job-1','Daily digest');
  assert.equal(f.manager.tabs.size,2);assert.equal(f.manager.activeTabId,tab.id);
  f.manager.setTabTitle(tab,'Renamed digest');assert.equal(f.manager.snapshot().tabs[1].title,'Renamed digest');
  // A conversation opened from the page gets its own session tab.
  await f.service.selectThread('b');assert.equal(f.manager.tabs.size,3);assert.equal(f.manager.tabs.get(f.manager.activeTabId).threadId,'b');
  assert.throws(()=>f.manager.openAutomation('gone:job','Old'),/unavailable/);assert.equal(f.manager.tabs.size,3);
  // A deleted job closes its tab and bumps the version that makes the lists reload.
  const version=f.manager.snapshot().automationsVersion;
  f.manager.openAutomation('job-2','Weekly');const weekly=f.manager.tabs.get(f.manager.activeTabId);
  f.manager.automationDeleted('job-2');
  assert.equal(weekly.view.webContents.destroyed,true);assert.equal(f.manager.tabs.has(weekly.id),false);
  assert.equal(f.manager.snapshot().automationsVersion,version+1);assert.equal(f.manager.snapshot(tab.view.webContents).automationsVersion,version+1);
  assert.equal(f.manager.tabs.has(tab.id),true);
  // Removing the connection closes the Automation tab with the others.
  f.snapshot.connectionKey='another';f.snapshot.selectedThreadId=undefined;f.manager.sync(f.snapshot);assert.equal(tab.view.webContents.destroyed,true);
});

test('Automations list tab is single and may list jobs; a New automation tab carries the editor flag', async()=>{
  const f=fixture();await f.service.selectThread('a');const session=[...f.manager.tabs.values()][0];
  f.manager.openAutomationList();const list=[...f.manager.tabs.values()][1];
  assert.equal(list.kind,'automations');assert.equal(f.manager.activeTabId,list.id);assert.equal(f.snapshot.selectedThreadId,undefined);
  assert.equal(f.manager.isAutomationList(list.view.webContents),true);assert.equal(f.manager.isAutomationList(session.view.webContents),false);
  assert.throws(()=>f.manager.target(list.view.webContents),/unavailable/);assert.throws(()=>f.manager.automationTarget(list.view.webContents),/unavailable/);
  f.manager.activate(session.id);f.manager.openAutomationList();assert.equal(f.manager.tabs.size,2);assert.equal(f.manager.activeTabId,list.id);
  f.manager.newTab('p',true);const draft=[...f.manager.tabs.values()][2];
  assert.equal(draft.kind,'new');assert.equal(draft.automationEditor,true);assert.equal(f.manager.snapshot(draft.view.webContents).automationEditor,true);
  assert.deepEqual(f.manager.snapshot().tabs.map(t=>[t.kind,t.title,t.automationEditor===true]),[['session','a',false],['automations','Automations',false],['new','New automation',true]]);
  f.manager.newTab('p');const plain=[...f.manager.tabs.values()][3];assert.equal(plain.automationEditor,undefined);assert.equal(f.manager.snapshot(plain.view.webContents).automationEditor,undefined);
});

/** Side chats (docs/side-chat.md): Session `a` has side chats `s1` (anchor 4) and `s2` (anchor 6); `b` is another Session. */
function sideFixture() {
  const views = [], closed = [], opened = [], focus = [];
  const snapshot = { revision: 1, phase: 'connected', connectionKey: 'identity', channels: [{ id:'p', name:'Project' }], messages: [], interactions: [], canLoadOlder: false,
    threads: [{id:'a',channelId:'p',title:'a',running:false},{id:'b',channelId:'p',title:'b',running:false},
      {id:'s1',channelId:'p',title:'Side: one',running:false,sideOf:{threadId:'a',anchorRefSeq:4}},{id:'s2',channelId:'p',title:'Side: two',running:false,sideOf:{threadId:'a',anchorRefSeq:6}}] };
  const window = { webContents: new Contents(), contentView: { addChildView(v){views.push(v);}, removeChildView(v){views.splice(views.indexOf(v),1);} }, isDestroyed:()=>false, getContentSize:()=>[1280,820], title:'Hermes', getTitle(){return this.title;}, setTitle(value){this.title=value;} };
  const browser = { mode: 'sidebar', states: {}, state(id){return this.states[id];}, layout(active, visible){this.last={active,visible};}, remove(id){delete this.states[id];} };
  const service = { snapshot(id){return {...snapshot, selectedThreadId:id ?? snapshot.selectedThreadId, messages:id ? [{id:`${id}-message`,role:'assistant',text:id,toolCalls:[],attachments:[]}] : []};},
    selectThread(id, activate = true){ if (!activate) { opened.push(id); return Promise.resolve(); } snapshot.selectedThreadId=id; manager.sync(snapshot); return Promise.resolve(); },
    deactivateThread(){snapshot.selectedThreadId=undefined;manager.sync(snapshot);}, closeSessionPage(id){closed.push(id);},
    openMessage(id, ref){focus.push([id,ref]);return Promise.resolve();}, sideReplyText(id, ref){return id==='s1'&&ref===9?'From side chat [Side: one](hermesapp://session/s1):\n\nResult':undefined;},
    hasConnection(key){return !!key && key===snapshot.connectionKey;}, connectionForChannel(){return snapshot.connectionKey;}, connectionForAutomation(){return snapshot.connectionKey;},
    activeGroupId(){return null;}, visibleConnectionKeys(){return new Set([snapshot.connectionKey]);} };
  const manager = new DesktopTabManager(window, service, '/app/main', ()=>{}, browser);
  manager.setBounds({x:280,y:48,width:600,height:772,visible:true});
  return {manager,service,snapshot,views,closed,opened,focus,browser,window};
}
test('side chat: opens in the source Session tab\'s right column, not as a tab; its page stays while hidden', async()=>{
  const f=sideFixture();
  f.manager.openSideChat('s1');
  assert.equal(f.manager.tabs.size,1,'the side chat gets no tab of its own');
  const [a]=[...f.manager.tabs.values()], [panel]=[...f.manager.panels.values()];
  assert.equal(a.threadId,'a');assert.equal(f.manager.activeTabId,a.id);assert.equal(f.snapshot.selectedThreadId,'a');
  assert.deepEqual(f.opened,['s1'],'the side chat page opens without becoming the selected Session');
  const shell=f.manager.snapshot();
  assert.deepEqual(shell.sidePanels,[{id:panel.id,threadId:'s1',title:'Side: one'}]);assert.equal(shell.rightTab,panel.id);
  assert.deepEqual(shell.tabs.map(t=>t.threadId),['a']);
  // The panel shows only after the main window reports its slot.
  assert.equal(panel.view.visible,false);assert.equal(f.manager.snapshot(panel.view.webContents).tabActive,false);
  f.manager.setSideBounds({x:900,y:90,width:380,height:730,visible:true});
  assert.equal(panel.view.visible,true);assert.deepEqual(panel.view.bounds,{x:900,y:90,width:380,height:730,visible:true});assert.equal(a.view.visible,true);
  const page=f.manager.snapshot(panel.view.webContents);
  assert.equal(page.sidePanel,true);assert.equal(page.selectedThreadId,'s1');assert.equal(page.tabActive,true);assert.equal(page.messages[0].text,'s1');
  assert.equal(f.manager.target(panel.view.webContents),'s1','panel actions go to the side chat');
  assert.equal(f.manager.browserOwner(panel.view.webContents),a,'the panel uses its tab\'s browser');
  // Another tab hides the panel; coming back shows the same page (reading position and draft stay in it).
  await f.service.selectThread('b');const b=[...f.manager.tabs.values()][1];
  assert.equal(panel.view.visible,false);assert.equal(f.manager.snapshot().sidePanels,undefined);
  f.manager.activate(a.id);assert.equal(panel.view.visible,true);assert.equal(panel.view.webContents.destroyed,false);
  assert.equal(f.manager.panels.size,1);assert.equal(b.view.visible,false);
});
test('side chat: several panels are tabs; the browser hides them while in front; closing shows a neighbour', async()=>{
  const f=sideFixture();f.manager.openSideChat('s1');f.manager.openSideChat('s2');
  f.manager.setSideBounds({x:900,y:90,width:380,height:730,visible:true});
  const [p1,p2]=[...f.manager.panels.values()], a=[...f.manager.tabs.values()][0];
  assert.equal(f.manager.tabs.size,1);assert.equal(f.manager.snapshot().rightTab,p2.id);
  assert.equal(p1.view.visible,false);assert.equal(p2.view.visible,true);assert.equal(f.browser.last.visible,false,'a panel in front hides the browser page');
  f.manager.openSideChat('s1');assert.equal(f.manager.panels.size,2,'an open side chat is brought to the front, not opened twice');assert.equal(p1.view.visible,true);
  // The browser opens: it comes to the front; the panels stay.
  f.browser.states[a.id]={open:true};f.manager.publish();
  assert.equal(f.manager.snapshot().rightTab,'browser');assert.equal(p1.view.visible,false);assert.equal(f.browser.last.visible,true);
  f.manager.selectRightTab(p2.id);assert.equal(p2.view.visible,true);assert.equal(f.browser.last.visible,false);
  assert.throws(()=>f.manager.selectRightTab('missing'),/unavailable/);
  f.manager.closeSide(p2.id);assert.equal(f.manager.snapshot().rightTab,'browser','closing the front panel shows the browser when it is open');
  assert.equal(p2.view.webContents.destroyed,true);assert.deepEqual(f.closed,['s2']);
  delete f.browser.states[a.id];f.manager.publish();assert.equal(f.manager.snapshot().rightTab,p1.id,'the browser closed: the side chat comes back');
  f.manager.closeSide(p1.id);assert.equal(f.manager.snapshot().sidePanels,undefined);assert.equal(f.manager.snapshot().rightTab,undefined);
});
test('side chat: a link or search selection opens the panel; archive and tab close remove it', async()=>{
  const f=sideFixture();
  await f.service.selectThread('s2');
  assert.deepEqual([...f.manager.tabs.values()].map(t=>t.threadId),['a'],'a selected side chat opens in its source tab');
  assert.equal(f.snapshot.selectedThreadId,'a');assert.deepEqual([...f.manager.panels.values()].map(p=>p.threadId),['s2']);
  // Archived (gone from the catalogue): its panel closes.
  f.snapshot.threads=f.snapshot.threads.filter(t=>t.id!=='s2');f.manager.sync(f.snapshot);
  assert.equal(f.manager.panels.size,0);assert.ok(f.closed.includes('s2'));
  f.manager.openSideChat('s1');const panel=[...f.manager.panels.values()][0], a=[...f.manager.tabs.values()][0];
  f.manager.close(a.id);assert.equal(f.manager.panels.size,0);assert.equal(panel.view.webContents.destroyed,true);assert.ok(f.closed.includes('s1'));
  assert.throws(()=>f.manager.openSideChat('b'),/unavailable/,'a plain Session is not a side chat');
});
test('side chat: Send to main fills the source composer; the anchor button scrolls the source Session', async()=>{
  const f=sideFixture();f.manager.openSideChat('s1');
  const panel=[...f.manager.panels.values()][0], a=[...f.manager.tabs.values()][0];
  f.manager.sendToMain(panel.view.webContents,9);
  const index=a.view.webContents.channels.lastIndexOf('desktop:fill-composer');
  assert.ok(index>=0);assert.equal(a.view.webContents.sent[index],'From side chat [Side: one](hermesapp://session/s1):\n\nResult');assert.equal(a.view.webContents.focused,true);
  assert.throws(()=>f.manager.sendToMain(panel.view.webContents,1),/unavailable/);
  assert.throws(()=>f.manager.sendToMain(a.view.webContents,9),/unavailable/,'only a side chat panel sends to main');
  await f.manager.focusSideAnchor(panel.id);assert.deepEqual(f.focus,[['a',4]]);
  // Cmd+W in the panel closes the panel, not the tab.
  const event={preventDefault(){this.prevented=true;}};panel.view.webContents.emit('before-input-event',event,{type:'keyDown',meta:true,key:'w'});
  assert.ok(event.prevented);assert.equal(f.manager.panels.size,0);assert.equal(f.manager.tabs.size,1);
});
