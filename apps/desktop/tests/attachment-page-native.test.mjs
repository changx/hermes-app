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
test('Electron: a published HTML attachment opens as a web page with its images, in the sidebar and in the system browser', {skip:!process.env.HERMES_TEST_ELECTRON,timeout:120000},async()=>{
  const root=new URL('..',import.meta.url).pathname,folder=await mkdtemp(join(tmpdir(),'hermes-attachment-page-'));
  try {
    await cp(join(root,'dist'),join(folder,'dist'),{recursive:true});
    const bundle=await build({entryPoints:[join(root,'src/main/index.ts')],bundle:true,platform:'node',format:'cjs',external:['electron'],write:false,plugins:[{name:'test-exports',setup(b){b.onLoad({filter:/src\/main\/index\.ts$/},async args=>({contents:await readFile(args.path,'utf8')+'\nexport {service}; export const sidebarForTest=()=>browser; export const tabsForTest=()=>tabs;\n',loader:'ts'}));}}]});
    await writeFile(join(folder,'dist/main/index.cjs'),bundle.outputFiles[0].text);
    await writeFile(join(folder,'harness.cjs'),String.raw`
const {app,BrowserWindow,nativeImage,shell:system}=require('electron');
const appWindows=()=>BrowserWindow.getAllWindows().filter(w=>w.isFocusable());const assert=require('node:assert/strict'),http=require('node:http'),path=require('node:path');
app.setPath('userData',path.join(__dirname,'user-data'));app.commandLine.appendSwitch('disable-gpu');
const systemOpened=[];system.openExternal=async url=>{systemOpened.push(url);};
const {service:accounts,sidebarForTest,tabsForTest}=require('./dist/main/index.cjs');
const service=accounts.primary;
const png=nativeImage.createFromBitmap(Buffer.from([0,0,255,255]),{width:1,height:1}).toPNG();
const PAGE='att_'+'a'.repeat(32),IMAGE='att_'+'b'.repeat(32),a='th_aaaaaaaa',pages=new Map(),downloads=[],served=[];
// The connection's own server: it serves the published page folder, as plugin 0.2.51 does.
const server=http.createServer((req,res)=>{served.push(req.url);
  if(req.url==='/media/'+PAGE+'/site/report.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><title>Published report</title><h1 id="page">Report</h1><img id="pic" src="assets/p.png">');return;}
  if(req.url==='/media/'+PAGE+'/site/assets/p.png'){res.writeHead(200,{'Content-Type':'image/png'});res.end(png);return;}
  res.writeHead(404);res.end();});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const html={id:PAGE,thread_id:a,name:'report.html',mime:'application/octet-stream',size:200,state:'available',site_path:'/media/'+PAGE+'/site/report.html'};
 const image={id:IMAGE,thread_id:a,name:'pixel.png',mime:'image/png',size:png.length,state:'available'};
 const client={channels:new Map([['p',{id:'p',name:'Fixture project'}]]),threads:new Map([[a,{id:a,project_id:'p',title:'Page session',last_message_at:1}]]),messages:new Map(),receipts:new Map(),interactions:new Map(),attachments:new Map([[PAGE,html],[IMAGE,image]]),isCatalogueReady:true,supportsLatest:true,
  isThreadAvailable:id=>client.threads.has(id),page:id=>pages.get(id),releasePage(id){pages.delete(id);client.messages.delete(id);},acquirePage(id){if(!pages.has(id))pages.set(id,{messages:client.messages,async openConversation(){client.messages.set(id,[
   {id:'m1',ref_seq:1,role:'assistant',text:'Report',attachments:[html,image]}]);service.changed();}});return pages.get(id);},
  async getAttachment(thread,id){const item=client.attachments.get(id);return item?.thread_id===thread?item:undefined;},async download(thread,id){downloads.push(id);return new Uint8Array(id===IMAGE?png:Buffer.from('<p>bare file</p>'));},
  async downloadFile(){throw Error('the page must not download');},close(){},};
 service.initialize=async()=>{service.phase='connected';service.connectionState='online';service.connection={id:'a'.repeat(24),baseUrl:base,token:'test-only-never-browser'};service.client=client;service.selectedChannelId='p';service.localDraftStore={async list(){return{}},async put(){},async clear(){}};service.changed();};
 const evaluate=(contents,code)=>contents.executeJavaScript(code,true).catch(error=>{throw Error('Renderer script failed: '+code.slice(0,200)+' '+error.message)});
 async function until(check,label){console.log('CHECK '+label);const end=Date.now()+12000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,25));}throw Error('Timed out: '+label);}
 const click=(contents,name,label)=>evaluate(contents,'(()=>{const row=[...document.querySelectorAll(".attachment-row")].find(e=>e.textContent.includes('+JSON.stringify(name)+'));[...row.querySelectorAll("button")].find(e=>e.textContent==='+JSON.stringify(label)+').click()})()');
 await app.whenReady();await until(()=>appWindows().length,'window');const window=appWindows()[0],shell=window.webContents;
 await until(()=>evaluate(shell,'!!document.querySelector(".native-workspace")'),'workspace');
 await evaluate(shell,'window.hermesDesktop.selectThread('+JSON.stringify(a)+')');const tab=[...tabsForTest().tabs.values()][0],chat=tab.view.webContents,browser=sidebarForTest();
 await until(()=>evaluate(chat,'document.querySelectorAll(".attachment-row").length===2'),'two attachment cards');
 const pageUrl=base+'/media/'+PAGE+'/site/report.html';
 // The card links the page on this connection's server; the image card keeps no page link.
 assert.equal(await evaluate(chat,'[...document.querySelectorAll(".attachment-row")].find(e=>e.textContent.includes("report.html")).querySelector("a")?.href'),pageUrl);
 assert.equal(await evaluate(chat,'[...document.querySelectorAll(".attachment-row")].find(e=>e.textContent.includes("pixel.png")).querySelector("a")'),null);
 // Preview: the sidebar loads the page from the server, and its relative image loads too.
 await click(chat,'report.html','Preview');
 await until(()=>browser.panes.has(tab.id),'pane created');const web=browser.panes.get(tab.id).view.webContents;
 await until(()=>web.getURL()===pageUrl,'sidebar at the page link');
 await until(()=>evaluate(web,'(i=>!!i&&i.complete&&i.naturalWidth===1)(document.getElementById("pic"))'),'page image loaded from its folder');
 assert.ok(served.includes('/media/'+PAGE+'/site/assets/p.png'),'image requested under the page folder');
 assert.equal(downloads.includes(PAGE),false,'Preview of a page downloads no bare file');
 // Open externally: the system browser gets the page link; nothing downloads.
 await click(chat,'report.html','Open externally');
 await until(()=>systemOpened.includes(pageUrl),'system browser opens the page');
 assert.equal(downloads.includes(PAGE),false,'Open externally of a page downloads no bare file');
 // Preview of the image: the gallery leaves the page out, so it is a single-file preview.
 await click(chat,'pixel.png','Preview');
 await until(()=>evaluate(web,'!document.getElementById("track")&&document.querySelector("img")?.naturalWidth===1').catch(()=>false),'image preview without the page in a gallery');
 assert.equal(downloads.includes(PAGE),false);
 console.log('ATTACHMENT_PAGE_OK '+JSON.stringify({served,systemOpened}));server.close();app.exit(0);
})().catch(error=>{console.error(error.stack);app.exit(1)});
`);
    const output=execFileSync('xvfb-run',['-a',require('electron'),'--no-sandbox',join(folder,'harness.cjs')],{encoding:'utf8',timeout:110000,env:process.env,maxBuffer:2_000_000});
    assert.match(output,/ATTACHMENT_PAGE_OK/);console.log(output.trim());
  } finally {await rm(folder,{recursive:true,force:true});}
});
