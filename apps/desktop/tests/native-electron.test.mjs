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
      plugins:[{name:'test-only-exports',setup(builder){builder.onLoad({filter:/src\/main\/index\.ts$/},async args=>({contents:await readFile(args.path,'utf8')+'\nexport {service}; export const nativeTabsForTest=()=>tabs;\n',loader:'ts'}));}}]});
    await writeFile(join(folder,'dist/main/index.cjs'),candidate.outputFiles[0].text);
    await writeFile(join(folder,'fixture.txt'),'Controlled native attachment fixture');
    const harness=String.raw`
const {app,BrowserWindow}=require('electron'); const assert=require('node:assert/strict'); const fs=require('node:fs'); const path=require('node:path');
app.setPath('userData',path.join(__dirname,'user-data'));app.commandLine.appendSwitch('disable-gpu');
const {service,nativeTabsForTest}=require('./dist/main/index.cjs');
const calls=[], pages=new Map(), local=new Map(), a='th_aaaaaaaa',b='th_bbbbbbbb';
const rows=id=>Array.from({length:id===a?200:8},(_,i)=>({id:id+'_'+i,ref_seq:i+1,role:'assistant',text:'Controlled fixture '+id+' row '+(i+1)}));
const server=new Map([[a,rows(a)],[b,rows(b)]]);
const client={channels:new Map([['p',{id:'p',name:'Project Alpha'}],['q',{id:'q',name:'Project Beta'}]]),threads:new Map([[a,{id:a,project_id:'p',title:'Session A',running:false,last_message_at:Date.now()/1000,markers:['work']}],[b,{id:b,project_id:'q',title:'Session B',running:true,last_message_at:1,markers:['bug']}]]),messages:new Map(),receipts:new Map(),interactions:new Map(),attachments:new Map(),supportsLatest:true,isCatalogueReady:true,supportsSessionLabels:true,
 isThreadAvailable(id){return this.threads.has(id);},page:id=>pages.get(id),releasePage(id){pages.delete(id);this.messages.delete(id);},
 acquirePage(id){if(!pages.has(id)){const page={messages:client.messages,currentOlderCursor:undefined,
 async openConversation(){calls.push(['open',id]);client.messages.set(id,server.get(id).slice(-50));this.currentOlderCursor=id===a?'older':undefined;service.changed();},
 async loadFullHistory(){calls.push(['history',id]);client.messages.set(id,server.get(id));this.currentOlderCursor=undefined;service.changed();}};pages.set(id,page);}return pages.get(id);},
 async createThread(project,title,id){calls.push(['create',project,id]); const t={id,project_id:project,title,archived:false,last_message_at:Date.now()/1000,running:false};this.threads.set(id,t);server.set(id,[]);service.changed();return t;},
 async upload(id,name,bytes){calls.push(['upload',id,name,bytes.length]);const f={id:'att_'+('c'.repeat(32)),thread_id:id,name,mime:'text/plain',size:bytes.length,state:'available'};this.attachments.set(f.id,f);service.changed();return f;},
 async send(id,messageId,text,files){calls.push(['send',id,messageId,text,files]);return {id:'receipt-'+calls.length,thread_id:id,client_message_id:messageId,state:'queued',durable:true,ref_seq:1};},
 rememberAcceptedInput(id,messageId,text,files,time,receipt){client.messages.set(id,[...(client.messages.get(id)||[]),{id:'receipt:'+receipt.id,role:'user',text,client_message_id:messageId,receipt_id:receipt.id,attachments:files,created_at:time,ref_seq:receipt.ref_seq}]);},
 async stop(id){calls.push(['stop',id]);},async markResultRead(id){calls.push(['read',id]);},close(){pages.clear();client.messages.clear();},async getAttachment(id,f){return this.attachments.get(f);}};
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
 const anchor=await evaluate(ac,'(()=>{window.retainedRow=document.querySelector(".message-assistant");const e=document.querySelector(".message-list");e.scrollTop=250;e.dispatchEvent(new Event("scroll",{bubbles:true}));return e.scrollTop;})()');
 await evaluate(ac,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 await evaluate(shell,'window.hermesDesktop.selectThread("'+b+'")');const second=[...manager.tabs.values()][1],bc=second.view.webContents;
 await until(()=>evaluate(bc,'!!document.querySelector(".message-list")'),'session B');assert.equal(manager.tabs.size,2);
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
 dc.debugger.attach('1.3');const doc=await dc.debugger.sendCommand('DOM.getDocument');const node=await dc.debugger.sendCommand('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'input[type=file]'});await dc.debugger.sendCommand('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[path.join(__dirname,'fixture.txt')]});dc.debugger.detach();
 await until(()=>evaluate(dc,'document.querySelectorAll(".session-files li").length===1'),'selected file');
 await evaluate(dc,'document.querySelector("form").requestSubmit()');await until(()=>draft.kind==='session','same tab promoted');
 assert.equal(draft.view.webContents.id,originalView);assert.equal(manager.tabs.size,3);assert.equal(manager.activeTabId,draft.id);
 const create=calls.find(x=>x[0]==='create'),upload=calls.find(x=>x[0]==='upload'),send=calls.filter(x=>x[0]==='send').at(-1);
 assert.equal(create[1],'q');assert.equal(upload[1],draft.threadId);assert.equal(send[1],draft.threadId);assert.equal(send[3],'First line\nA long body with multiple paragraphs.\nFinal paragraph.');assert.equal(send[4].length,1);
 await until(()=>evaluate(dc,'!!document.querySelector(".session-tab-page")'),'promoted page');
 await evaluate(shell,'document.querySelector(".sidebar-filter-icon").click()');await until(()=>evaluate(shell,'!!document.querySelector(".labels-filter-popover input")'),'label popover');
 await evaluate(shell,'[...document.querySelectorAll(".labels-filter-candidates input")].find(e=>e.getAttribute("aria-label")==="Label: bug").click()');await until(()=>evaluate(shell,'document.querySelectorAll(".tree-thread").length===1'),'label filter');
 assert.equal(await evaluate(shell,'document.querySelector(".tree-thread").textContent.includes("Session B")'),true);
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
 await evaluate(shell,'document.querySelector("[aria-label=Settings]").click()');await until(()=>!draft.view.getVisible(),'modal hides native view');assert.equal(manager.snapshot(dc).tabActive,false);
 await evaluate(shell,'[...document.querySelectorAll(".editor-dialog button")].find(e=>e.textContent==="Close").click()');await until(()=>draft.view.getVisible(),'modal restores native view');
 await evaluate(dc,'document.querySelector("[aria-label=Settings]").click()');await until(()=>evaluate(dc,'!!document.querySelector(".font-settings select")'),'font dialog');
 await evaluate(dc,'(()=>{const e=document.querySelector(".font-settings select");e.value="18";e.dispatchEvent(new Event("change",{bubbles:true}));})()');
 await until(()=>evaluate(shell,'getComputedStyle(document.documentElement).fontSize==="18px"'),'font shared across views');
 await evaluate(dc,'[...document.querySelectorAll(".font-settings button")].find(e=>e.textContent==="Done").click()');
 if(process.env.HERMES_NATIVE_EVIDENCE){fs.mkdirSync(process.env.HERMES_NATIVE_EVIDENCE,{recursive:true});fs.writeFileSync(path.join(process.env.HERMES_NATIVE_EVIDENCE,'desktop-native-tabs.png'),(await window.capturePage()).toPNG());}
 await evaluate(shell,'window.hermesDesktop.closeTab('+JSON.stringify(second.id)+')');await until(()=>bc.isDestroyed(),'closed view released');assert.equal(ac.isDestroyed(),false);assert.equal(dc.isDestroyed(),false);
 manager.dispose();await until(()=>ac.isDestroyed()&&dc.isDestroyed(),'all views released');
 console.log('NATIVE_TABS_OK '+JSON.stringify({independentViews:3,retainedHistoryRows:200,domRetained:true,scopedBackgroundSend:true,newTabPromotedInPlace:true,attachmentTargetVerified:true,labelFilterVerified:true,modalAndBoundsVerified:true,viewsReleased:true,transport:'controlled fixture'}));app.exit(0);
})().catch(error=>{console.error(error.stack);app.exit(1)});
`;
    await writeFile(join(folder,'harness.cjs'),harness);
    const output=execFileSync('xvfb-run',['-a',require('electron'),'--no-sandbox',join(folder,'harness.cjs')],{encoding:'utf8',timeout:80000,env:process.env,maxBuffer:2_000_000});
    assert.match(output,/NATIVE_TABS_OK/);console.log(output.trim());
  } finally {await rm(folder,{recursive:true,force:true});}
});
