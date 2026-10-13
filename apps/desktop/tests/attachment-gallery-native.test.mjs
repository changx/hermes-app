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
test('Electron: Preview opens the Session attachments as a gallery that moves by swipe, keys and buttons', {skip:!process.env.HERMES_TEST_ELECTRON,timeout:120000},async()=>{
  const root=new URL('..',import.meta.url).pathname,folder=await mkdtemp(join(tmpdir(),'hermes-attachment-gallery-'));
  try {
    await cp(join(root,'dist'),join(folder,'dist'),{recursive:true});
    const bundle=await build({entryPoints:[join(root,'src/main/index.ts')],bundle:true,platform:'node',format:'cjs',external:['electron'],write:false,plugins:[{name:'test-exports',setup(b){b.onLoad({filter:/src\/main\/index\.ts$/},async args=>({contents:await readFile(args.path,'utf8')+'\nexport {service}; export const sidebarForTest=()=>browser; export const tabsForTest=()=>tabs;\n',loader:'ts'}));}}]});
    await writeFile(join(folder,'dist/main/index.cjs'),bundle.outputFiles[0].text);
    await writeFile(join(folder,'harness.cjs'),String.raw`
const {app,BrowserWindow,nativeImage}=require('electron');
const appWindows=()=>BrowserWindow.getAllWindows().filter(w=>w.isFocusable());const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
app.setPath('userData',path.join(__dirname,'user-data'));app.commandLine.appendSwitch('disable-gpu');
const {service:accounts,sidebarForTest,tabsForTest}=require('./dist/main/index.cjs');
const service=accounts.primary;
const downloads=[],a='th_aaaaaaaa',pages=new Map();
const png=nativeImage.createFromBitmap(Buffer.from([0,0,255,255]),{width:1,height:1}).toPNG();
function wav(){const rate=8000,samples=rate,data=Buffer.alloc(44+samples*2);data.write('RIFF',0);data.writeUInt32LE(36+samples*2,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(rate,24);data.writeUInt32LE(rate*2,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)data.writeInt16LE(Math.round(Math.sin(i/rate*2*Math.PI*440)*8000),44+i*2);return data;}
function pdf(){const stream='BT /F1 18 Tf 20 100 Td (Gallery PDF fixture) Tj ET';const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream'];let data='%PDF-1.4\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(data));data+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n';}const start=Buffer.byteLength(data);data+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF';return Buffer.from(data);}
const fixtures=[['html','generated.html','text/html',Buffer.from('<!doctype html><title>Generated page</title><link rel="stylesheet" href="styles.css"><h1 id="generated">Generated preview</h1><script src="logic.js"></script>')],['css','styles.css','text/css',Buffer.from('h1{color:rgb(12,34,56)}')],['js','logic.js','text/javascript',Buffer.from('document.documentElement.dataset.generated="ready"')],
 ['png','pixel.png','image/png',png],['txt','notes.txt','text/plain',Buffer.from('<script>window.evil=true</script>\nReadable notes')],['pdf','document.pdf','application/pdf',pdf()],['md','notes.md','text/markdown',Buffer.from('# Markdown title\n\n![pixel](pixel.png)\n')],
 ['mp4','clip.mp4','video/mp4',fs.readFileSync(${JSON.stringify(new URL('./fixtures/preview-video.mp4', import.meta.url).pathname)})],['wav','tone.wav','audio/wav',wav()]];
const order=['html','png','txt','pdf','md','mp4','wav'];
const data=new Map(fixtures.map(([id,name,mime,bytes])=>[id,{bytes,attachment:{id,thread_id:a,name,mime,size:bytes.length,state:'available'}}]));
// Two messages: the gallery spans messages, in message order.
const client={channels:new Map([['p',{id:'p',name:'Fixture project'}]]),threads:new Map([[a,{id:a,project_id:'p',title:'Gallery session',last_message_at:1}]]),messages:new Map(),receipts:new Map(),interactions:new Map(),attachments:new Map([...data].map(([id,f])=>[id,f.attachment])),isCatalogueReady:true,supportsLatest:true,
 isThreadAvailable:id=>client.threads.has(id),page:id=>pages.get(id),releasePage(id){pages.delete(id);client.messages.delete(id);},acquirePage(id){if(!pages.has(id))pages.set(id,{messages:client.messages,async openConversation(){client.messages.set(id,[
  {id:'m1',ref_seq:1,role:'user',text:'First files',attachments:order.slice(0,4).map(id=>data.get(id).attachment)},
  {id:'m2',ref_seq:2,role:'assistant',text:'More files',attachments:order.slice(4).map(id=>data.get(id).attachment)}]);service.changed();}});return pages.get(id);},
 async getAttachment(thread,id){const item=data.get(id)?.attachment;return item?.thread_id===thread?item:undefined;},async download(thread,id){downloads.push(id);return new Uint8Array(data.get(id).bytes);},close(){},};
service.initialize=async()=>{service.phase='connected';service.connectionState='online';service.connection={id:'a'.repeat(24),baseUrl:'https://controlled.example.test',token:'test-only-never-browser'};service.client=client;service.selectedChannelId='p';service.localDraftStore={async list(){return{}},async put(){},async clear(){}};service.changed();};
const evaluate=(contents,code)=>contents.executeJavaScript(code,true).catch(error=>{throw Error('Renderer script failed: '+code.slice(0,200)+' '+error.message)});
async function until(check,label){console.log('CHECK '+label);const end=Date.now()+12000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,25));}throw Error('Timed out: '+label);}
(async()=>{
 await app.whenReady();await until(()=>appWindows().length,'window');const window=appWindows()[0],shell=window.webContents;
 await until(()=>evaluate(shell,'!!document.querySelector(".native-workspace")'),'workspace');
 await evaluate(shell,'window.hermesDesktop.selectThread('+JSON.stringify(a)+')');const manager=tabsForTest(),tab=[...manager.tabs.values()][0],chat=tab.view.webContents,browser=sidebarForTest();
 await until(()=>evaluate(chat,'document.querySelectorAll(".attachment-row").length===7'),'attachment cards in two messages');
 // The user clicks Preview on the second file of the first message.
 await evaluate(chat,'(()=>{const row=[...document.querySelectorAll(".attachment-row")].find(e=>e.textContent.includes("pixel.png"));[...row.querySelectorAll("button")].find(e=>e.textContent==="Preview").click()})()');
 await until(()=>browser.panes.has(tab.id),'pane created');const web=browser.panes.get(tab.id).view.webContents;
 const state=()=>evaluate(web,'(()=>{const t=document.getElementById("track");if(!t)return null;return {title:document.title,counter:document.getElementById("counter").textContent,index:Math.round(t.scrollLeft/t.clientWidth),filled:[...t.children].map(s=>s.childElementCount),prev:document.getElementById("prev").disabled,next:document.getElementById("next").disabled};})()');
 const at=async(index,name)=>{await until(async()=>{const s=await state();return s&&s.index===index&&s.title===name&&s.counter===(index+1)+' / 7';},'slide '+index+' '+name);};
 await at(1,'pixel.png');
 await until(()=>evaluate(web,'(i=>!!i&&i.complete&&i.naturalWidth===1)(document.querySelectorAll(".slide")[1].querySelector("img"))'),'image slide shown');
 await until(()=>browser.state(tab.id).title==='pixel.png','toolbar title follows the slide');
 let s=await state();assert.deepEqual(s.filled,[1,1,1,0,0,0,0],'only the current slide and its neighbours hold content');
 await until(()=>downloads.includes('txt'),'neighbour downloads ahead');assert.equal(downloads.some(id=>['pdf','md','mp4','wav'].includes(id)),false,'far slides do not download');
 // Neighbour HTML: sandboxed frame without this origin; its own script and relative assets work.
 const frameFor=name=>web.mainFrame.framesInSubtree.find(f=>f.url.endsWith('/'+encodeURIComponent(name)));
 await until(async()=>{const f=frameFor('generated.html');return !!f&&await f.executeJavaScript('document.documentElement.dataset.generated').catch(()=>null)==='ready';},'HTML slide runs its script and relative JS');
 assert.equal(await frameFor('generated.html').executeJavaScript('origin+"|"+getComputedStyle(document.querySelector("h1")).color'),'null|rgb(12, 34, 56)','HTML runs sandboxed with relative CSS');
 assert.equal(await evaluate(web,'typeof window.hermesDesktop+":"+typeof require+":"+typeof process'),'undefined:undefined:undefined');
 assert.equal(await evaluate(web,'fetch("/__hermes_preview__/markdown-preview.js").then(r=>r.status,()=>"blocked")'),'blocked','gallery page cannot fetch');
 // Keyboard: right arrow moves on.
 web.focus();web.sendInputEvent({type:'keyDown',keyCode:'Right'});web.sendInputEvent({type:'keyUp',keyCode:'Right'});
 await at(2,'notes.txt');
 await until(async()=>{const f=frameFor('notes.txt');return !!f&&await f.executeJavaScript('document.querySelector("pre")?.textContent.includes("<script>")&&window.evil===undefined').catch(()=>false);},'text slide escaped');
 // Trackpad: a horizontal two-finger scroll over the slide moves to the next one (the text frame chains the scroll).
 const box=browser.panes.get(tab.id).view.getBounds(),x=Math.round(box.width/2),y=Math.round(box.height/2);
 for(let i=0;i<12;i++){web.sendInputEvent({type:'mouseWheel',x,y,deltaX:-60,deltaY:0,canScroll:true,hasPreciseScrollingDeltas:true});await new Promise(r=>setTimeout(r,16));}
 await at(3,'document.pdf');
 const pdfPage=async()=>{const bitmap=(await web.capturePage()).toBitmap();let white=0;for(let i=0;i<bitmap.length;i+=4)if(bitmap[i]>245&&bitmap[i+1]>245&&bitmap[i+2]>245)white++;return white>2000;};
 await until(()=>web.mainFrame.framesInSubtree.some(f=>f.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/')),'PDF viewer frame inside the gallery');
 await until(pdfPage,'PDF slide rendered');
 s=await state();assert.equal(s.filled[0],0,'far slide released');
 // Button: next.
 await evaluate(web,'document.getElementById("next").click()');await at(4,'notes.md');
 await until(async()=>{const f=frameFor('notes.md');return !!f&&await f.executeJavaScript('document.querySelector(".message-markdown h1")?.textContent==="Markdown title"&&(i=>!!i&&i.complete&&i.naturalWidth===1)(document.querySelector("img[alt=pixel]"))').catch(()=>false);},'Markdown slide with sibling image');
 await evaluate(web,'document.getElementById("next").click()');await at(5,'clip.mp4');
 await until(()=>evaluate(web,'(v=>!!v&&v.readyState>=1&&v.videoWidth===32)(document.querySelectorAll(".slide")[5].querySelector("video"))'),'video slide metadata');
 await evaluate(web,'(v=>{v.muted=true;return v.play()})(document.querySelectorAll(".slide")[5].querySelector("video"))');await until(()=>evaluate(web,'!document.querySelectorAll(".slide")[5].querySelector("video").paused'),'video plays');
 await evaluate(web,'document.getElementById("next").click()');await at(6,'tone.wav');
 assert.equal(await evaluate(web,'document.querySelectorAll(".slide")[5].querySelector("video").paused'),true,'leaving a slide pauses its media');
 await until(()=>evaluate(web,'(v=>!!v&&v.readyState>=1&&Math.abs(v.duration-1)<0.1)(document.querySelectorAll(".slide")[6].querySelector("audio"))'),'audio slide metadata');
 s=await state();assert.equal(s.next,true,'no next button on the last slide');assert.equal(s.prev,false);
 // Reload keeps the gallery usable; the pane width change keeps the same slide.
 await evaluate(shell,'window.hermesDesktop.browserAction("reload")');await at(1,'pixel.png');
 window.setSize(1100,820);await new Promise(r=>setTimeout(r,300));await at(1,'pixel.png');
 if(process.env.HERMES_NATIVE_EVIDENCE){fs.mkdirSync(process.env.HERMES_NATIVE_EVIDENCE,{recursive:true});fs.writeFileSync(path.join(process.env.HERMES_NATIVE_EVIDENCE,'attachment-gallery.png'),(await window.capturePage()).toPNG());}
 // One file in a message with one attachment still opens the plain single-file preview.
 await evaluate(chat,'window.hermesDesktop.previewAttachment("png")');await until(()=>evaluate(web,'!document.getElementById("track")&&document.querySelector("img")?.naturalWidth===1'),'single preview without sequence');
 console.log('ATTACHMENT_GALLERY_OK '+JSON.stringify({downloads}));app.exit(0);
})().catch(error=>{console.error(error.stack);app.exit(1)});
`);
    const output=execFileSync('xvfb-run',['-a',require('electron'),'--no-sandbox',join(folder,'harness.cjs')],{encoding:'utf8',timeout:110000,env:process.env,maxBuffer:2_000_000});
    assert.match(output,/ATTACHMENT_GALLERY_OK/);console.log(output.trim());
  } finally {await rm(folder,{recursive:true,force:true});}
});
