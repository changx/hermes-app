// Test transport/storage are fixtures. All desktop renderers, native views, preload and IPC are production code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require=createRequire(import.meta.url);
test('Electron: production right browser previews attachments and generated pages with Chrome UA and no app authority', {skip:!process.env.HERMES_TEST_ELECTRON,timeout:120000},async()=>{
  const root=new URL('..',import.meta.url).pathname,folder=await mkdtemp(join(tmpdir(),'hermes-browser-sidebar-'));
  try {
    await cp(join(root,'dist'),join(folder,'dist'),{recursive:true});
    const bundle=await build({entryPoints:[join(root,'src/main/index.ts')],bundle:true,platform:'node',format:'cjs',external:['electron'],write:false,plugins:[{name:'test-exports',setup(b){b.onLoad({filter:/src\/main\/index\.ts$/},async args=>({contents:await readFile(args.path,'utf8')+'\nexport {service}; export const sidebarForTest=()=>browser; export const tabsForTest=()=>tabs; export const settingsForTest=()=>settingsWindow;\n',loader:'ts'}));}}]});
    await writeFile(join(folder,'dist/main/index.cjs'),bundle.outputFiles[0].text);
    await writeFile(join(folder,'local.html'),'<h1 id="local">Local draft preview</h1>');
    await writeFile(join(folder,'harness.cjs'),String.raw`
const {app,BrowserWindow,session,nativeImage}=require('electron');const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
app.setPath('userData',path.join(__dirname,'user-data'));app.commandLine.appendSwitch('disable-gpu');
const {service:accounts,sidebarForTest,tabsForTest,settingsForTest}=require('./dist/main/index.cjs');
const service=accounts.primary;
const requests=[],downloads=[],a='th_aaaaaaaa',b='th_bbbbbbbb',pages=new Map();let base;
const server=http.createServer((req,res)=>{requests.push({url:req.url,ua:req.headers['user-agent'],authorization:req.headers.authorization,cookie:req.headers.cookie});
 if(req.url==='/doc.pdf'){res.writeHead(200,{'Content-Type':'application/pdf'});res.end(data.get('pdf').bytes);return;}
 if(req.url==='/download'){res.writeHead(200,{'Content-Disposition':'attachment; filename=not-saved.txt','Content-Type':'application/octet-stream'});res.end('blocked download');return;}
 if(req.url==='/unsafe-redirect'){res.writeHead(302,{Location:'file:///etc/passwd'});res.end();return;}
 res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Fixture '+req.url+'</title><h1 id="page">Browser fixture '+req.url+'</h1><script>document.documentElement.dataset.ua=navigator.userAgent</script>');});
server.on('upgrade',(req,socket)=>{requests.push({url:req.url,ua:req.headers['user-agent'],authorization:req.headers.authorization,cookie:req.headers.cookie});const accept=require('node:crypto').createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');socket.write(Buffer.from([0x81,2,111,107]));socket.end(Buffer.from([0x88,0]));});
const png=nativeImage.createFromBitmap(Buffer.from([0,0,255,255]),{width:1,height:1}).toPNG();
function wav(){const rate=8000,samples=rate,data=Buffer.alloc(44+samples*2);data.write('RIFF',0);data.writeUInt32LE(36+samples*2,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(rate,24);data.writeUInt32LE(rate*2,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)data.writeInt16LE(Math.round(Math.sin(i/rate*2*Math.PI*440)*8000),44+i*2);return data;}
function pdf(){const stream='BT /F1 18 Tf 20 100 Td (Sidebar PDF fixture) Tj ET';const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream'];let data='%PDF-1.4\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(data));data+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n';}const start=Buffer.byteLength(data);data+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF';return Buffer.from(data);}
const fixtures=[['html','generated.html','text/html',Buffer.from('<!doctype html><title>Generated page</title><link rel="stylesheet" href="styles.css"><h1 id="generated">Generated preview</h1><img id="asset" src="pixel.png"><script src="logic.js"></script>')],['css','styles.css','text/css',Buffer.from('h1{color:rgb(12,34,56)}')],['js','logic.js','text/javascript',Buffer.from('document.documentElement.dataset.generated="ready"')],['png','pixel.png','image/png',png],['txt','notes.txt','text/plain',Buffer.from('<script>window.evil=true</script>\nReadable notes')],['pdf','document.pdf','application/pdf',pdf()],['md','notes.md','text/markdown',Buffer.from('# Markdown title\n\n<script>window.evil=true</script>\n\n| a | b |\n|---|---|\n| 1 | 2 |\n')],['mp4','clip.mp4','video/mp4',fs.readFileSync(${JSON.stringify(new URL('./fixtures/preview-video.mp4', import.meta.url).pathname)})],['wav','tone.wav','audio/wav',wav()],['secret','secret.txt','text/plain',Buffer.from('must not be a generated-page resource')]];
const data=new Map(fixtures.map(([id,name,mime,bytes])=>[id,{bytes,attachment:{id,thread_id:a,name,mime,size:bytes.length,state:'available'}}]));
const client={channels:new Map([['p',{id:'p',name:'Fixture project'}]]),threads:new Map([[a,{id:a,project_id:'p',title:'Preview session',last_message_at:1}],[b,{id:b,project_id:'p',title:'Other session',last_message_at:0}]]),messages:new Map(),receipts:new Map(),interactions:new Map(),attachments:new Map([...data].map(([id,f])=>[id,f.attachment])),isCatalogueReady:true,supportsLatest:true,
 isThreadAvailable:id=>client.threads.has(id),page:id=>pages.get(id),releasePage(id){pages.delete(id);client.messages.delete(id);},acquirePage(id){if(!pages.has(id))pages.set(id,{messages:client.messages,async openConversation(){client.messages.set(id,[{id:'message-'+id,ref_seq:1,role:'assistant',text:'[Generated link]('+base+'/linked)',attachments:id===a?['html','png','txt','pdf'].map(id=>data.get(id).attachment):[]}]);service.changed();}});return pages.get(id);},
 async getAttachment(thread,id){const item=data.get(id)?.attachment;return item?.thread_id===thread?item:undefined;},async download(thread,id){downloads.push([thread,id]);return new Uint8Array(data.get(id).bytes);},close(){},};
service.initialize=async()=>{service.phase='connected';service.connectionState='online';service.connection={id:'a'.repeat(24),baseUrl:'https://controlled.example.test',token:'test-only-never-browser'};service.client=client;service.selectedChannelId='p';service.localDraftStore={async list(){return{}},async put(){},async clear(){}};service.changed();};
const evaluate=(contents,code)=>contents.executeJavaScript(code,true).catch(error=>{throw Error('Renderer script failed: '+code.slice(0,200)+' '+error.message)});
async function until(check,label){console.log('CHECK '+label);const end=Date.now()+12000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,25));}throw Error('Timed out: '+label+'; native contents '+JSON.stringify(require('electron').webContents.getAllWebContents().map(c=>({id:c.id,url:c.getURL(),frames:c.mainFrame.framesInSubtree.map(f=>({url:f.url,id:f.routingId}))}))));}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
 await app.whenReady();await until(()=>BrowserWindow.getAllWindows().length,'window');const window=BrowserWindow.getAllWindows()[0],shell=window.webContents;
 await until(()=>evaluate(shell,'!!document.querySelector(".native-workspace")'),'workspace');
 await evaluate(shell,'window.hermesDesktop.selectThread('+JSON.stringify(a)+')');const manager=tabsForTest(),tab=[...manager.tabs.values()][0],chat=tab.view.webContents,browser=sidebarForTest();
 await until(()=>evaluate(chat,'document.querySelectorAll(".attachment-row").length===4'),'attachment cards');
 await until(()=>evaluate(chat,'document.querySelector(".attachment-row .attachment-thumbnail img")?.naturalWidth===1'),'message image has genuine small thumbnail');
 assert.equal(await evaluate(chat,'document.querySelectorAll(".attachment-row .attachment-thumbnail").length'),4,'every message file has a thumbnail or type tile');
 if(process.env.HERMES_NATIVE_EVIDENCE){fs.mkdirSync(process.env.HERMES_NATIVE_EVIDENCE,{recursive:true});fs.writeFileSync(path.join(process.env.HERMES_NATIVE_EVIDENCE,'message-thumbnails.png'),(await chat.capturePage()).toPNG());}
 await evaluate(chat,'(()=>{const row=[...document.querySelectorAll(".attachment-row")].find(e=>e.textContent.includes("generated.html"));[...row.querySelectorAll("button")].find(e=>e.textContent==="Preview").click()})()');
 await until(()=>browser.panes.has(tab.id),'pane created');const pane=browser.panes.get(tab.id),web=pane.view.webContents;
 await until(()=>evaluate(web,'document.documentElement.dataset.generated==="ready"'),'HTML script and relative JS');
 assert.equal(await evaluate(web,'getComputedStyle(document.querySelector("h1")).color'),'rgb(12, 34, 56)');
 await until(()=>evaluate(web,'document.querySelector("#asset").naturalWidth===1'),'relative image');
 assert.equal(await evaluate(web,'typeof window.hermesDesktop+":"+typeof require+":"+typeof process'),'undefined:undefined:undefined');
 assert.notEqual(web.session,shell.session);const ua=await evaluate(web,'navigator.userAgent');assert.match(ua,/Chrome\/\d+\.0\.0\.0 Safari\/537.36$/);assert.doesNotMatch(ua,/Electron|Hermes/);
 assert.equal(await evaluate(web,'fetch("secret.txt").then(r=>r.status)'),404);
 assert.equal(downloads.some(([,id])=>id==='secret'),false);
 assert.equal(await evaluate(web,'fetch("file:///etc/passwd").then(()=>false,()=>true)'),true);
 assert.equal(await evaluate(web,'Notification.requestPermission()'),'denied');
 await until(()=>pane.view.getVisible()&&pane.view.getBounds().width>280,'pane placed');
 let rb=pane.view.getBounds(),cb=tab.view.getBounds();assert.equal(cb.x+cb.width+1,rb.x);assert.equal(rb.x+rb.width,window.getContentSize()[0]);
 await evaluate(chat,'window.hermesDesktop.browserAction("close").then(()=>false,()=>true)').then(result=>assert.equal(result,true,'conversation cannot control shell browser actions'));
 await evaluate(chat,'window.hermesDesktop.previewAttachment("txt")');await until(()=>evaluate(web,'!!document.querySelector("pre")'),'text preview');assert.match(await evaluate(web,'document.querySelector("pre").textContent'),/<script>/);assert.equal(await evaluate(web,'window.evil'),undefined);
 await evaluate(chat,'window.hermesDesktop.previewAttachment("png")');await until(()=>evaluate(web,'!!document.querySelector("img")&&document.querySelector("img").naturalWidth===1'),'full image preview');
 await evaluate(chat,'window.hermesDesktop.previewAttachment("pdf")');
 await until(()=>web.mainFrame.framesInSubtree.some(f=>f.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/')),'PDF viewer frame');
 web.debugger.attach('1.3');const pdfDom=await web.debugger.sendCommand('DOM.getDocument',{depth:-1,pierce:true});web.debugger.detach();
 const nativeNodes=[];const collect=node=>{nativeNodes.push(node);for(const child of [...node.children||[],...node.shadowRoots||[]])collect(child);};collect(pdfDom.root);
 assert.ok(nativeNodes.some(node=>node.nodeName==='IFRAME'&&node.attributes?.includes('application/pdf')),'Chromium creates the built-in PDF plugin frame in its closed shadow tree');
 console.log('PDF_FRAMES '+JSON.stringify(web.mainFrame.framesInSubtree.map(frame=>frame.url)));
 // The viewer frame alone is not enough: a blocked viewer leaves a uniform grey pane. Require a rendered white page.
 const pdfPage=async()=>{const bitmap=(await web.capturePage()).toBitmap();let white=0;for(let i=0;i<bitmap.length;i+=4)if(bitmap[i]>245&&bitmap[i+1]>245&&bitmap[i+2]>245)white++;return white>2000;};
 await until(pdfPage,'PDF page rendered');
 await browser.open(tab.id,base+'/doc.pdf');await until(()=>web.getURL()===base+'/doc.pdf'&&web.mainFrame.framesInSubtree.some(f=>f.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/')),'remote PDF viewer frame');
 await until(pdfPage,'remote PDF page rendered');
 await evaluate(chat,'window.hermesDesktop.previewAttachment("md")');await until(()=>evaluate(web,'document.querySelector("h1")?.textContent==="Markdown title"'),'Markdown rendered');
 assert.equal(await evaluate(web,'document.querySelectorAll("table td").length'),2);assert.equal(await evaluate(web,'document.querySelector("script")'),null);assert.equal(await evaluate(web,'window.evil'),undefined);
 await evaluate(chat,'window.hermesDesktop.previewAttachment("mp4")');await until(()=>evaluate(web,'(v=>!!v&&v.readyState>=1&&v.videoWidth===32&&Math.abs(v.duration-2)<0.3)(document.querySelector("video"))'),'video metadata');
 await evaluate(web,'(v=>{v.muted=true;v.currentTime=1.5})(document.querySelector("video"))');await until(()=>evaluate(web,'(v=>!v.seeking&&v.currentTime>1.4&&v.readyState>=2)(document.querySelector("video"))'),'video seek with Range');
 await evaluate(chat,'window.hermesDesktop.previewAttachment("wav")');await until(()=>evaluate(web,'(v=>!!v&&v.readyState>=1&&Math.abs(v.duration-1)<0.1)(document.querySelector("video,audio"))'),'audio metadata');
 await web.session.cookies.set({url:base,name:'isolated',value:'browser-only'});await shell.session.cookies.set({url:base,name:'app-secret',value:'must-not-leak'});
 await evaluate(shell,'window.hermesDesktop.openBrowser('+JSON.stringify(base+'/first')+')');await until(()=>evaluate(web,'!!document.querySelector("#page")'),'web page');
 const networkUa=requests.find(r=>r.url==='/first').ua;assert.equal(networkUa,ua);assert.equal(await evaluate(web,'navigator.userAgent'),ua);
 assert.equal(await evaluate(web,'new Promise((resolve,reject)=>{const socket=new WebSocket('+JSON.stringify(base.replace('http:','ws:')+'/socket')+');socket.onmessage=event=>resolve(event.data);socket.onerror=()=>reject(Error("WebSocket failed"));})'),'ok');assert.equal(requests.find(r=>r.url==='/socket').ua,ua);
 assert.equal(requests.some(r=>r.authorization||r.cookie?.includes('app-secret')),false);assert.equal(requests.find(r=>r.url==='/first').cookie,'isolated=browser-only');
 await evaluate(shell,'window.hermesDesktop.openBrowser('+JSON.stringify(base+'/second')+')');await evaluate(shell,'window.hermesDesktop.browserAction("back")');await until(()=>web.getURL()===base+'/first','back navigation');await evaluate(shell,'window.hermesDesktop.browserAction("forward")');await until(()=>web.getURL()===base+'/second','forward navigation');
 await evaluate(shell,'window.hermesDesktop.browserAction("reload")');await until(()=>requests.filter(r=>r.url==='/second').length>=2,'reload');
 await evaluate(chat,'document.querySelector(".message-markdown a").click()');await until(()=>web.getURL()===base+'/linked','message link opens in same sidebar');assert.equal(BrowserWindow.getAllWindows().length,1);
 await evaluate(web,'window.open('+JSON.stringify(base+'/popup')+',"_blank")');await until(()=>web.getURL()===base+'/popup','popup stays in sidebar');assert.equal(BrowserWindow.getAllWindows().length,1);
 await evaluate(shell,'window.hermesDesktop.selectThread('+JSON.stringify(b)+')');await evaluate(shell,'window.hermesDesktop.activateTab('+JSON.stringify(tab.id)+')');web.focus();web.sendInputEvent({type:'keyDown',keyCode:'Tab',modifiers:['control']});web.sendInputEvent({type:'keyUp',keyCode:'Tab',modifiers:['control']});await until(()=>!pane.view.getVisible(),'focused browser retains app tab shortcut');assert.equal(web.isDestroyed(),false);
 await evaluate(shell,'window.hermesDesktop.activateTab('+JSON.stringify(tab.id)+')');await until(()=>pane.view.getVisible(),'browser retained with tab');assert.equal(web.getURL(),base+'/popup');
 const retainedChat=chat.id,retainedBrowser=web.id;
 await evaluate(chat,'(()=>{const e=document.querySelector("[aria-label=Message]");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(e,"Retained settings draft");e.dispatchEvent(new Event("input",{bubbles:true}));})()');
 await evaluate(chat,'document.querySelector(".message-list").dataset.settingsRetained="yes"');
 await evaluate(shell,'document.querySelector("[aria-label=Settings]").click()');
 await until(()=>settingsForTest().isOpen&&BrowserWindow.getAllWindows().length===2,'Settings opens as a separate native window');
 const settings=settingsForTest().contents;
 await until(()=>evaluate(settings,'!!document.querySelector(".settings-window [role=tablist]")'),'Settings window renders two-column page');
 assert.equal(await evaluate(settings,'!!document.querySelector(".native-workspace,.message-list")'),false,'Settings window has no conversation content');
 assert.equal(pane.view.getVisible()&&tab.view.getVisible(),true,'Session and preview stay visible while Settings is open');
 assert.equal(manager.snapshot(chat).tabActive,true,'Session stays active and usable');
 await evaluate(shell,'document.querySelector("[aria-label=Settings]").click()');await new Promise(r=>setTimeout(r,200));
 assert.equal(BrowserWindow.getAllWindows().length,2,'second click focuses the single Settings window');
 await assert.rejects(evaluate(settings,'window.hermesDesktop.newTab()'),/Settings action unavailable/);
 await assert.rejects(evaluate(settings,'window.hermesDesktop.sendMessage({text:"x",attachmentIds:[]})'),/Settings action unavailable/);
 const count=manager.tabs.size;settings.sendInputEvent({type:'keyDown',keyCode:'w',modifiers:['control']});settings.sendInputEvent({type:'keyUp',keyCode:'w',modifiers:['control']});
 await until(()=>!settingsForTest().isOpen,'Ctrl+W closes only Settings');assert.equal(manager.tabs.size,count,'no workspace tab closed');
 shell.focus();shell.sendInputEvent({type:'keyDown',keyCode:',',modifiers:['control']});shell.sendInputEvent({type:'keyUp',keyCode:',',modifiers:['control']});
 await until(()=>settingsForTest().isOpen,'Ctrl+, opens Settings');
 const reopened=settingsForTest().contents;await until(()=>evaluate(reopened,'!!document.querySelector(".settings-window")'),'reopened Settings renders');
 reopened.sendInputEvent({type:'keyDown',keyCode:'Escape'});reopened.sendInputEvent({type:'keyUp',keyCode:'Escape'});
 await until(()=>!settingsForTest().isOpen&&BrowserWindow.getAllWindows().length===1,'Escape closes only Settings');
 assert.equal(pane.view.getVisible()&&tab.view.getVisible(),true);assert.equal(chat.id,retainedChat);assert.equal(web.id,retainedBrowser);
 assert.equal(await evaluate(chat,'document.querySelector(".message-list").dataset.settingsRetained'),'yes');
 assert.equal(await evaluate(chat,'document.querySelector("[aria-label=Message]").value'),'Retained settings draft');
 window.setSize(720,820);await until(()=>tab.view.getBounds().x===0&&pane.view.getBounds().x+pane.view.getBounds().width===window.getContentSize()[0],'narrow sidebar layout');assert.ok(tab.view.getBounds().width>=400);
 window.setSize(1280,820);await until(()=>tab.view.getBounds().x>0,'wide sidebar restores left navigation');
 await evaluate(shell,'window.hermesDesktop.openBrowser("javascript:alert(1)").then(()=>false,()=>true)').then(result=>assert.equal(result,true));
 await evaluate(shell,'window.hermesDesktop.openBrowser('+JSON.stringify(base+'/download')+')');await until(()=>browser.state(tab.id).error?.includes('Downloads'),'download denied');
 await evaluate(shell,'window.hermesDesktop.openBrowser('+JSON.stringify(base+'/unsafe-redirect')+')');await until(()=>!browser.state(tab.id).loading,'unsafe redirect stopped');assert.doesNotMatch(web.getURL(),/^file:/);
 let external={skipped:true};
 if(process.env.HERMES_TEST_EXTERNAL_BROWSER){const opened=await Promise.race([evaluate(shell,'window.hermesDesktop.openBrowser("https://example.com")').then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),20000))]);if(!opened)await evaluate(shell,'window.hermesDesktop.browserAction("stop")');external={url:web.getURL(),title:web.getTitle(),error:browser.state(tab.id).error||(!opened?'Timed out':undefined)};console.log('EXTERNAL_SITE '+JSON.stringify(external));if(!external.error){assert.equal(external.title,'Example Domain');assert.match(await evaluate(web,'document.body.textContent'),/documentation examples/);}}
 await evaluate(chat,'window.hermesDesktop.previewAttachment("html")');await until(()=>evaluate(web,'document.documentElement.dataset.generated==="ready"'),'generated page restored');
 if(process.env.HERMES_NATIVE_EVIDENCE){fs.mkdirSync(process.env.HERMES_NATIVE_EVIDENCE,{recursive:true});fs.writeFileSync(path.join(process.env.HERMES_NATIVE_EVIDENCE,'desktop-browser-sidebar.png'),(await window.capturePage()).toPNG());}
 await evaluate(shell,'window.hermesDesktop.browserAction("close")');await until(()=>web.isDestroyed()&&!browser.panes.has(tab.id),'close releases browser');assert.equal(chat.isDestroyed(),false);
 const originalDownload=client.download;let release;client.download=async(thread,id)=>{if(id==='html')await new Promise(resolve=>release=resolve);return originalDownload(thread,id);};
 await evaluate(chat,'window.pendingPreview=window.hermesDesktop.previewAttachment("html");void 0');await until(()=>!!release,'delayed preview started');
 const pendingWeb=browser.panes.get(tab.id).view.webContents;await evaluate(shell,'window.hermesDesktop.browserAction("close")');release();await evaluate(chat,'window.pendingPreview');assert.equal(browser.panes.has(tab.id),false);assert.equal(pendingWeb.isDestroyed(),true);
 release=undefined;await evaluate(chat,'window.pendingPreview=window.hermesDesktop.previewAttachment("html");void 0');await until(()=>!!release,'replacement preview started');
 await until(()=>evaluate(shell,'!!document.querySelector(".browser-toolbar input")'),'address toolbar');
 await evaluate(shell,'(()=>{const input=document.querySelector(".browser-toolbar input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,'+JSON.stringify(base+'/address-bar')+');input.dispatchEvent(new Event("input",{bubbles:true}));})()');
 await evaluate(shell,'document.querySelector(".browser-toolbar").requestSubmit()');const replacementWeb=browser.panes.get(tab.id).view.webContents;await until(()=>replacementWeb.getURL()===base+'/address-bar','address bar navigated');release();await evaluate(chat,'window.pendingPreview');assert.equal(replacementWeb.getURL(),base+'/address-bar','late preview cannot overwrite browser navigation');client.download=originalDownload;
 await evaluate(shell,'window.hermesDesktop.browserAction("close")');await until(()=>replacementWeb.isDestroyed(),'replacement browser released');
 await evaluate(shell,'window.hermesDesktop.newTab("p")');const localTab=manager.tabs.get(manager.activeTabId),local=localTab.view.webContents;
 await until(()=>evaluate(local,'!!document.querySelector("input[type=file]")'),'new chat');local.debugger.attach('1.3');const doc=await local.debugger.sendCommand('DOM.getDocument'),node=await local.debugger.sendCommand('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'input[type=file]'});await local.debugger.sendCommand('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[path.join(__dirname,'local.html')]});local.debugger.detach();
 await until(()=>evaluate(local,'document.querySelectorAll(".session-files button").length===2'),'selected local file');const before=downloads.length;
 await evaluate(local,'document.querySelectorAll(".session-files button")[1].click()');await until(()=>browser.panes.has(localTab.id),'local preview pane');const localWeb=browser.panes.get(localTab.id).view.webContents;await until(()=>evaluate(localWeb,'!!document.querySelector("#local")'),'local HTML preview');assert.equal(downloads.length,before,'local preview has no authenticated download');
 localWeb.focus();localWeb.sendInputEvent({type:'keyDown',keyCode:'W',modifiers:['control']});await until(()=>localWeb.isDestroyed()&&!manager.tabs.has(localTab.id),'focused browser close shortcut releases only its tab');assert.equal(window.isDestroyed(),false);
 await evaluate(chat,'window.hermesDesktop.previewAttachment("html")');const lastWeb=browser.panes.get(tab.id).view.webContents;service.connection={...service.connection,id:'b'.repeat(24)};service.changed();await until(()=>lastWeb.isDestroyed()&&browser.panes.size===0,'identity switch releases browsers');
 console.log('BROWSER_SIDEBAR_OK '+JSON.stringify({ua,networkUa,html:true,relativeAssets:true,image:true,pdfEmbed:true,textEscaped:true,localDraft:true,links:true,history:true,layout:true,isolation:true,permissionsDenied:true,downloadDenied:true,lifecycle:true,external}));server.close();app.exit(0);
})().catch(error=>{console.error(error.stack);server.close();app.exit(1)});
`);
    const output=execFileSync('xvfb-run',['-a',require('electron'),'--no-sandbox',join(folder,'harness.cjs')],{encoding:'utf8',timeout:110000,env:process.env,maxBuffer:2_000_000});
    assert.match(output,/BROWSER_SIDEBAR_OK/);console.log(output.trim());
  } finally {await rm(folder,{recursive:true,force:true});}
});
