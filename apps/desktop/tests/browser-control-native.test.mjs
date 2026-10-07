// Real Electron (Linux/Xvfb) check of the App-side browser executor: native input only, isolated-world
// page reader, takeover/handoff state, permissions, downloads and per-Project login partitions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);

test('Electron: Agent operates the built-in browser with native input and the user can take over', { skip: !process.env.HERMES_TEST_ELECTRON, timeout: 150000 }, async () => {
  const root = new URL('..', import.meta.url).pathname, folder = await mkdtemp(join(tmpdir(), 'hermes-browser-control-'));
  try {
    const bundle = await build({ entryPoints: [join(root, 'src/main/browser-sidebar.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], write: false });
    await writeFile(join(folder, 'sidebar.cjs'), bundle.outputFiles[0].text);
    await cp(join(root, 'dist/preload/browser-page.cjs'), join(folder, 'browser-page.cjs'));
    await writeFile(join(folder, 'harness.cjs'), String.raw`
const {app,BrowserWindow}=require('electron');const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
app.setPath('userData',path.join(__dirname,'user-data'));app.commandLine.appendSwitch('disable-gpu');
const {DesktopBrowserSidebar,browserPartition}=require('./sidebar.cjs');
const page=(title,body)=>'<!doctype html><meta charset="utf-8"><title>'+title+'</title><script>window.log=[];for(const t of ["mousedown","click","keydown","beforeinput","input"])addEventListener(t,e=>log.push(t+":"+e.isTrusted+":"+(e.target.id||"")),true)</script>'+body;
const server=http.createServer((req,res)=>{
  if(req.url==='/download'){res.writeHead(200,{'Content-Disposition':'attachment; filename=report.txt','Content-Type':'application/octet-stream'});res.end('saved file');return;}
  if(req.url==='/login'){res.writeHead(200,{'Set-Cookie':'login=yes; Path=/','Content-Type':'text/html'});res.end(page('Login','<p>signed in</p>'));return;}
  if(req.url==='/whoami'){res.writeHead(200,{'Content-Type':'text/html'});res.end(page('Who',('<p id=who>'+(req.headers.cookie||'nobody')+'</p>')));return;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  if(req.url==='/form')return res.end(page('Form','<h1>Order form</h1><p>Fill in your name.</p><label for=name>Your name</label><input id=name><textarea id=notes placeholder="Notes"></textarea><button id=go onclick="document.title=\'clicked\'">Go</button><a id=next href="/next">Next page</a><button id=pop onclick="window.open(\'/next\',\'popup\',\'width=400,height=400\')">Sign in with popup</button><form action="/submitted"><input id=q name=q aria-label="Search"></form><iframe src="/inner" width=300 height=120></iframe>'));
  if(req.url==='/inner')return res.end('<!doctype html><button id=inner onclick="parent.document.title=\'inner clicked\'">Inner button</button>');
  if(req.url==='/long')return res.end(page('Long','<h1>Top</h1><div style="height:5000px">tall</div><p>Bottom</p>'));
  res.end(page('Page '+req.url,'<h1 id=page>'+req.url+'</h1>'));
});
const until=async(check,label,ms=12000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,25));}throw Error('Timed out: '+label);};
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  await app.whenReady();
  const window=new BrowserWindow({width:1200,height:800,show:true});await window.loadURL('about:blank');
  const asked=[],downloads=path.join(__dirname,'downloads');let changes=0;
  const partitions={a:browserPartition('server','p1'),b:browserPartition('server','p1'),c:browserPartition('server','p2')};
  const sidebar=new DesktopBrowserSidebar(window,()=>changes++,undefined,{preload:path.join(__dirname,'browser-page.cjs'),partitionFor:id=>partitions[id],askPermission:async(host,text)=>{asked.push(host+' '+text);return false;},downloadsDirectory:()=>downloads});
  sidebar.setBounds({x:600,y:0,width:600,height:800,visible:true});sidebar.layout('a',true);
  const run=(id,action,args={},signal=new AbortController().signal,timeout=30000)=>sidebar.command(id,action,args,signal,timeout);
  const web=()=>sidebar.panes.get('a').view.webContents,main=code=>web().executeJavaScript(code);
  const nav=await run('a','navigate',{url:base+'/form'});assert.equal(nav.url,base+'/form');assert.equal(nav.title,'Form');
  assert.equal(sidebar.state('a').control,'agent','Hermes working is visible');
  const before=await main('document.documentElement.outerHTML'),globals=await main('Object.keys(window).length');
  const snap=await run('a','snapshot');
  assert.match(snap.text,/# Order form/);assert.match(snap.text,/\[e\d+\] textbox "Your name"/);assert.match(snap.text,/\[e\d+\] button "Go"/);assert.match(snap.text,/\[e\d+\] link "Next page"/);assert.match(snap.text,/\[e\d+\] button "Inner button"/,'same-origin frame is read');
  assert.equal(await main('document.documentElement.outerHTML'),before,'reading the page never changes the DOM');assert.equal(await main('Object.keys(window).length'),globals,'nothing is exposed to the page');
  assert.equal(await main('typeof require+typeof process+typeof ipcRenderer'),'undefinedundefinedundefined');
  const ref=label=>new RegExp('\\[(e\\d+)\\] [a-z]+ "'+label+'"').exec(snap.text)[1];
  const clicked=await run('a','click',{ref:ref('Go')});assert.equal(clicked.title,'clicked');
  assert.ok((await main('log')).includes('click:true:go'),'native click is trusted');
  const typed=await run('a','type',{ref:ref('Your name'),text:'你好 Hermes'});assert.equal(typed.value,'你好 Hermes');
  assert.equal(await main('document.querySelector("#name").value'),'你好 Hermes');assert.ok((await main('log')).includes('beforeinput:true:name'));
  await run('a','type',{ref:ref('Your name'),text:'Replaced'});assert.equal(await main('document.querySelector("#name").value'),'Replaced','typing replaces the field');
  await run('a','press',{key:'Escape'});assert.ok((await main('log')).some(e=>e.startsWith('keydown:true')));
  await run('a','click',{ref:ref('Inner button')});await until(()=>web().getTitle()==='inner clicked','same-origin frame click');
  const windows=BrowserWindow.getAllWindows().length;await run('a','click',{ref:ref('Sign in with popup')});await until(()=>BrowserWindow.getAllWindows().length===windows+1,'sign-in popup opens as a real window');
  for(const w of BrowserWindow.getAllWindows())if(w!==window)w.destroy();
  const submitted=await run('a','type',{ref:ref('Search'),text:'electron',submit:true});assert.match(submitted.url,/\/submitted\?q=electron$/);
  const back=await run('a','back');assert.equal(back.url,base+'/form');
  await run('a','navigate',{url:base+'/long'});const scrolled=await run('a','scroll',{direction:'down'});assert.ok(scrolled.scrollY>200,'scroll moved '+scrolled.scrollY);
  const shot=await run('a','screenshot');const jpeg=Buffer.from(shot.jpeg_base64,'base64');assert.equal(jpeg[0],0xff);assert.equal(jpeg[1],0xd8);assert.ok(shot.width>100);
  await assert.rejects(run('a','click',{ref:'e9999'}),e=>e.code==='stale_ref');
  // Takeover: a real press that Hermes did not inject pauses Hermes; the next action waits for "Let Hermes continue".
  await run('a','navigate',{url:base+'/form'});web().sendInputEvent({type:'mouseDown',x:20,y:20,button:'left',clickCount:1});web().sendInputEvent({type:'mouseUp',x:20,y:20,button:'left',clickCount:1});
  await until(()=>sidebar.state('a').control==='user','user takeover');assert.match(sidebar.state('a').controlMessage,/took over/);
  let resumed=false;const waiting=run('a','snapshot').then(r=>{resumed=true;return r;});await new Promise(r=>setTimeout(r,400));assert.equal(resumed,false,'paused while the user works');
  sidebar.control('a','resume');assert.match((await waiting).text,/Order form/);
  // Stop from the sidebar and cancellation from the server.
  sidebar.control('a','stop');assert.equal(sidebar.state('a').control,'user');const stopper=new AbortController();const cancelled=run('a','snapshot',{},stopper.signal);setTimeout(()=>stopper.abort(),100);await assert.rejects(cancelled,e=>e.code==='cancelled');
  sidebar.control('a','resume');
  // Handoff: Hermes waits until the user clicks Done.
  const handoff=run('a','handoff',{message:'Please sign in, then click Done.'},undefined,600000);await until(()=>sidebar.state('a').control==='waiting','handoff shown');
  assert.equal(sidebar.state('a').controlMessage,'Please sign in, then click Done.');sidebar.control('a','done');assert.equal((await handoff).done,true);assert.equal(sidebar.state('a').control,undefined);
  // Normal-browser permissions: the user is asked; downloads are saved.
  assert.equal(await main('Notification.requestPermission()'),'denied');assert.deepEqual(asked,['127.0.0.1:'+server.address().port+' show notifications']);
  await run('a','navigate',{url:base+'/download'});await until(()=>sidebar.state('a').notice?.includes('report.txt'),'download saved');assert.equal(fs.readFileSync(path.join(downloads,'report.txt'),'utf8'),'saved file');
  // Logins are shared inside a Project and isolated between Projects.
  await run('a','navigate',{url:base+'/login'});
  await run('b','navigate',{url:base+'/whoami'});assert.equal(await sidebar.panes.get('b').view.webContents.executeJavaScript('who.textContent'),'login=yes');
  await run('c','navigate',{url:base+'/whoami'});assert.equal(await sidebar.panes.get('c').view.webContents.executeJavaScript('who.textContent'),'nobody');
  // Background page keeps a real size for layout and screenshots.
  sidebar.layout('a',true);const hidden=sidebar.panes.get('c').view;assert.equal(hidden.getVisible(),false);assert.ok(hidden.getBounds().width>=600);
  sidebar.remove('a');assert.equal(sidebar.panes.has('a'),false);
  const persisted=require('electron').session.fromPartition(partitions.b);assert.ok((await persisted.cookies.get({name:'login'})).length===1,'closing a page keeps the Project login');
  console.log('BROWSER_CONTROL_NATIVE_OK');server.close();app.exit(0);
})().catch(error=>{console.error(error.stack);server.close();app.exit(1);});
`);
    const output = execFileSync('xvfb-run', ['-a', require('electron'), '--no-sandbox', join(folder, 'harness.cjs')], { encoding: 'utf8', timeout: 140000, env: process.env, maxBuffer: 2_000_000 });
    assert.match(output, /BROWSER_CONTROL_NATIVE_OK/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
