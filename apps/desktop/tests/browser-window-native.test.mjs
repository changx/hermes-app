// Test transport/storage are fixtures. All desktop renderers, native views, windows, preload and IPC are production code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);

test('Electron: browser moves between sidebar and one separate window per Session without reload or focus theft', { skip: !process.env.HERMES_TEST_ELECTRON, timeout: 120000 }, async () => {
  const root = new URL('..', import.meta.url).pathname, folder = await mkdtemp(join(tmpdir(), 'hermes-browser-window-'));
  try {
    await cp(join(root, 'dist'), join(folder, 'dist'), { recursive: true });
    const bundle = await build({ entryPoints: [join(root, 'src/main/index.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], write: false, plugins: [{ name: 'test-exports', setup(b) { b.onLoad({ filter: /src\/main\/index\.ts$/ }, async args => ({ contents: await readFile(args.path, 'utf8') + '\nexport {service}; export const sidebarForTest=()=>browser; export const tabsForTest=()=>tabs;\n', loader: 'ts' })); } }] });
    await writeFile(join(folder, 'dist/main/index.cjs'), bundle.outputFiles[0].text);
    await writeFile(join(folder, 'harness.cjs'), String.raw`
const {app,BrowserWindow}=require('electron');
// The sidebar Session card is a hidden, non-focusable helper window; count only the user's windows.
const appWindows=()=>BrowserWindow.getAllWindows().filter(w=>w.isFocusable());const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
app.setPath('userData',path.join(__dirname,'user-data'));app.commandLine.appendSwitch('disable-gpu');
const {service:accounts,sidebarForTest,tabsForTest}=require('./dist/main/index.cjs');
const service=accounts.primary,a='th_aaaaaaaa',b='th_bbbbbbbb',pages=new Map(),loads=[];let base;
const server=http.createServer((req,res)=>{loads.push(req.url);res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Fixture '+req.url+'</title><h1 id="page">Page '+req.url+'</h1><input id="field">');});
const client={channels:new Map([['p',{id:'p',name:'Fixture project'}]]),threads:new Map([[a,{id:a,project_id:'p',title:'Session A',last_message_at:2}],[b,{id:b,project_id:'p',title:'Session B',last_message_at:1}]]),messages:new Map(),receipts:new Map(),interactions:new Map(),attachments:new Map(),isCatalogueReady:true,supportsLatest:true,
 isThreadAvailable:id=>client.threads.has(id),page:id=>pages.get(id),releasePage(id){pages.delete(id);client.messages.delete(id);},acquirePage(id){if(!pages.has(id))pages.set(id,{messages:client.messages,async openConversation(){client.messages.set(id,[{id:'m-'+id,ref_seq:1,role:'assistant',text:'Hello',attachments:[]}]);service.changed();}});return pages.get(id);},close(){}};
service.initialize=async()=>{service.phase='connected';service.connectionState='online';service.connection={id:'a'.repeat(24),baseUrl:'https://controlled.example.test',token:'test-only-never-browser'};service.client=client;service.selectedChannelId='p';service.localDraftStore={async list(){return{}},async put(){},async clear(){}};service.changed();};
const evaluate=(contents,code)=>contents.executeJavaScript(code,true).catch(error=>{throw Error('Renderer script failed: '+code.slice(0,160)+' '+error.message)});
async function until(check,label){console.log('CHECK '+label);const end=Date.now()+12000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,25));}throw Error('Timed out: '+label);}
const prefs=()=>JSON.parse(fs.readFileSync(path.join(__dirname,'user-data','browser-window.json'),'utf8'));
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
 await app.whenReady();await until(()=>appWindows().length,'main window');const main=appWindows()[0],shell=main.webContents;
 await until(()=>evaluate(shell,'!!document.querySelector(".native-workspace")'),'workspace');
 const browser=sidebarForTest(),manager=tabsForTest();
 await evaluate(shell,'window.hermesDesktop.selectThread('+JSON.stringify(a)+')');await until(()=>manager.tabs.size===1,'session A tab');const tabA=[...manager.tabs.values()][0];
 // Built-in sidebar first, with history and live page state.
 await evaluate(shell,'window.hermesDesktop.openBrowser('+JSON.stringify(base+'/first')+')');await until(()=>browser.panes.has(tabA.id),'pane A');
 const paneA=browser.panes.get(tabA.id),webA=paneA.view.webContents;await until(()=>evaluate(webA,'!!document.querySelector("#page")'),'first page');
 await evaluate(shell,'window.hermesDesktop.openBrowser('+JSON.stringify(base+'/second')+')');await until(()=>webA.getURL()===base+'/second'&&!webA.isLoading(),'second page');
 await evaluate(webA,'document.documentElement.dataset.kept="yes";document.querySelector("#field").value="typed"');
 await until(()=>evaluate(shell,'!!document.querySelector(".browser-sidebar .browser-mode-toggle[aria-label=\'Open in separate window\']")'),'sidebar shows switch');
 const loadsBefore=loads.length,webAId=webA.id;
 // Switch from the sidebar's own button while the main window has focus.
 main.focus();shell.focus();await evaluate(shell,'document.querySelector(".browser-sidebar .browser-mode-toggle").click()');
 await until(()=>paneA.window&&paneA.window.isVisible(),'separate window shown for Session A');const winA=paneA.window;
 assert.equal(appWindows().length,2);assert.equal(winA.isFocused(),false,'separate window does not take focus');
 assert.ok(winA.contentView.children.includes(paneA.view)&&!main.contentView.children.includes(paneA.view),'page moved to the separate window');
 assert.equal(webA.id,webAId);assert.equal(loads.length,loadsBefore,'no reload');
 assert.equal(await evaluate(webA,'document.documentElement.dataset.kept+":"+document.querySelector("#field").value'),'yes:typed','live page state kept');
 assert.equal(webA.navigationHistory.canGoBack(),true,'history kept');
 assert.equal(prefs().mode,'window','mode saved on this device');
 await until(()=>evaluate(shell,'!document.querySelector(".browser-sidebar")&&!document.querySelector(".browser-resize-handle")'),'main window has no sidebar in window mode');
 await until(()=>tabA.view.getBounds().x+tabA.view.getBounds().width===main.getContentSize()[0],'conversation uses the full width');
 assert.equal(await evaluate(shell,'document.querySelector(".desktop-browser-toggle").getAttribute("aria-label")+":"+document.querySelector(".desktop-browser-toggle").getAttribute("aria-expanded")'),'Toggle browser window:true');
 const toolbarA=winA.webContents;await until(()=>evaluate(toolbarA,'document.querySelector("[aria-label=\'Browser address\']")?.value==='+JSON.stringify(base+'/second')),'window toolbar shows address');
 assert.equal(winA.getTitle(),'Fixture /second','window title is the page title');
 await until(()=>paneA.view.getVisible()&&paneA.view.getBounds().y>=40&&paneA.view.getBounds().x===0&&paneA.view.getBounds().width===winA.getContentSize()[0],'page placed under the window toolbar');
 // The toolbar window controls only its own page.
 await assert.rejects(evaluate(toolbarA,'window.hermesDesktop.newTab()'),/Browser window action unavailable/);
 await assert.rejects(evaluate(toolbarA,'window.hermesDesktop.sendMessage({text:"x",attachmentIds:[]})'),/Browser window action unavailable/);
 assert.equal(await evaluate(toolbarA,'!!document.querySelector(".native-workspace,.message-list")'),false,'no conversation content in the browser window');
 // Second Session gets its own window; neither window takes focus.
 await evaluate(shell,'window.hermesDesktop.selectThread('+JSON.stringify(b)+')');await until(()=>manager.tabs.size===2&&manager.tabs.get(manager.activeTabId)?.threadId===b,'session B tab');const tabB=manager.tabs.get(manager.activeTabId);
 await evaluate(shell,'window.hermesDesktop.openBrowser('+JSON.stringify(base+'/b')+')');await until(()=>browser.panes.get(tabB.id)?.window?.isVisible(),'separate window for Session B');
 const paneB=browser.panes.get(tabB.id),winB=paneB.window,webB=paneB.view.webContents;
 assert.equal(appWindows().length,3,'one window per Session');assert.notEqual(winA,winB);
 assert.equal(winA.isFocused()||winB.isFocused(),false,'no browser window took focus');
 await until(()=>webB.getURL()===base+'/b','session B page');assert.equal(webA.getURL(),base+'/second','session A page unchanged');
 assert.notDeepEqual(winA.getBounds(),winB.getBounds(),'second window cascades');
 // Toolbar Back in window A acts on Session A even though Session B is the active tab.
 await evaluate(toolbarA,'window.hermesDesktop.browserAction("back")');await until(()=>webA.getURL()===base+'/first','window A back');assert.equal(webB.getURL(),base+'/b');
 // Agent control still works in a separate window, without focus.
 const controller=new AbortController();const snap=await browser.command(tabA.id,'snapshot',{},controller.signal,10000);assert.match(JSON.stringify(snap),/Page \/first/);
 const shot=await browser.command(tabA.id,'screenshot',{},controller.signal,10000);assert.ok(shot.jpeg_base64.length>100);assert.equal(winA.isFocused(),false);
 // Ctrl+W in a page in a separate window closes only that window, never a workspace tab.
 webB.focus();webB.sendInputEvent({type:'keyDown',keyCode:'W',modifiers:['control']});webB.sendInputEvent({type:'keyUp',keyCode:'W',modifiers:['control']});
 await until(()=>webB.isDestroyed()&&!browser.panes.has(tabB.id)&&winB.isDestroyed(),'Ctrl+W closes only Session B browser window');assert.equal(manager.tabs.has(tabB.id),true,'Session B tab stays open');
 // Closing a window closes that Session's browser, the conversation stays, and the close is never prevented
 // (macOS quit closes this window first; a prevented close cancels the whole quit).
 let closePrevented;winA.on('close',event=>{closePrevented=event.defaultPrevented;});
 winA.close();await until(()=>webA.isDestroyed()&&!browser.panes.has(tabA.id),'closing window A closes its browser');assert.equal(manager.tabs.has(tabA.id),true);assert.equal(appWindows().length,1);
 assert.equal(closePrevented,false,'browser window close is not prevented');await until(()=>winA.isDestroyed(),'window A destroyed');
 // Reopen: window mode and placement are remembered.
 await evaluate(shell,'window.hermesDesktop.activateTab('+JSON.stringify(tabA.id)+')');
 const remembered=prefs().bounds;assert.ok(remembered&&remembered.width>=420,'window placement saved');
 await evaluate(shell,'window.hermesDesktop.openBrowser('+JSON.stringify(base+'/again')+')');await until(()=>browser.panes.get(tabA.id)?.window?.isVisible(),'reopened in a separate window');
 const pane2=browser.panes.get(tabA.id),win2=pane2.window,web2=pane2.view.webContents;await until(()=>web2.getURL()===base+'/again'&&!web2.isLoading(),'reopened page');
 assert.deepEqual({w:win2.getBounds().width,h:win2.getBounds().height},{w:remembered.width,h:remembered.height},'remembered size');
 await evaluate(web2,'document.documentElement.dataset.kept="again"');const before2=loads.length,web2Id=web2.id;
 // Switch back from the separate window's own button.
 await until(()=>evaluate(win2.webContents,'!!document.querySelector(".browser-mode-toggle[aria-label=\'Show in sidebar\']")'),'window shows switch');
 await evaluate(win2.webContents,'document.querySelector(".browser-mode-toggle").click()');
 await until(()=>win2.isDestroyed()&&!pane2.window,'separate window closed');
 assert.ok(main.contentView.children.includes(pane2.view),'page back in the main window');
 assert.equal(web2.id,web2Id);assert.equal(loads.length,before2,'no reload');assert.equal(await evaluate(web2,'document.documentElement.dataset.kept'),'again');
 await until(()=>evaluate(shell,'!!document.querySelector(".browser-sidebar")'),'sidebar back in main window');
 await until(()=>pane2.view.getVisible()&&pane2.view.getBounds().x+pane2.view.getBounds().width===main.getContentSize()[0],'page placed in the sidebar');
 assert.equal(prefs().mode,'sidebar');assert.equal(appWindows().length,1);
 // Quit with a separate browser window open: one quit request (Cmd+Q and the app menu call app.quit()) must finish.
 await evaluate(shell,'document.querySelector(".browser-sidebar .browser-mode-toggle").click()');
 await until(()=>pane2.window&&pane2.window.isVisible(),'separate window open before quit');
 app.on('will-quit',event=>{event.preventDefault();server.close();console.log('BROWSER_WINDOW_OK');app.exit(0);});
 app.quit();
 await until(()=>false,'app quits on the first request');
})().catch(error=>{console.error(error.stack);server.close();app.exit(1)});
`);
    const output = execFileSync('xvfb-run', ['-a', require('electron'), '--no-sandbox', join(folder, 'harness.cjs')], { encoding: 'utf8', timeout: 110000, env: process.env, maxBuffer: 2_000_000 });
    assert.match(output, /BROWSER_WINDOW_OK/); console.log(output.trim());
  } finally { await rm(folder, { recursive: true, force: true }); }
});
