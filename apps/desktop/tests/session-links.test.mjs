import test from 'node:test';
import { withPages } from './page-fixture.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { build, transform } from 'esbuild';
import React from 'react';
import { create, act } from 'react-test-renderer';
const root = new URL('../../../', import.meta.url).pathname;
const bundle = await build({ stdin: { contents: 'export { DesktopConnectionService } from "./apps/desktop/src/main/connection-service"; export { MessageContent } from "./apps/desktop/src/renderer/message-content"; export * from "./packages/client/src/sessionLinks"; export {validateLabels, labelTimestamp} from "./packages/client/src/sessionLabels";', resolveDir: root }, bundle: true, format: 'cjs', platform: 'node', external: ['electron','react','react/jsx-runtime'], write: false });
const mod = { exports: {} }, require = createRequire(import.meta.url);
new Function('require','module','exports',bundle.outputFiles[0].text)(require,mod,mod.exports);
const { DesktopConnectionService, MessageContent, buildSessionLink, parseSessionLink, validateLabels, labelTimestamp } = mod.exports;
const base = 'https://agent.tuly.space', url = buildSessionLink(base,'th_target');
const fixture = () => {
  const service = new DesktopConnectionService(() => {}), opened = [];
  service.connection = { id: 'local', token: 'never-in-link', baseUrl: base };
  service.client = { isCatalogueReady: true, channels: new Map([['p_one',{id:'p_one',name:'One'}]]), threads: new Map([['th_target',{id:'th_target',project_id:'p_one',title:'Target',archived:false}]]), messages:new Map(), receipts:new Map(), interactions:new Map(), attachments:new Map(),
    isThreadAvailable(id) { return this.threads.has(id) && !this.threads.get(id).archived; }, async openConversation(id) { opened.push(id); }, close() {} };
  withPages(service.client);
  return {service,opened};
};
test('desktop exact link navigates through existing selection; no duplicate reopening of current session', async () => {
  const {service,opened} = fixture(); service.openSessionLink(url); await new Promise(r=>setImmediate(r));
  assert.equal(service.selectedThreadId,'th_target'); assert.equal(service.selectedChannelId,'p_one'); assert.deepEqual(opened,['th_target']);
  assert.equal(service.sessionLink(),url); assert.ok(!service.sessionLink().includes('never-in-link'));
  service.openSessionLink(url); assert.deepEqual(opened,['th_target']); service.close();
});
test('desktop unknown, archived, malformed and wrong-server links leave current session unchanged', () => {
  const {service,opened} = fixture(); service.selectedThreadId = 'th_current';
  for (const bad of [buildSessionLink('https://other.test','th_target'),buildSessionLink(base,'th_missing'),'hermesapp://session/th_target?token=secret']) { service.openSessionLink(bad); assert.equal(service.selectedThreadId,'th_current'); assert.ok(service.snapshot().errorMessage); }
  service.client.threads.get('th_target').archived=true; service.openSessionLink(url); assert.equal(service.selectedThreadId,'th_current'); assert.deepEqual(opened,[]); service.close();
});
test('desktop cold link waits for credentials and catalogue; newest pending link wins', async () => {
  const {service,opened} = fixture(); const connection=service.connection; service.connection=null; service.client.isCatalogueReady=false;
  service.openSessionLink(buildSessionLink(base,'th_old')); service.openSessionLink(url); assert.deepEqual(opened,[]);
  service.connection=connection; service.applySessionLink(); assert.deepEqual(opened,[]);
  service.client.isCatalogueReady=true; service.changed(); await new Promise(r=>setImmediate(r)); assert.deepEqual(opened,['th_target']); service.close();
});
test('desktop production Markdown invokes purpose-specific IPC for named and bare session links; web URLs stay external', async () => {
  const calls=[]; globalThis.IS_REACT_ACT_ENVIRONMENT=true; globalThis.window={hermesDesktop:{openSessionLink:async value=>calls.push(value)}};
  for (const text of [`[Open](${url})`,url]) {
    let renderer; await act(async()=>{renderer=create(React.createElement(MessageContent,{text}));});
    const link=renderer.root.findByType('a'); assert.equal(link.props.href,url); assert.equal(link.props.target,undefined);
    let prevented=false; await act(async()=>link.props.onClick({preventDefault(){prevented=true;}})); assert.ok(prevented);
    await act(async()=>renderer.unmount());
  }
  assert.deepEqual(calls,[url,url]);
  let renderer; await act(async()=>{renderer=create(React.createElement(MessageContent,{text:'[Web](https://example.test) `'+url+'`'}));});
  assert.equal(renderer.root.findAllByType('a').length,1); assert.equal(renderer.root.findByType('a').props.target,'_blank'); await act(async()=>renderer.unmount()); delete globalThis.window;
});
test('desktop native cold, open-url and second-instance events focus the window and queue exact target', async () => {
  const handlers={},calls=[],windows=[],ipc={},copied=[],updates=[];
  let service, closedPages=0;
  let ready; const readyPromise=new Promise(r=>ready=r);
  class Service { constructor(publish){service=this;this.publish=publish} snapshot(){return {}} openSessionLink(value){calls.push(value)} async initialize(){} sessionLink(){return url} saveThreadLabels(...args){return args} close(){} closeSessionPages(){closedPages++} }
  class Window { constructor(){windows.push(this);this.handlers={}; this.webContents={send(_event,data){updates.push(data)},getURL:()=> 'file:///candidate/dist/renderer/index.html',session:{setPermissionCheckHandler(){},setPermissionRequestHandler(){}},on(){},setWindowOpenHandler(){}};} loadFile(){} once(){} on(name,fn){this.handlers[name]=fn} isDestroyed(){return !!this.destroyed} isMinimized(){return true} restore(){this.restored=true} show(){} focus(){this.focused=true} static getAllWindows(){return windows.filter(w=>!w.destroyed)} }
  const app={isPackaged:true,requestSingleInstanceLock:()=>true,isReady:()=>windows.length>0,whenReady:()=>readyPromise,on:(name,fn)=>handlers[name]=fn,setAsDefaultProtocolClient:scheme=>copied.push(scheme),quit(){}};
  const source=readFileSync(new URL('../src/main/index.ts',import.meta.url),'utf8'),{code}=await transform(source,{loader:'ts',format:'cjs'});
  new Function('require','__dirname','process',code)(name=>name==='electron'?{app,BrowserWindow:Window,clipboard:{writeText:value=>copied.push(value)},ipcMain:{handle:(name,fn)=>ipc[name]=fn},powerMonitor:{on(){}},shell:{openExternal(){throw Error('session links must stay internal')}}}:name==='./connection-service'?{DesktopConnectionService:Service}:name==='./security'?{isAllowedExternalUrl:()=>false,isSameDocumentNavigation:()=>false}:name.includes('sessionLinks')?{parseSessionLink}:name.includes('sessionLabels')?{validateLabels,labelTimestamp}:name==='../shared/snapshot-delta'?{snapshotDelta:()=>({})}:require(name),'/candidate/dist/main',{argv:['app',url],platform:'darwin'});
  let prevented=false; handlers['open-url']({preventDefault(){prevented=true}},url); assert.ok(prevented); assert.deepEqual(calls,[url]);
  ready(); await new Promise(r=>setImmediate(r)); assert.equal(copied[0],'hermesapp'); assert.equal(calls.at(-1),url);
  handlers['second-instance']({},['app',url]); assert.ok(windows[0].focused); assert.ok(windows[0].restored);
  assert.ok(ipc['desktop:open-session-link']); assert.ok(ipc['desktop:copy-session-link']);
  assert.throws(()=>ipc['desktop:open-session-link']({sender:{}},url),/Untrusted/);
  const labels = ipc['desktop:save-thread-labels'], trusted = { sender: windows[0].webContents, senderFrame: { url: windows[0].webContents.getURL() } };
  await assert.rejects(labels({sender:{}}, 'th_target', ['Foo'], 1, 'one'), /Untrusted/);
  await assert.rejects(labels(trusted, 'th_target', ['Foo', 'Foo'], 1, 'one'), /already/);
  await assert.rejects(labels(trusted, 'th_target', ['Foo'], -1, 'one'), /save time/);
  await assert.rejects(labels(trusted, 'th_target', ['Foo'], 1, 'x'.repeat(201)), /Invalid/);
  assert.deepEqual(await labels(trusted, 'th_target', ['👩🏽‍💻'.repeat(30)], 1, 'one'), ['th_target', ['👩🏽‍💻'.repeat(30)], 1, 'one']);
  assert.ok(ipc['desktop:close-session-page']);
  service.publish({revision:1,messages:['synthetic retained history']});
  assert.deepEqual(updates.at(-1).messages,['synthetic retained history']);
  assert.equal(closedPages,0,'minimize/focus does not destroy session ownership');
  windows[0].destroyed=true;windows[0].handlers.closed();assert.equal(closedPages,1);
  handlers.activate();assert.equal(windows.length,2);
  service.publish({revision:2,messages:[]});assert.equal(updates.at(-1).revision,2,'new window receives full baseline, not a delta against destroyed window');
});
