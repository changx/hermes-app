// Run with HERMES_TEST_ELECTRON=1 under Linux/Xvfb. Transport and storage are controlled fixtures;
// BrowserWindow, WebContentsView, production renderers, preload and IPC run unchanged.
// Side chats (docs/side-chat.md): anchor mark → right column panel, Send to main, Side chat button, anchor jump, sidebar tree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
test('Electron: side chats open beside their Session in the right column and send results back by hand', {skip: !process.env.HERMES_TEST_ELECTRON, timeout:90000}, async()=>{
  const root=new URL('..',import.meta.url).pathname, folder=await mkdtemp(join(tmpdir(),'hermes-side-chat-'));
  try {
    await cp(join(root,'dist'),join(folder,'dist'),{recursive:true});
    const candidate=await build({entryPoints:[join(root,'src/main/index.ts')],bundle:true,platform:'node',format:'cjs',external:['electron'],write:false,
      plugins:[{name:'test-only-exports',setup(builder){builder.onLoad({filter:/src\/main\/index\.ts$/},async args=>({contents:await readFile(args.path,'utf8')+'\nexport {service}; export const nativeTabsForTest=()=>tabs;\n',loader:'ts'}));}}]});
    await writeFile(join(folder,'dist/main/index.cjs'),candidate.outputFiles[0].text);
    const harness=String.raw`
const {app,BrowserWindow}=require('electron'); const assert=require('node:assert/strict'); const fs=require('node:fs'); const path=require('node:path');
app.setPath('userData',path.join(__dirname,'user-data'));app.commandLine.appendSwitch('disable-gpu');
const {service:accounts,nativeTabsForTest}=require('./dist/main/index.cjs');
const service=accounts.primary;
const calls=[], pages=new Map(), local=new Map(), a='th_source0001', s='th_side00001';
const now=Date.now()/1000;
const row=(id,ref,role,text,extra={})=>({id:id+'_'+ref,ref_seq:ref,role,text,created_at:now-100+ref,...extra});
const server=new Map([[a,[row(a,1,'user','Question'),row(a,2,'assistant','Answer one',{display_kind:'final'}),row(a,3,'user','Next'),row(a,4,'assistant','TG original line',{display_kind:'final'})]],
  [s,[row(s,1,'system','Side chat from [Main](hermesapp://session/'+a+')',{display_kind:'system_notice',notice_kind:'branch'}),row(s,2,'user','Why?'),row(s,3,'assistant','Side conclusion',{display_kind:'final'})]]]);
let made=0;
const client={channels:new Map([['p',{id:'p',name:'Project Alpha'}]]),threads:new Map([[a,{id:a,project_id:'p',title:'Main session',running:false,last_message_at:now,markers:[]}],
  [s,{id:s,project_id:'p',title:'Side: Answer one',running:false,last_message_at:now-5,markers:[],side_of:{thread_id:a,anchor_ref_seq:2}}]]),
 messages:new Map(),receipts:new Map(),interactions:new Map(),attachments:new Map(),supportsLatest:true,isCatalogueReady:true,supportsThreadBranch:true,supportsThreadSide:true,
 isThreadAvailable(id){return this.threads.has(id);},page:id=>pages.get(id),releasePage(id){calls.push(['release',id]);pages.delete(id);this.messages.delete(id);},
 acquirePage(id){if(!pages.has(id)){const page={messages:client.messages,currentOlderCursor:undefined,
  async openConversation(){calls.push(['open',id]);client.messages.set(id,server.get(id).slice(-50));service.changed();},
  async loadFullHistory(){client.messages.set(id,server.get(id));service.changed();}};pages.set(id,page);}return pages.get(id);},
 async sideThread(id,ref,requestId){calls.push(['side',id,ref,requestId]);const sid='th_side0000'+(2+made++);const t={id:sid,project_id:'p',title:'Side: TG original line',archived:false,running:false,last_message_at:Date.now()/1000,side_of:{thread_id:id,anchor_ref_seq:ref}};
  this.threads.set(sid,t);server.set(sid,[row(sid,1,'system','Side chat from [Main](hermesapp://session/'+id+')',{display_kind:'system_notice',notice_kind:'branch'})]);service.changed();return t;},
 async send(id,messageId,text,files){calls.push(['send',id,text]);return {id:'receipt-'+calls.length,thread_id:id,client_message_id:messageId,state:'queued',durable:true,ref_seq:9};},
 rememberAcceptedInput(id,messageId,text,files,time,receipt){client.messages.set(id,[...(client.messages.get(id)||[]),{id:'receipt:'+receipt.id,role:'user',text,client_message_id:messageId,receipt_id:receipt.id,attachments:files,created_at:time,ref_seq:receipt.ref_seq}]);},
 async markResultRead(id){calls.push(['read',id]);},close(){pages.clear();client.messages.clear();}};
service.initialize=async()=>{service.phase='connected';service.connectionState='online';service.connection={id:'a'.repeat(24),baseUrl:'https://controlled.example.test',token:'controlled-test-only'};service.client=client;service.selectedChannelId='p';service.outboxStore={async put(){},async remove(){},async clear(){}};service.localDraftStore={async list(){return Object.fromEntries(local)},async put(_identity,id,draft){local.set(id,structuredClone(draft));},async clear(){}};service.changed();};
const evaluate=(contents,code)=>Promise.race([contents.executeJavaScript(code,true).catch(error=>{throw Error('Renderer script failed: '+code.slice(0,180)+' '+error.message)}),new Promise((_,reject)=>setTimeout(()=>reject(Error('Renderer timeout: '+code.slice(0,120))),8000))]);
async function until(check,label){console.log('CHECK '+label);const end=Date.now()+15000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,25));}throw Error('Timed out: '+label);}
async function input(contents,label,text){await evaluate(contents,'(()=>{const e=document.querySelector('+JSON.stringify('[aria-label="'+label+'"]')+');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(e,'+JSON.stringify(text)+');e.dispatchEvent(new Event("input",{bubbles:true}));})()');}
const toolbar=(contents)=>evaluate(contents,'[...document.querySelectorAll(".message-final .message-toolbar")].map(bar=>[...bar.querySelectorAll("button")].map(b=>b.getAttribute("aria-label")))');
(async()=>{
 await app.whenReady();await until(()=>BrowserWindow.getAllWindows().length,'window');const window=BrowserWindow.getAllWindows()[0], shell=window.webContents;
 window.setContentSize(1400,900);
 await until(()=>evaluate(shell,'!!document.querySelector(".native-workspace")'),'production workspace');
 const manager=nativeTabsForTest();
 // Sidebar: the side chat is one level under its source, never a first-level row.
 await until(()=>evaluate(shell,'document.querySelectorAll(".channel-tree .tree-side-children .tree-thread").length===1'),'side chat row under its source');
 assert.deepEqual(await evaluate(shell,'[...document.querySelectorAll(".channel-tree .thread-children > .tree-thread, .channel-tree .tree-thread-with-sides > .tree-thread")].map(b=>b.querySelector(".thread-title").textContent)'),['Main session']);
 await evaluate(shell,'window.hermesDesktop.selectThread("'+a+'")');const tab=[...manager.tabs.values()][0],ac=tab.view.webContents;
 await until(()=>evaluate(ac,'document.querySelectorAll(".message-final").length===2'),'source Session');
 assert.deepEqual(await toolbar(ac),[['Side chat','Branch','Copy','Export'],['Side chat','Branch','Copy','Export','Retry']]);
 await until(()=>evaluate(ac,'document.querySelector(".message-final .side-mark")?.textContent==="Side chat"'),'anchor mark on the anchor message');
 // The anchor mark opens the side chat in the right column of this tab.
 await evaluate(ac,'document.querySelector(".side-mark").click()');
 await until(()=>manager.panels.size===1,'panel created');const panel=[...manager.panels.values()][0],pc=panel.view.webContents;
 assert.equal(manager.tabs.size,1,'no tab for the side chat');
 await until(()=>evaluate(pc,'document.querySelectorAll(".message-final").length===1'),'side chat page renders its own timeline');
 await until(()=>panel.view.getVisible()&&tab.view.getVisible(),'panel and Session both visible');
 const tb=tab.view.getBounds(), pb=panel.view.getBounds();
 assert.ok(tb.x+tb.width<=pb.x&&tb.width>=360&&pb.width>=280,'side by side: '+JSON.stringify({tb,pb}));
 assert.deepEqual(await toolbar(pc),[['Send to main','Copy','Export','Retry']],'no Branch or Side chat in a side chat');
 assert.equal(await evaluate(shell,'document.querySelector(".side-panel-title span").textContent'),'Side: Answer one');
 // Each composer sends to its own Session.
 await input(pc,'Message','In the side chat');await evaluate(pc,'document.querySelector("[aria-label=\\"Send message\\"]").click()');
 await until(()=>calls.some(c=>c[0]==='send'&&c[1]===s&&c[2]==='In the side chat'),'side composer sends to the side chat');
 assert.ok(!calls.some(c=>c[0]==='send'&&c[1]===a),'nothing reached the source Session');
 // Send to main: the reply and a link back go into the source composer; nothing is sent.
 await input(ac,'Message','My note');
 await evaluate(pc,'document.querySelector("[aria-label=\\"Send to main\\"]").click()');
 await until(()=>evaluate(ac,'document.querySelector("[aria-label=Message]").value').then(v=>v==='My note\n\nFrom side chat [Side: Answer one](hermesapp://session/'+s+'):\n\nSide conclusion'),'Send to main fills the source composer');
 assert.equal(calls.filter(c=>c[0]==='send').length,1,'Send to main sends nothing');
 // The title row button scrolls the source Session to the anchor and marks it.
 await evaluate(shell,'document.querySelector("[aria-label=\\"Show the starting message\\"]").click()');
 await until(()=>evaluate(ac,'document.querySelector(".message-focused")?.dataset.resultRef==="2"'),'anchor marked in the source Session');
 // Side chat button on the second reply: a new side chat opens in front; the first panel stays.
 await evaluate(ac,'document.querySelectorAll(".message-final")[1].querySelector("[aria-label=\\"Side chat\\"]").click()');
 await until(()=>manager.panels.size===2,'second panel');const second=[...manager.panels.values()][1];
 assert.deepEqual(calls.find(c=>c[0]==='side').slice(1,3),[a,4]);assert.match(calls.find(c=>c[0]==='side')[3],/^sc_/);
 await until(()=>second.view.getVisible()&&!panel.view.getVisible(),'new panel in front, first hidden');
 await until(()=>evaluate(shell,'[...document.querySelectorAll(".right-tab [role=tab]")].map(b=>b.getAttribute("aria-selected")).join()==="false,true"'),'right column tabs');
 await until(()=>evaluate(ac,'document.querySelectorAll(".side-mark").length===2'),'both anchors marked');
 // Back to the first tab: same page, same draft.
 await evaluate(shell,'document.querySelectorAll(".right-tab [role=tab]")[0].click()');
 await until(()=>panel.view.getVisible()&&!second.view.getVisible(),'first panel back in front');
 assert.equal(pc.isDestroyed(),false);
 // Closing a panel keeps the side chat; its row stays in the sidebar.
 await evaluate(shell,'document.querySelector("[aria-label=\\"Close side chat\\"]").click()');
 await until(()=>pc.isDestroyed()&&manager.panels.size===1,'panel closed');
 await until(()=>evaluate(shell,'document.querySelectorAll(".channel-tree .tree-side-children .tree-thread").length===2'),'both side chats listed');
 // A sidebar row opens it again in the right column.
 await evaluate(shell,'[...document.querySelectorAll(".channel-tree .tree-side-children .tree-thread")].find(b=>b.textContent.includes("Answer one")).click()');
 await until(()=>[...manager.panels.values()].some(p=>p.threadId===s&&p.view.getVisible()),'sidebar row opens the panel');
 if(process.env.HERMES_NATIVE_EVIDENCE){fs.mkdirSync(process.env.HERMES_NATIVE_EVIDENCE,{recursive:true});fs.writeFileSync(path.join(process.env.HERMES_NATIVE_EVIDENCE,'desktop-side-chat.png'),(await window.capturePage()).toPNG());}
 manager.dispose();
 console.log('SIDE_CHAT_OK '+JSON.stringify({tab:tb,panel:pb}));app.exit(0);
})().catch(error=>{console.error(error.stack);app.exit(1)});
`;
    await writeFile(join(folder,'harness.cjs'),harness);
    const output=execFileSync('xvfb-run',['-a',require('electron'),'--no-sandbox',join(folder,'harness.cjs')],{encoding:'utf8',timeout:80000,env:process.env,maxBuffer:2_000_000});
    assert.match(output,/SIDE_CHAT_OK/);console.log(output.trim().split('\n').filter(line=>/CHECK|SIDE_CHAT_OK/.test(line)).slice(-3).join('\n'));
  } finally {await rm(folder,{recursive:true,force:true});}
});
