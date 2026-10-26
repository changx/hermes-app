// Run with HERMES_TEST_ELECTRON=1 under Linux/Xvfb. Transport and storage are controlled fixtures;
// BrowserWindow, WebContentsView, production renderers, preload, IPC and real input events run unchanged.
// The native menu is captured (Menu.buildFromTemplate) because Xvfb cannot click a native popup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);

test('Electron: page right-click menu (copy, web search, find in page, Hermes search) and search shortcuts', { skip: !process.env.HERMES_TEST_ELECTRON, timeout: 90000 }, async () => {
  const root = new URL('..', import.meta.url).pathname, folder = await mkdtemp(join(tmpdir(), 'hermes-page-menu-'));
  try {
    await cp(join(root, 'dist'), join(folder, 'dist'), { recursive: true });
    const candidate = await build({ entryPoints: [join(root, 'src/main/index.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], write: false,
      plugins: [{ name: 'test-only-exports', setup(builder) { builder.onLoad({ filter: /src\/main\/index\.ts$/ }, async args => ({ contents: await readFile(args.path, 'utf8') + '\nexport {service}; export const nativeTabsForTest=()=>tabs; export const browserForTest=()=>browser;\n', loader: 'ts' })); } }] });
    await writeFile(join(folder, 'dist/main/index.cjs'), candidate.outputFiles[0].text);
    const harness = String.raw`
const electron=require('electron'),{app,BrowserWindow,clipboard,Menu,shell:system}=electron;const external=[];system.openExternal=async url=>{external.push(url);}; const assert=require('node:assert/strict'); const path=require('node:path');
app.setPath('userData',path.join(__dirname,'user-data'));app.commandLine.appendSwitch('disable-gpu');
const menus=[];
const {service:accounts,nativeTabsForTest,browserForTest}=require('./dist/main/index.cjs');
const service=accounts.primary, pages=new Map(), a='th_aaaaaaaa', b='th_bbbbbbbb', opened=[];
const text=i=>i===3?'Ocean**Pay** compliance plan':i===7?'oceanpay rollout notes':i===9?'Budget for OCEANPAY review':'Controlled fixture row '+(i+1);
const rows=id=>Array.from({length:12},(_,i)=>({id:id+'_'+i,ref_seq:i+1,role:'assistant',text:text(i)}));
const server=new Map([[a,rows(a)],[b,rows(b)]]);
const client={channels:new Map([['p',{id:'p',name:'Project Alpha'}]]),threads:new Map([[a,{id:a,project_id:'p',title:'Session A',running:false,last_message_at:Date.now()/1000}],[b,{id:b,project_id:'p',title:'Session B',running:false,last_message_at:1}]]),messages:new Map(),receipts:new Map(),interactions:new Map(),attachments:new Map(),supportsLatest:true,isCatalogueReady:true,
 isThreadAvailable(id){return this.threads.has(id);},page:id=>pages.get(id),releasePage(id){pages.delete(id);this.messages.delete(id);},
 acquirePage(id){if(!pages.has(id))pages.set(id,{messages:client.messages,currentOlderCursor:undefined,async openConversation(){client.messages.set(id,server.get(id));service.changed();},async loadFullHistory(){}});return pages.get(id);},
 async markResultRead(){},close(){pages.clear();client.messages.clear();}};
service.initialize=async()=>{service.phase='connected';service.connectionState='online';service.connection={id:'a'.repeat(24),baseUrl:'https://controlled.example.test',token:'controlled-test-only'};service.client=client;service.selectedChannelId='p';service.outboxStore={async put(){},async remove(){},async clear(){}};service.localDraftStore={async list(){return {}},async put(){},async clear(){}};service.changed();};
const evaluate=(contents,code)=>Promise.race([contents.executeJavaScript(code,true),new Promise((_,reject)=>setTimeout(()=>reject(Error('Renderer timeout: '+code.slice(0,120))),8000))]);
async function until(check,label){console.log('CHECK '+label);const end=Date.now()+15000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,25));}throw Error('Timed out: '+label);}
const key=(contents,keyCode,modifiers=[])=>{contents.sendInputEvent({type:'keyDown',keyCode,modifiers});contents.sendInputEvent({type:'keyUp',keyCode,modifiers});};
const labels=template=>template.map(item=>item.type==='separator'?'—':item.label);
// selector: a CSS selector, or 'selection' for the middle of the selected text.
async function rightClick(contents,selector){
  const box=selector==='selection'?'getSelection().getRangeAt(0).getBoundingClientRect()':'document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect()';
  const point=await evaluate(contents,'(()=>{const r='+box+';return {x:Math.round(r.left+Math.min(20,r.width/2)),y:Math.round(r.top+r.height/2)}})()');
  const before=menus.length;
  contents.sendInputEvent({type:'mouseDown',...point,button:'right',clickCount:1});contents.sendInputEvent({type:'mouseUp',...point,button:'right',clickCount:1});
  await until(()=>menus.length>before,'menu for '+selector);return menus.at(-1);
}
const choose=(template,prefix)=>{const item=template.find(entry=>entry.label?.startsWith(prefix));assert.ok(item,'menu item '+prefix+' in '+labels(template).join(' | '));item.click();};
const select=(contents,selector,word)=>evaluate(contents,'(()=>{const e=[...document.querySelectorAll('+JSON.stringify(selector)+')].find(n=>n.textContent.includes('+JSON.stringify(word)+'));const w=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let t;while((t=w.nextNode())&&!t.nodeValue.includes('+JSON.stringify(word)+'));const i=t.nodeValue.indexOf('+JSON.stringify(word)+'),r=document.createRange();r.setStart(t,i);r.setEnd(t,i+'+word.length+');getSelection().removeAllRanges();getSelection().addRange(r);return getSelection().toString()})()');
const findState=contents=>evaluate(contents,'({open:!!document.querySelector(".find-bar"),value:document.querySelector(".find-bar input")?.value,count:document.querySelector(".find-bar-count")?.textContent,focused:document.activeElement===document.querySelector(".find-bar input"),all:CSS.highlights.get("hermes-find")?.size??0,current:[...(CSS.highlights.get("hermes-find-current")??[])].map(r=>r.toString()).join()})');
(async()=>{
 await app.whenReady();await until(()=>BrowserWindow.getAllWindows().length,'window');Menu.buildFromTemplate=template=>{menus.push(template);return {popup(){}};};const window=BrowserWindow.getAllWindows()[0], shell=window.webContents;
 await until(()=>evaluate(shell,'!!document.querySelector(".native-workspace")'),'production workspace');
 const manager=nativeTabsForTest(), browser=browserForTest(); browser.open=async(id,url)=>{opened.push([id,url]);};
 await evaluate(shell,'window.hermesDesktop.selectThread("'+a+'")');const tab=[...manager.tabs.values()][0],ac=tab.view.webContents;
 await until(()=>evaluate(ac,'document.querySelectorAll(".message-assistant").length===12'),'session A history');
 const modifier=process.platform==='darwin'?'meta':'control';
 // 0. The window title bar shows the active Session's title, and follows a rename.
 await until(()=>window.getTitle()==='Session A','window title is the Session title');
 client.threads.set(a,{...client.threads.get(a),title:'  Renamed\n session A '});service.changed();
 await until(()=>window.getTitle()==='Renamed session A','window title follows a rename (one line)');
 // The page <title> does not replace it.
 await evaluate(shell,'document.title="Page title"');await new Promise(r=>setTimeout(r,200));assert.equal(window.getTitle(),'Renamed session A');

 // 1. Selected message text: Copy, then the three searches with their shortcuts.
 assert.equal(await select(ac,'.message-assistant','rollout notes'),'rollout notes');
 let menu=await rightClick(ac,'selection');
 assert.deepEqual(labels(menu),['Copy','—','Search the Web for “rollout notes”','Find “rollout notes” in Page','Search Hermes for “rollout notes”']);
 assert.deepEqual(menu.filter(item=>item.label).map(item=>[item.accelerator,item.registerAccelerator]),[['CmdOrCtrl+C',false],['Shift+CmdOrCtrl+E',false],['CmdOrCtrl+E',false],['CmdOrCtrl+K',false]]);
 await clipboard.writeText('before');choose(menu,'Copy');await until(async()=>(await clipboard.readText())==='rollout notes','Copy writes the selection');
 choose(menu,'Search the Web');await until(()=>opened.length===1,'web search opens');
 assert.deepEqual(opened[0],[tab.id,'https://www.google.com/search?q=rollout%20notes'],'Google search in this tab\'s browser panel');

 // 2. Find in page from the menu: the selection fills the find bar; matches ignore case and cross inline markup.
 await select(ac,'.message-assistant','oceanpay');menu=await rightClick(ac,'selection');choose(menu,'Find “oceanpay”');
 await until(async()=>{const s=await findState(ac);return s.open&&s.value==='oceanpay'&&s.count==='1 of 3'&&s.focused&&s.all===2&&s.current==='OceanPay';},'find bar with 3 matches, first is the bold-split OceanPay');
 if(process.env.HERMES_NATIVE_EVIDENCE){const fs=require('node:fs');fs.mkdirSync(process.env.HERMES_NATIVE_EVIDENCE,{recursive:true});fs.writeFileSync(path.join(process.env.HERMES_NATIVE_EVIDENCE,'find-bar.png'),(await ac.capturePage()).toPNG());}
 // Layout: the bar is inside the page at the top right; three 26 px buttons with 16 px icons; no overflow.
 const layout=await evaluate(ac,'(()=>{const b=document.querySelector(".find-bar").getBoundingClientRect(),i=document.querySelector(".find-bar input");return {left:b.left,right:innerWidth-b.right,top:b.top,width:b.width,height:b.height,buttons:[...document.querySelectorAll(".find-bar-button")].map(e=>[e.getBoundingClientRect().width,e.querySelector("svg").getBoundingClientRect().width]),inputWidth:i.getBoundingClientRect().width}})()');
 console.log('LAYOUT '+JSON.stringify(layout));
 assert.ok(layout.left>0&&layout.right===16&&layout.top===10&&layout.width===360&&layout.height<=40&&layout.inputWidth>150,'find bar placement');
 assert.deepEqual(layout.buttons,[[26,16],[26,16],[26,16]]);
 // Cmd+G / Shift+Cmd+G move through the matches (real key input in the Session page).
 key(ac,'G',[modifier]);await until(async()=>(await findState(ac)).count==='2 of 3','Cmd+G next');
 key(ac,'G',[modifier]);key(ac,'G',[modifier]);await until(async()=>(await findState(ac)).count==='1 of 3','Cmd+G wraps');
 key(ac,'G',[modifier,'shift']);await until(async()=>{const s=await findState(ac);return s.count==='3 of 3'&&s.current==='OCEANPAY';},'Shift+Cmd+G previous wraps to the last');
 key(ac,'Enter');await until(async()=>(await findState(ac)).count==='1 of 3','Enter goes to the next match');
 // Typing a new query searches again; no match says so.
 await evaluate(ac,'(()=>{const i=document.querySelector(".find-bar input");i.focus();i.setSelectionRange(i.value.length,i.value.length)})()');ac.insertText('zz');
 await until(async()=>{const s=await findState(ac);return s.value==='oceanpayzz'&&s.count==='No results'&&s.all===0&&s.current==='';},'no results');
 // A new message that matches is found without searching again.
 await evaluate(ac,'(()=>{const i=document.querySelector(".find-bar input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(i,"fixture row");i.dispatchEvent(new Event("input",{bubbles:true}))})()');
 await until(async()=>(await findState(ac)).count==='1 of 9','9 fixture rows');
 server.set(a,[...server.get(a),{id:a+'_new',ref_seq:13,role:'assistant',text:'Controlled fixture row 13'}]);client.messages.set(a,server.get(a));service.changed();
 await until(async()=>(await findState(ac)).count==='1 of 10','new message counted');
 key(ac,'Escape');await until(async()=>{const s=await findState(ac);return !s.open&&s.all===0&&s.current==='';},'Escape closes and clears the highlights');

 // 3. Cmd+F from the main window opens the find bar in the active Session page, with the keyboard focus.
 shell.focus();key(shell,'F',[modifier]);
 await until(async()=>{const s=await findState(ac);return s.open&&s.focused;},'Cmd+F from the main window');
 ac.insertText('budget');await until(async()=>(await findState(ac)).count==='1 of 1','typed query');
 key(ac,'Escape');await until(async()=>!(await findState(ac)).open,'closed');
 // Cmd+E finds the selected text.
 await select(ac,'.message-assistant','compliance');key(ac,'E',[modifier]);
 await until(async()=>{const s=await findState(ac);return s.value==='compliance'&&s.count==='1 of 1'&&s.focused;},'Cmd+E finds the selection');
 key(ac,'Escape');await until(async()=>!(await findState(ac)).open,'closed again');

 // 4. Shift+Cmd+E searches the web for the selection.
 await select(ac,'.message-assistant','compliance plan');key(ac,'E',[modifier,'shift']);
 await until(()=>opened.length===2,'Shift+Cmd+E web search');assert.deepEqual(opened[1],[tab.id,'https://www.google.com/search?q=compliance%20plan']);

 // 5. Search Hermes from the menu: the main window's search opens with the selected text.
 await select(ac,'.message-assistant','Budget');menu=await rightClick(ac,'selection');choose(menu,'Search Hermes for');
 await until(()=>evaluate(shell,'document.querySelector(".palette input")?.value==="Budget"&&document.activeElement===document.querySelector(".palette input")'),'Hermes search with the selected text');
 await evaluate(shell,'document.querySelector(".palette input").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
 await until(()=>evaluate(shell,'!document.querySelector(".palette")'),'search closed');await until(()=>tab.view.getVisible(),'session view visible');

 // 6. No selection: Find in Page and Search Hermes. The composer gets the edit items.
 await evaluate(ac,'getSelection().removeAllRanges()');
 menu=await rightClick(ac,'.message-assistant');assert.deepEqual(labels(menu),['Find in Page…','Search Hermes…']);
 choose(menu,'Find in Page');await until(async()=>{const s=await findState(ac);return s.open&&s.focused;},'Find in Page… opens the bar');key(ac,'Escape');
 await until(async()=>!(await findState(ac)).open,'closed after menu find');
 await evaluate(ac,'document.querySelector("[aria-label=Message]").focus()');ac.insertText('draft words');
 await evaluate(ac,'(()=>{const e=document.querySelector("[aria-label=Message]");e.setSelectionRange(0,5)})()');
 menu=await rightClick(ac,'[aria-label=Message]');
 assert.deepEqual(labels(menu),['Cut','Copy','Paste','Select All','—','Search the Web for “draft”','Find “draft” in Page','Search Hermes for “draft”']);
 assert.deepEqual(menu.slice(0,4).map(item=>item.enabled),[true,true,true,true]);

 // 7. The main window: the sidebar row keeps its own Session menu (the page menu does not appear there).
 const sessionMenus=menus.length;
 await rightClick(shell,'.native-sidebar [data-thread-id]');await new Promise(r=>setTimeout(r,400));
 const rowMenus=menus.slice(sessionMenus).map(labels);
 assert.ok(rowMenus.length>=1&&rowMenus.every(row=>!row.includes('Search Hermes…')),'sidebar rows keep their own menu: '+JSON.stringify(rowMenus));
 // Plain sidebar text gets the page menu, and Find in Page acts on the active Session page.
 menu=await rightClick(shell,'.sidebar-section-title');assert.deepEqual(labels(menu),['Find in Page…','Search Hermes…']);
 choose(menu,'Find in Page');await until(async()=>(await findState(ac)).open,'main-window menu find opens in the Session page');
 // 8. Cmd+click (Ctrl+click on Linux) and a middle click open a link in the system browser; a plain click uses the browser panel.
 key(ac,'Escape');
 server.set(a,[...server.get(a),{id:a+'_links',ref_seq:14,role:'assistant',text:'See [the docs](https://example.com/docs) and [plain page](http://example.org/plain).'}]);client.messages.set(a,server.get(a));service.changed();
 await until(()=>evaluate(ac,'!!document.querySelector("a[href=\\"https://example.com/docs\\"]")'),'link message');
 const click=async(href,button,modifiers=[])=>{const p=await evaluate(ac,'(()=>{const e=document.querySelector("a[href=\\""+'+JSON.stringify(href)+'+"\\"]");e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()');
   ac.sendInputEvent({type:'mouseDown',...p,button,clickCount:1,modifiers});ac.sendInputEvent({type:'mouseUp',...p,button,clickCount:1,modifiers});};
 const panel=opened.length;
 await click('https://example.com/docs','left',[modifier]);await until(()=>external.length===1,'Cmd+click opens the system browser');
 assert.deepEqual(external,['https://example.com/docs']);assert.equal(opened.length,panel,'Cmd+click does not use the browser panel');
 await click('http://example.org/plain','middle');await until(()=>external.length===2,'middle click opens the system browser');assert.equal(external[1],'http://example.org/plain');
 await click('https://example.com/docs','left');await until(()=>opened.length===panel+1,'plain click uses the browser panel');
 assert.deepEqual(opened.at(-1),[tab.id,'https://example.com/docs']);assert.equal(external.length,2,'plain click does not open the system browser');
 // 9. Window title per active tab: another Session, New chat, and no tab.
 await evaluate(shell,'window.hermesDesktop.selectThread("'+b+'")');await until(()=>window.getTitle()==='Session B','window title after switching to Session B');
 await evaluate(shell,'window.hermesDesktop.activateTab('+JSON.stringify(tab.id)+')');await until(()=>window.getTitle()==='Renamed session A','window title back on Session A');
 await evaluate(shell,'window.hermesDesktop.newTab("p")');await until(()=>window.getTitle()==='New chat','window title for New chat');
 for(const id of [...manager.tabs.keys()])manager.close(id);await until(()=>window.getTitle()==='Hermes','window title with no tab');
 console.log('PAGE_MENU_OK '+JSON.stringify({menus:menus.length,panelOpens:opened.length,systemBrowser:external.length}));app.exit(0);
})().catch(error=>{console.error(error.stack);app.exit(1)});
`;
    await writeFile(join(folder, 'harness.cjs'), harness);
    const output = execFileSync('xvfb-run', ['-a', require('electron'), '--no-sandbox', join(folder, 'harness.cjs')], { encoding: 'utf8', timeout: 80000, env: process.env, maxBuffer: 2_000_000 });
    assert.match(output, /PAGE_MENU_OK/); console.log(output.trim());
  } finally { await rm(folder, { recursive: true, force: true }); }
});
