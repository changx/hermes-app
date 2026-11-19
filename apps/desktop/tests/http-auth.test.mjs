// Built-in browser HTTP authentication (401/407): sheet text, shared sheets, and the real sheet in Electron.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);

const compiled = await build({ entryPoints: [new URL('../src/main/http-auth-window.ts', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', external: ['electron'], write: false });
const mod = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(name => name === 'electron' ? {} : require(name), mod, mod.exports);
const { httpAuthChallenge, httpAuthKey } = mod.exports;

const info = { isProxy: false, scheme: 'basic', host: 'router.local', port: 80, realm: 'Admin <script>' };

test('http auth sheet text: host with a non-default port, never the realm', () => {
  assert.deepEqual(httpAuthChallenge('http://router.local/', info), { host: 'router.local', proxy: false, secure: false });
  assert.deepEqual(httpAuthChallenge('https://router.local:8443/x', { ...info, port: 8443 }), { host: 'router.local:8443', proxy: false, secure: true });
  assert.deepEqual(httpAuthChallenge('https://site.test/', { ...info, isProxy: true, host: 'proxy.test', port: 3128 }), { host: 'proxy.test:3128', proxy: true, secure: true });
  assert.deepEqual(httpAuthChallenge('not a url', { ...info, port: 443 }), { host: 'router.local:443', proxy: false, secure: false });
  assert.equal(JSON.stringify(httpAuthChallenge('http://router.local/', info)).includes('Admin'), false);
});

test('http auth: one sheet per server and realm', () => {
  assert.equal(httpAuthKey(info), httpAuthKey({ ...info, host: 'ROUTER.local', scheme: 'Basic' }));
  assert.notEqual(httpAuthKey(info), httpAuthKey({ ...info, realm: 'Other' }));
  assert.notEqual(httpAuthKey(info), httpAuthKey({ ...info, port: 8080 }));
  assert.notEqual(httpAuthKey(info), httpAuthKey({ ...info, isProxy: true }));
});

test('Electron: built-in browser asks for HTTP credentials in a sheet and signs in', { skip: !process.env.HERMES_TEST_ELECTRON, timeout: 120000 }, async () => {
  const root = new URL('..', import.meta.url).pathname, folder = await mkdtemp(join(tmpdir(), 'hermes-http-auth-'));
  try {
    await cp(join(root, 'dist'), join(folder, 'dist'), { recursive: true });
    const bundle = await build({ entryPoints: [join(root, 'src/main/index.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], write: false,
      plugins: [{ name: 'test-exports', setup(b) { b.onLoad({ filter: /src\/main\/index\.ts$/ }, async args => ({ contents: await readFile(args.path, 'utf8') + '\nexport {service}; export const sidebarForTest=()=>browser; export const tabsForTest=()=>tabs;\n', loader: 'ts' })); } }] });
    await writeFile(join(folder, 'dist/main/index.cjs'), bundle.outputFiles[0].text);
    await writeFile(join(folder, 'harness.cjs'), String.raw`
const {app,BrowserWindow,webContents}=require('electron');const assert=require('node:assert/strict'),http=require('node:http'),path=require('node:path');
app.setPath('userData',path.join(__dirname,'user-data'));app.commandLine.appendSwitch('disable-gpu');
const {service:accounts,sidebarForTest,tabsForTest}=require('./dist/main/index.cjs');const service=accounts.primary;
const good='Basic '+Buffer.from('admin:s3cret pass').toString('base64'),seen=[];let base;
const server=http.createServer((req,res)=>{seen.push({url:req.url,authorization:req.headers.authorization});
 if(req.url.startsWith('/private')&&req.headers.authorization!==good){res.writeHead(401,{'WWW-Authenticate':'Basic realm="Router <b>admin</b>"','Content-Type':'text/html'});res.end('<title>Denied</title><h1 id="denied">401</h1>');return;}
 res.writeHead(200,{'Content-Type':'text/html'});res.end('<title>Inside</title><h1 id="inside">Inside '+req.url+'</h1>');});
const a='th_aaaaaaaa',pages=new Map();
const client={channels:new Map([['p',{id:'p',name:'Fixture project'}]]),threads:new Map([[a,{id:a,project_id:'p',title:'Auth session',last_message_at:1}]]),messages:new Map(),receipts:new Map(),interactions:new Map(),attachments:new Map(),isCatalogueReady:true,supportsLatest:true,
 isThreadAvailable:id=>client.threads.has(id),page:id=>pages.get(id),releasePage(id){pages.delete(id);client.messages.delete(id);},acquirePage(id){if(!pages.has(id))pages.set(id,{messages:client.messages,async openConversation(){client.messages.set(id,[]);service.changed();}});return pages.get(id);},close(){}};
service.initialize=async()=>{service.phase='connected';service.connectionState='online';service.connection={id:'a'.repeat(24),baseUrl:'https://controlled.example.test',token:'test-only'};service.client=client;service.selectedChannelId='p';service.localDraftStore={async list(){return{}},async put(){},async clear(){}};service.changed();};
const evaluate=(c,code)=>c.executeJavaScript(code,true);
async function until(check,label){console.log('CHECK '+label);const end=Date.now()+15000;while(Date.now()<end){try{if(await check())return;}catch{}await new Promise(r=>setTimeout(r,25));}throw Error('Timed out: '+label);}
const sheets=()=>BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed()&&w.webContents.getURL().endsWith('/http-auth.html'));
async function sheet(){await until(async()=>{const s=sheets()[0];return s&&s.isVisible()&&await evaluate(s.webContents,'!!document.querySelector("#message").textContent');},'sign-in sheet');return sheets()[0];}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 await app.whenReady();await until(()=>BrowserWindow.getAllWindows().some(w=>w.isFocusable()),'window');const window=BrowserWindow.getAllWindows().find(w=>w.isFocusable()),shell=window.webContents;
 await until(()=>evaluate(shell,'!!document.querySelector(".native-workspace")'),'workspace');
 await evaluate(shell,'window.hermesDesktop.selectThread('+JSON.stringify(a)+')');const tab=[...tabsForTest().tabs.values()][0],browser=sidebarForTest();
 // 1. Cancel: the page shows the server's 401 page.
 void browser.open(tab.id,base+'/private/one');let s=await sheet();const web=browser.panes.get(tab.id).view.webContents;
 assert.equal(s.getParentWindow(),window,'sheet is attached to the window that shows the page');
 const text=await evaluate(s.webContents,'document.querySelector("#message").textContent+"|"+document.querySelector("#warning").hidden+"|"+document.body.innerHTML.includes("Router")+"|"+typeof window.hermesDesktop+"|"+typeof require');
 assert.equal(text,'127.0.0.1:'+server.address().port+' requires a username and password.|false|false|undefined|undefined');
 assert.equal(await evaluate(s.webContents,'document.activeElement.id'),'username');
 await evaluate(s.webContents,'document.querySelector("#cancel").click()');await until(()=>s.isDestroyed(),'sheet closed on cancel');
 await until(()=>evaluate(web,'!!document.querySelector("#denied")'),'401 page after cancel');
 // 2. Wrong password: the sheet asks again. 3. Right password: the page opens with the Authorization header.
 void browser.open(tab.id,base+'/private/two');s=await sheet();
 await evaluate(s.webContents,'document.querySelector("#username").value="admin";document.querySelector("#password").value="wrong";document.querySelector("#form").requestSubmit()');
 await until(()=>s.isDestroyed(),'first sheet closed');s=await sheet();
 // Real typing reaches the sheet.
 s.webContents.focus();await evaluate(s.webContents,'document.querySelector("#username").focus()');for(const ch of 'admin')s.webContents.sendInputEvent({type:'char',keyCode:ch});
 await evaluate(s.webContents,'document.querySelector("#password").value="s3cret pass"');
 s.webContents.sendInputEvent({type:'keyDown',keyCode:'Return'});s.webContents.sendInputEvent({type:'char',keyCode:'\r'});s.webContents.sendInputEvent({type:'keyUp',keyCode:'Return'});
 await until(()=>evaluate(web,'!!document.querySelector("#inside")'),'signed-in page');
 assert.equal(seen.filter(r=>r.url==='/private/two'&&r.authorization===good).length>=1,true);
 // 4. Accepted credentials stay for this run: another page on the same realm opens without a sheet.
 await browser.open(tab.id,base+'/private/three');await until(()=>evaluate(web,'document.querySelector("#inside")?.textContent==="Inside /private/three"'),'cached credentials');assert.equal(sheets().length,0);
 // 5. Esc cancels; closing the page while asking closes the sheet.
 void browser.open(tab.id,base.replace('127.0.0.1','localhost')+'/private/four');s=await sheet();s.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});await until(()=>s.isDestroyed(),'Esc cancels');
 console.log('HTTP_AUTH_OK '+JSON.stringify({cancel:true,retry:true,signedIn:true,cached:true,escape:true}));server.close();app.exit(0);
})().catch(error=>{console.error(error.stack);server.close();app.exit(1)});
`);
    const output = execFileSync('xvfb-run', ['-a', require('electron'), '--no-sandbox', join(folder, 'harness.cjs')], { encoding: 'utf8', timeout: 110000, env: process.env, maxBuffer: 2_000_000 });
    assert.match(output, /HTTP_AUTH_OK/); console.log(output.trim());
  } finally { await rm(folder, { recursive: true, force: true }); }
});
