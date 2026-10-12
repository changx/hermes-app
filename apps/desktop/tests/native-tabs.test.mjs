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
  focus() { this.focused = true; } isCrashed() { return false; }
}
class View { webContents = new Contents(); constructor(options) { this.options = options; } setVisible(v) { this.visible = v; } setBounds(v) { this.bounds = v; } }
const mod = { exports: {} };
new Function('require','module','exports',compiled.outputFiles[0].text)(name => name === 'electron' ? { WebContentsView: View } : require(name), mod, mod.exports);
const { DesktopTabManager } = mod.exports;
function fixture() {
  const views = [], closed = [], snapshot = { revision: 1, phase: 'connected', connectionKey: 'identity', channels: [{ id:'p', name:'Project' }],
    threads: ['a','b'].map(id=>({id, channelId:'p', title:id, running:false})), messages: [], interactions: [], canLoadOlder: false };
  const window = { webContents: new Contents(), contentView: { addChildView(v){views.push(v);}, removeChildView(v){views.splice(views.indexOf(v),1);} }, isDestroyed:()=>false, getContentSize:()=>[1280,820] };
  const service = { snapshot(id){return {...snapshot, selectedThreadId:id ?? snapshot.selectedThreadId, messages:id ? [{id:`${id}-message`,role:'assistant',text:id,toolCalls:[],attachments:[]}] : []};},
    selectThread(id){snapshot.selectedThreadId=id; manager.sync(snapshot); return Promise.resolve();}, deactivateThread(){snapshot.selectedThreadId=undefined;manager.sync(snapshot);},
    closeSessionPage(id){closed.push(id);manager.sync(snapshot);},
    hasConnection(key){return !!key && key===snapshot.connectionKey;}, connectionForChannel(){return snapshot.connectionKey;},
    connectionForAutomation(id){if(id.startsWith('gone:'))throw new Error('Connection unavailable');return snapshot.connectionKey;} };
  const manager = new DesktopTabManager(window, service, '/app/main', ()=>{});
  return {manager,service,snapshot,views,closed,window};
}
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
  // Removing the connection closes the Automation tab with the others.
  f.snapshot.connectionKey='another';f.snapshot.selectedThreadId=undefined;f.manager.sync(f.snapshot);assert.equal(tab.view.webContents.destroyed,true);
});
