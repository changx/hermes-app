// Run with HERMES_TEST_ELECTRON=1 under Linux/Xvfb. Transport and storage are controlled fixtures;
// BrowserWindow, WebContentsView, production renderers, preload and IPC run unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
test('Electron: independent production tabs retain DOM, drafts, history and scoped IPC; New chat promotes in place', {skip: !process.env.HERMES_TEST_ELECTRON, timeout:90000}, async()=>{
  const root=new URL('..',import.meta.url).pathname, folder=await mkdtemp(join(tmpdir(),'hermes-native-tabs-'));
  try {
    await cp(join(root,'dist'),join(folder,'dist'),{recursive:true});
    const candidate=await build({entryPoints:[join(root,'src/main/index.ts')],bundle:true,platform:'node',format:'cjs',external:['electron'],write:false,
      plugins:[{name:'test-only-exports',setup(builder){builder.onLoad({filter:/src\/main\/index\.ts$/},async args=>({contents:await readFile(args.path,'utf8')+'\nexport {service}; export const nativeTabsForTest=()=>tabs; export const settingsForTest=()=>settingsWindow;\n',loader:'ts'}));}}]});
    await writeFile(join(folder,'dist/main/index.cjs'),candidate.outputFiles[0].text);
    await writeFile(join(folder,'fixture.txt'),'Controlled native attachment fixture');
    const harness=String.raw`
const {app,BrowserWindow,clipboard,ClipboardItem,nativeImage}=require('electron'); const assert=require('node:assert/strict'); const fs=require('node:fs'); const path=require('node:path');
app.setPath('userData',path.join(__dirname,'user-data'));app.commandLine.appendSwitch('disable-gpu');
const {service:accounts,nativeTabsForTest,settingsForTest}=require('./dist/main/index.cjs');
const service=accounts.primary;
const calls=[], pages=new Map(), local=new Map(), a='th_aaaaaaaa',b='th_bbbbbbbb';
const previewPng=nativeImage.createFromBitmap(Buffer.from([0,0,255,255]),{width:1,height:1}).toPNG();
const rows=id=>Array.from({length:id===a?200:8},(_,i)=>({id:id+'_'+i,ref_seq:i+1,role:'assistant',text:'Controlled fixture '+id+' row '+(i+1)}));
const server=new Map([[a,rows(a)],[b,rows(b)]]);
let modelSettings={scope:'connected-default',provider:'codex',model:'fixture-current',providers:[{id:'codex',name:'Codex',models:['fixture-current','fixture-next']}]};
const client={channels:new Map([['p',{id:'p',name:'Project Alpha'}],['q',{id:'q',name:'Project Beta'}]]),threads:new Map([[a,{id:a,project_id:'p',title:'Session A',running:false,last_message_at:Date.now()/1000,markers:['work']}],[b,{id:b,project_id:'q',title:'Session B',running:true,last_message_at:1,markers:['bug']}]]),messages:new Map(),receipts:new Map(),interactions:new Map(),attachments:new Map(),supportsLatest:true,isCatalogueReady:true,supportsSessionLabels:true,
 async getModelSettings(){calls.push(['model-read']);return structuredClone(modelSettings);},
 async setModelSettings(provider,model,_signal,confirm){calls.push(['model-write',provider,model,confirm]);if(!confirm)return {confirmation_required:true,provider,model,warning:'Controlled fixture cost warning.'};modelSettings={...modelSettings,provider,model};return structuredClone(modelSettings);},
 isThreadAvailable(id){return this.threads.has(id);},page:id=>pages.get(id),releasePage(id){pages.delete(id);this.messages.delete(id);},
 acquirePage(id){if(!pages.has(id)){const page={messages:client.messages,currentOlderCursor:undefined,
 async openConversation(){calls.push(['open',id]);client.messages.set(id,server.get(id).slice(-50));this.currentOlderCursor=id===a?'older':undefined;service.changed();},
 async loadFullHistory(){calls.push(['history',id]);client.messages.set(id,server.get(id));this.currentOlderCursor=undefined;service.changed();}};pages.set(id,page);}return pages.get(id);},
 async createThread(project,title,id){calls.push(['create',project,id]); const t={id,project_id:project,title,archived:false,last_message_at:Date.now()/1000,running:false};this.threads.set(id,t);server.set(id,[]);service.changed();return t;},
 async upload(id,name,bytes){calls.push(['upload',id,name,bytes.length]);const f={id:'att_'+('c'.repeat(32)),thread_id:id,name,mime:/\.png$/i.test(name)?'image/png':'text/plain',size:bytes.length,state:'available'};this.attachments.set(f.id,f);service.changed();return f;},
 async download(id,f){calls.push(['thumbnail',id,f]);return new Uint8Array(previewPng);},
 async send(id,messageId,text,files){calls.push(['send',id,messageId,text,files]);return {id:'receipt-'+calls.length,thread_id:id,client_message_id:messageId,state:'queued',durable:true,ref_seq:1};},
 rememberAcceptedInput(id,messageId,text,files,time,receipt){client.messages.set(id,[...(client.messages.get(id)||[]),{id:'receipt:'+receipt.id,role:'user',text,client_message_id:messageId,receipt_id:receipt.id,attachments:files,created_at:time,ref_seq:receipt.ref_seq}]);},
 async deleteUnattached(id,f){this.attachments.delete(f);},async stop(id){calls.push(['stop',id]);},async markResultRead(id){calls.push(['read',id]);},close(){pages.clear();client.messages.clear();},async getAttachment(id,f){return this.attachments.get(f);}};
service.initialize=async()=>{service.phase='connected';service.connectionState='online';service.connection={id:'a'.repeat(24),baseUrl:'https://controlled.example.test',token:'controlled-test-only'};service.client=client;service.selectedChannelId='p';service.outboxStore={async put(){},async remove(){},async clear(){}};service.localDraftStore={async list(){return Object.fromEntries(local)},async put(_identity,id,draft){local.set(id,structuredClone(draft));},async clear(){}};service.changed();};
const evaluate=(contents,code)=>Promise.race([contents.executeJavaScript(code,true).catch(error=>{throw Error('Renderer script failed: '+code.slice(0,180)+' '+error.message)}),new Promise((_,reject)=>setTimeout(()=>reject(Error('Renderer timeout: '+code.slice(0,120))),8000))]);
async function until(check,label){console.log('CHECK '+label);const end=Date.now()+15000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,25));}throw Error('Timed out: '+label);}
async function input(contents,label,text){await evaluate(contents,'(()=>{const e=document.querySelector('+JSON.stringify('[aria-label="'+label+'"]')+');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(e,'+JSON.stringify(text)+');e.dispatchEvent(new Event("input",{bubbles:true}));})()');}
(async()=>{
 await app.whenReady();await until(()=>BrowserWindow.getAllWindows().length,'window');const window=BrowserWindow.getAllWindows()[0], shell=window.webContents;
 await until(()=>evaluate(shell,'!!document.querySelector(".native-workspace")'),'production workspace');
 const manager=nativeTabsForTest();
 await evaluate(shell,'window.hermesDesktop.selectThread("'+a+'")');const first=[...manager.tabs.values()][0],ac=first.view.webContents;
 await until(()=>evaluate(ac,'!!document.querySelector(".message-list")'),'session A');
 await evaluate(ac,'window.hermesDesktop.loadOlder()');await until(()=>evaluate(ac,'document.querySelectorAll(".message-assistant").length===200'),'full history');
 await input(ac,'Message','A retained draft');await until(()=>local.get(a)?.text==='A retained draft','durable draft update');
 // OS clipboard paste exercises a real File across the sandboxed contextBridge, not a fake File adapter.
 const image=nativeImage.createFromBitmap(Buffer.from([0,0,255,255]),{width:1,height:1});
 assert.equal(image.isEmpty(),false);await clipboard.write([new ClipboardItem({'image/png':new Blob([image.toPNG()],{type:'image/png'})})]);
 await evaluate(ac,'document.querySelector("[aria-label=Message]").focus()');ac.paste();
 await until(()=>calls.some(x=>x[0]==='upload'&&x[1]===a),'native clipboard image uploaded to A');
 await until(()=>local.get(a)?.attachments.length===1,'pasted attachment persisted in A draft');
 await until(()=>evaluate(ac,'document.querySelector(".composer-attachments .attachment-thumbnail img")?.naturalWidth===1'),'uploaded clipboard image has genuine small thumbnail');
 assert.equal(await evaluate(ac,'document.querySelector(".composer-attachments .attachment-thumbnail").getBoundingClientRect().width'),40);
 assert.equal(calls.find(x=>x[0]==='thumbnail')[1],a,'thumbnail download targets exact session');
 await evaluate(ac,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 const thumbnailRect=await evaluate(ac,'document.querySelector(".composer-attachments .attachment-thumbnail").getBoundingClientRect().toJSON()');
 // Image decoding/naturalWidth and animation frames do not guarantee compositor paint.
 // Wait for the exact asserted pixel rather than weakening the visual assertion.
 await until(async()=>{const shot=await ac.capturePage();const pixel=shot.crop({x:Math.floor(thumbnailRect.x+thumbnailRect.width/2),y:Math.floor(thumbnailRect.y+thumbnailRect.height/2),width:1,height:1}).toBitmap();return pixel.equals(Buffer.from([0,0,255,255]));},'decoded clipboard thumbnail actually painted');
 const thumbnailShot=await ac.capturePage();
 assert.deepEqual([...thumbnailShot.crop({x:Math.floor(thumbnailRect.x+thumbnailRect.width/2),y:Math.floor(thumbnailRect.y+thumbnailRect.height/2),width:1,height:1}).toBitmap()],[0,0,255,255],'thumbnail paints actual red clipboard pixel');
 if(process.env.HERMES_NATIVE_EVIDENCE){fs.mkdirSync(process.env.HERMES_NATIVE_EVIDENCE,{recursive:true});fs.writeFileSync(path.join(process.env.HERMES_NATIVE_EVIDENCE,'composer-thumbnail.png'),thumbnailShot.toPNG());}
 assert.equal(await evaluate(ac,'document.querySelector("[aria-label=Message]").value'),'A retained draft');
 assert.equal(calls.filter(x=>x[0]==='send').length,0,'paste does not send');
 await until(()=>evaluate(ac,'!document.querySelector("[aria-label=Message]").disabled'),'composer ready after paste');
 await evaluate(ac,'(()=>{const e=document.querySelector("[aria-label=Message]");e.focus();e.setSelectionRange(e.value.length,e.value.length)})()');
 await clipboard.writeText(' pasted text');ac.paste();
 await until(()=>local.get(a)?.text==='A retained draft pasted text','plain text paste preserved');
 await input(ac,'Message','A retained draft');
 await evaluate(ac,'document.querySelector(".composer-attachments button").click()');
 await until(()=>local.get(a)?.attachments.length===0,'pasted attachment removed');
 await evaluate(ac,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 const anchor=await evaluate(ac,'(()=>{window.retainedRow=document.querySelector(".message-assistant");const e=document.querySelector(".message-list");e.scrollTop=250;e.dispatchEvent(new Event("scroll",{bubbles:true}));return e.scrollTop;})()');
 await evaluate(ac,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 await evaluate(shell,'window.hermesDesktop.selectThread("'+b+'")');const second=[...manager.tabs.values()][1],bc=second.view.webContents;
 await until(()=>evaluate(bc,'!!document.querySelector(".message-list")'),'session B');assert.equal(manager.tabs.size,2);
 await until(()=>evaluate(bc,'document.hasFocus()&&document.activeElement===document.querySelector("[aria-label=Message]")'),'opening session B focuses its composer');
 client.threads.set(a,{...client.threads.get(a),running:true,completed_unread:true,result_version:1,result_ref:200});service.changed();
 await until(()=>evaluate(shell,'document.querySelectorAll(".desktop-tab")[0].querySelectorAll(".desktop-tab-dot").length===3'),'inactive A has running, durable draft and unread dots');
 assert.equal(await evaluate(shell,'document.querySelectorAll(".desktop-tab")[1].querySelectorAll(".desktop-tab-dot").length'),1,'B has only its own running dot');
 client.threads.set(a,{...client.threads.get(a),running:false,completed_unread:false});service.changed();
 await until(()=>evaluate(shell,'document.querySelectorAll(".desktop-tab")[0].querySelectorAll(".desktop-tab-dot").length===1&&!!document.querySelectorAll(".desktop-tab")[0].querySelector(".desktop-tab-dot-draft")'),'directory clearing retains only local draft dot');
 client.threads.set(a,{...client.threads.get(a),completed_unread:true});service.changed();
 await evaluate(ac,'window.hermesDesktop.markResultRead("'+a+'",1,200)');assert.equal(calls.filter(x=>x[0]==='read').length,0,'hidden tab cannot confirm read');

 await evaluate(shell,'window.hermesDesktop.activateTab('+JSON.stringify(first.id)+')');
 assert.equal(await evaluate(ac,'window.retainedRow===document.querySelector(".message-assistant")'),true);
 assert.equal(await evaluate(ac,'document.querySelector(".message-list").scrollTop'),anchor);
 assert.equal(await evaluate(ac,'document.querySelector("[aria-label=Message]").value'),'A retained draft');
 await evaluate(shell,'window.hermesDesktop.selectThread("'+a+'")');assert.equal(manager.tabs.size,2);assert.equal(calls.filter(x=>x[0]==='open'&&x[1]===a).length,1);
 await evaluate(shell,'window.hermesDesktop.activateTab('+JSON.stringify(second.id)+')');
 await evaluate(ac,'window.hermesDesktop.sendMessage({text:"Background A",attachmentIds:[]})');assert.equal(calls.find(x=>x[0]==='send')[1],a);
 await evaluate(bc,'window.hermesDesktop.stopThread()');assert.deepEqual(calls.find(x=>x[0]==='stop'),['stop',b]);
 await evaluate(shell,'window.hermesDesktop.newTab("q")');const draft=[...manager.tabs.values()][2],dc=draft.view.webContents,originalView=dc.id;
 await until(()=>evaluate(dc,'!!document.querySelector(".new-chat-form textarea")'),'new chat page');
 assert.equal(await evaluate(dc,'document.querySelector("[aria-label=Project]").value'),'q');
 const area=await evaluate(dc,'document.querySelector("textarea").getBoundingClientRect().height');assert.ok(area>=260);
 await input(dc,'First message','First line\nA long body with multiple paragraphs.\nFinal paragraph.');
 const uploadsBeforeNewPaste=calls.filter(x=>x[0]==='upload').length;
 await clipboard.write([new ClipboardItem({'image/png':new Blob([image.toPNG()],{type:'image/png'})})]);
 await evaluate(dc,'document.querySelector("textarea").focus()');dc.paste();
 await until(()=>evaluate(dc,'document.querySelectorAll(".session-files li").length===1'),'new chat native image paste');
 await until(()=>evaluate(dc,'document.querySelector(".session-files .attachment-thumbnail img")?.naturalWidth===1'),'local clipboard image has genuine small thumbnail');
 await evaluate(dc,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 if(process.env.HERMES_NATIVE_EVIDENCE)fs.writeFileSync(path.join(process.env.HERMES_NATIVE_EVIDENCE,'new-chat-thumbnail.png'),(await dc.capturePage()).toPNG());
 assert.equal(calls.filter(x=>x[0]==='upload').length,uploadsBeforeNewPaste,'new-chat paste stays local');
 await evaluate(dc,'document.querySelector(".session-files button").click()');
 await until(()=>evaluate(dc,'document.querySelectorAll(".session-files li").length===0'),'remove new-chat pasted image');
 dc.debugger.attach('1.3');const doc=await dc.debugger.sendCommand('DOM.getDocument');const node=await dc.debugger.sendCommand('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'input[type=file]'});await dc.debugger.sendCommand('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[path.join(__dirname,'fixture.txt')]});dc.debugger.detach();
 await until(()=>evaluate(dc,'document.querySelectorAll(".session-files li").length===1'),'selected file');
 await evaluate(dc,'document.querySelector("form").requestSubmit()');await until(()=>draft.kind==='session','same tab promoted');
 assert.equal(draft.view.webContents.id,originalView);assert.equal(manager.tabs.size,3);assert.equal(manager.activeTabId,draft.id);
 const create=calls.find(x=>x[0]==='create'),upload=calls.filter(x=>x[0]==='upload').at(-1),send=calls.filter(x=>x[0]==='send').at(-1);
 assert.equal(create[1],'q');assert.equal(upload[1],draft.threadId);assert.equal(send[1],draft.threadId);assert.equal(send[3],'First line\nA long body with multiple paragraphs.\nFinal paragraph.');assert.equal(send[4].length,1);
 await until(()=>evaluate(dc,'!!document.querySelector(".session-tab-page")'),'promoted page');
 // A toolbar label in Session B's own page searches the main window's sidebar through the real IPC route.
 await until(()=>evaluate(bc,'!!document.querySelector(".toolbar-labels button[aria-label=\'Find sessions labeled bug\']")'),'session B toolbar label');
 await evaluate(bc,'document.querySelector(".toolbar-labels button").click()');
 await until(()=>evaluate(shell,'document.querySelectorAll(".search-result-list .tree-thread").length===1&&[...document.querySelectorAll(".session-query-chip > span")].map(e=>e.textContent).join()==="bug"'),'label search in the sidebar');
 assert.equal(await evaluate(shell,'document.querySelector(".search-result-list .tree-thread").textContent.includes("Session B")'),true);
 await evaluate(shell,'document.querySelector(".sidebar-search-clear").click()');await until(()=>evaluate(shell,'!!document.querySelector(".channel-tree")'),'search cleared');
 await evaluate(shell,'document.querySelector(".sidebar-edge-toggle").click()');await until(()=>draft.view.getBounds().x<100,'collapsed native bounds');
 await evaluate(shell,'document.querySelector(".sidebar-edge-toggle").click()');await until(()=>draft.view.getBounds().x===280,'expanded native bounds');
 // Real input reaches the production host renderer while retained native views resize.

 const resizeTo=async target=>{
   const point=await evaluate(shell,'(()=>{const r=document.querySelector(".sidebar-resize-handle").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+80)}})()');
   shell.sendInputEvent({type:'mouseMove',...point});shell.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});
   await until(()=>evaluate(shell,'document.querySelector(".native-workspace").classList.contains("sidebar-resizing")'),'pointer captured');
   shell.sendInputEvent({type:'mouseMove',x:target-3,y:point.y,movementX:target-3-point.x,movementY:0});
   await until(()=>draft.view.getBounds().x===Math.max(200,Math.min(480,target)),'native view tracks drag '+target);
   shell.sendInputEvent({type:'mouseUp',x:target-3,y:point.y,button:'left',clickCount:1});

   await until(()=>evaluate(shell,'!document.querySelector(".native-workspace").classList.contains("sidebar-resizing")'),'pointer released');
 };
 await resizeTo(380);assert.equal(await evaluate(shell,'localStorage.getItem("hermes.desktop.sidebar-width")'),'380');
 await resizeTo(150);await resizeTo(600);
 const nativeWidth=draft.view.getBounds();assert.equal(nativeWidth.x+nativeWidth.width,window.getContentSize()[0]);
 assert.equal(manager.tabs.size,3);assert.equal(draft.view.webContents.id,originalView);
 await evaluate(shell,'document.querySelector(".sidebar-edge-toggle").click()');await until(()=>draft.view.getBounds().x===0,'resized sidebar collapse');
 await evaluate(shell,'document.querySelector(".sidebar-edge-toggle").click()');await until(()=>draft.view.getBounds().x===480,'resized sidebar expand');
 window.setSize(720,820);await until(()=>draft.view.getBounds().x===360,'narrow window clamps sidebar');
 window.setSize(1280,820);await until(()=>draft.view.getBounds().x===480,'wide window restores preferred width');
 await evaluate(shell,'document.querySelector(".sidebar-resize-handle").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:true}))');await until(()=>draft.view.getBounds().x===470,'keyboard resize');
 await evaluate(shell,'document.querySelector(".sidebar-resize-handle").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}))');await until(()=>draft.view.getBounds().x===280,'double click resets width');
 await resizeTo(380);shell.reload();await until(()=>evaluate(shell,'!!document.querySelector(".sidebar-resize-handle")'),'reloaded workspace');await until(()=>draft.view.getBounds().x===380,'cold renderer restores width');
 assert.equal(await evaluate(ac,'window.retainedRow===document.querySelector(".message-assistant")'),true);
 assert.equal(draft.view.webContents.id,originalView);assert.equal(manager.tabs.size,3);
 await evaluate(shell,'(()=>{window.originalSidebarSave=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==="hermes.desktop.sidebar-width")throw Error("Controlled storage failure");return window.originalSidebarSave.call(this,k,v)};document.querySelector(".sidebar-resize-handle").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}));})()');
 await until(()=>draft.view.getBounds().x===390,'storage failure keeps live resize');
 assert.equal(await evaluate(shell,'document.querySelector(".native-tab-error").textContent.includes("could not be saved")'),true);
 await evaluate(shell,'Storage.prototype.setItem=window.originalSidebarSave;document.querySelector(".native-tab-error button").click();document.querySelector(".sidebar-resize-handle").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}))');await until(()=>draft.view.getBounds().x===280,'restore default before existing checks');
 await evaluate(shell,'document.querySelector("[aria-label=Settings]").click()');await until(()=>settingsForTest().isOpen,'Settings window opens');const sc=settingsForTest().contents;
 assert.equal(draft.view.getVisible(),true,'Session stays visible beside Settings');assert.equal(manager.snapshot(dc).tabActive,true);
 await until(()=>evaluate(sc,'document.querySelector("[aria-label=Model]")?.value==="fixture-current"'),'model default loaded through real preload and IPC');
 await evaluate(sc,'(()=>{const e=document.querySelector("[aria-label=Model]");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"fixture-next");e.dispatchEvent(new Event("input",{bubbles:true}));})()');
 await until(()=>evaluate(sc,'!document.querySelector("button[type=submit]").disabled'),'edited model ready');await evaluate(sc,'document.querySelector("form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))');
 await until(()=>evaluate(sc,'!!document.querySelector(".settings-warning")'),'model warning through native IPC');assert.equal(calls.filter(x=>x[0]==='model-write').length,1);
 await evaluate(sc,'document.querySelector(".settings-warning button").click()');await until(()=>evaluate(sc,'!!document.querySelector(".settings-success")'),'confirmed model save read back');assert.equal(modelSettings.model,'fixture-next');assert.equal(calls.filter(x=>x[0]==='model-write').at(-1)[3],true);assert.equal(calls.at(-1)[0],'model-read');
 if(process.env.HERMES_NATIVE_EVIDENCE){fs.mkdirSync(process.env.HERMES_NATIVE_EVIDENCE,{recursive:true});fs.writeFileSync(path.join(process.env.HERMES_NATIVE_EVIDENCE,'desktop-settings.png'),(await BrowserWindow.fromWebContents(sc).capturePage()).toPNG());}
 sc.focus();sc.sendInputEvent({type:'keyDown',keyCode:'Escape'});sc.sendInputEvent({type:'keyUp',keyCode:'Escape'});await until(()=>!settingsForTest().isOpen,'native Escape closes Settings window');assert.equal(draft.view.getVisible(),true);
 // The Session page has no Settings button; Ctrl+, in the Session tab opens Settings.
 assert.equal(await evaluate(dc,'!!document.querySelector("[aria-label=Settings]")'),false,'Session page has no Settings button');
 dc.focus();dc.sendInputEvent({type:'keyDown',keyCode:',',modifiers:['control']});dc.sendInputEvent({type:'keyUp',keyCode:',',modifiers:['control']});await until(()=>settingsForTest().isOpen,'Settings window from Session tab (Ctrl+,)');const fc=settingsForTest().contents;await until(()=>evaluate(fc,'!!document.querySelector("#settings-tab-font")'),'settings page');
 await evaluate(fc,'document.querySelector("#settings-tab-font").click()');await until(()=>evaluate(fc,'!!document.querySelector("[aria-label=\\"Text size\\"]")'),'font page');
 await evaluate(fc,'(()=>{const e=document.querySelector("[aria-label=\\"Text size\\"]");e.value="18";e.dispatchEvent(new Event("change",{bubbles:true}));})()');
 await until(()=>evaluate(shell,'getComputedStyle(document.documentElement).fontSize==="18px"'),'font shared across views');
 await until(()=>evaluate(dc,'getComputedStyle(document.documentElement).fontSize==="18px"'),'font reaches open Session view');
 BrowserWindow.fromWebContents(fc).close();await until(()=>!settingsForTest().isOpen,'Settings window closed');
 if(process.env.HERMES_NATIVE_EVIDENCE){fs.mkdirSync(process.env.HERMES_NATIVE_EVIDENCE,{recursive:true});fs.writeFileSync(path.join(process.env.HERMES_NATIVE_EVIDENCE,'desktop-native-tabs.png'),(await window.capturePage()).toPNG());}
 await evaluate(shell,'window.hermesDesktop.showTabMenu('+JSON.stringify(first.id)+',10,10)');
 assert.deepEqual(manager.menu(first.id).map(i=>i.enabled),[true,true,true],'first tab menu enables every close action');
 await assert.rejects(evaluate(ac,'window.hermesDesktop.showTabMenu('+JSON.stringify(first.id)+',10,10)'),/./,'session views cannot open the tab menu');
 await assert.rejects(evaluate(ac,'window.hermesDesktop.showContextMenu([{id:"rename",label:"Rename…"}],10,10)'),/./,'session views cannot open a main-window menu');
 await assert.rejects(evaluate(shell,'window.hermesDesktop.showContextMenu([{id:"x",label:"x",submenu:[]},{id:"x",label:"y"}],10,10)'),/./,'the shell menu rejects invalid items before any popup');
 await assert.rejects(evaluate(ac,'window.hermesDesktop.copySessionLink("other-session")'),/./,'a session view cannot copy another session link');
 await evaluate(shell,'window.hermesDesktop.closeTab('+JSON.stringify(second.id)+')');await until(()=>bc.isDestroyed(),'closed view released');assert.equal(ac.isDestroyed(),false);assert.equal(dc.isDestroyed(),false);
 manager.menuAction(first.id,'close-right');await until(()=>dc.isDestroyed(),'close tabs to the right releases the new chat view');assert.equal(ac.isDestroyed(),false);assert.equal(manager.activeTabId,first.id);
 manager.dispose();await until(()=>ac.isDestroyed(),'all views released');
 console.log('NATIVE_TABS_OK '+JSON.stringify({independentViews:3,retainedHistoryRows:200,domRetained:true,scopedBackgroundSend:true,newTabPromotedInPlace:true,attachmentTargetVerified:true,labelFilterVerified:true,modalAndBoundsVerified:true,viewsReleased:true,composerFocusOnOpen:true,tabMenuCloseRight:true,transport:'controlled fixture'}));app.exit(0);
})().catch(error=>{console.error(error.stack);app.exit(1)});
`;
    await writeFile(join(folder,'harness.cjs'),harness);
    const output=execFileSync('xvfb-run',['-a',require('electron'),'--no-sandbox',join(folder,'harness.cjs')],{encoding:'utf8',timeout:80000,env:process.env,maxBuffer:2_000_000});
    assert.match(output,/NATIVE_TABS_OK/);console.log(output.trim());
  } finally {await rm(folder,{recursive:true,force:true});}
});
