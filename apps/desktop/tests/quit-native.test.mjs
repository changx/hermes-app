// Quit and reopen with production main/preload/renderers and a fixture connection (Electron/Xvfb).
// HERMES_KEEP_QUIT_HARNESS=<dir> writes the harness folder there (for a run on a real Mac) and keeps it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { cp, mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);

const harness = String.raw`
const {app,BrowserWindow}=require('electron'),path=require('node:path'),fs=require('node:fs');
const scenario=(process.argv.find(a=>a.startsWith('--scenario='))||'').slice(11);
app.setPath('userData',path.join(__dirname,'ud-'+scenario+'-'+Date.now()));app.commandLine.appendSwitch('disable-gpu');
const {service:accounts,tabsForTest}=require('./dist/main/index.cjs');
const service=accounts.primary,pages=new Map(),a='th_aaaaaaaa',b='th_bbbbbbbb',log=[],t0=Date.now();
const note=s=>log.push((Date.now()-t0)+'ms '+s);
// macOS keeps the app alive with no windows; on Linux keep it alive for the reopen check only.
if(scenario==='reopen'){app.removeAllListeners('window-all-closed');}
app.on('window-all-closed',()=>note('window-all-closed'));
const rows=id=>Array.from({length:30},(_,i)=>({id:id+'_'+i,ref_seq:i+1,role:'assistant',text:'Row '+(i+1)+' of '+id,attachments:[]}));
const client={channels:new Map([['p',{id:'p',name:'Project'}]]),threads:new Map([[a,{id:a,project_id:'p',title:'Session A',last_message_at:Date.now()/1000}],[b,{id:b,project_id:'p',title:'Session B',last_message_at:Date.now()/1000-5}]]),messages:new Map(),receipts:new Map(),interactions:new Map(),attachments:new Map(),isCatalogueReady:true,supportsLatest:true,
 isThreadAvailable:id=>client.threads.has(id),page:id=>pages.get(id),releasePage(id){pages.delete(id);client.messages.delete(id);},acquirePage(id){if(!pages.has(id))pages.set(id,{messages:client.messages,async openConversation(){client.messages.set(id,rows(id));service.changed();}});return pages.get(id);},close(){note('client closed');}};
service.initialize=async()=>{service.phase='connected';service.connectionState='online';service.connection={id:'a'.repeat(24),baseUrl:'https://controlled.example.test',token:'test-only'};service.client=client;service.selectedChannelId='p';service.localDraftStore={async list(){return{}},async put(){},async clear(){},async flush(){}};service.changed();};
const evaluate=(c,code)=>c.executeJavaScript(code,true);
const until=async(check,label,ms=10000)=>{const end=Date.now()+ms;while(Date.now()<end){try{if(await check())return true;}catch{}await new Promise(r=>setTimeout(r,25));}note('TIMEOUT '+label);return false;};
const mainWin=()=>BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.isFocusable()&&!w.getParentWindow()&&w.webContents.getURL().includes('/renderer/index.html'));
const click=async(w,selector)=>{const r=await evaluate(w.webContents,'(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e)return null;const b=e.getBoundingClientRect();return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()');if(!r)return false;
 w.webContents.sendInputEvent({type:'mouseMove',...r});w.webContents.sendInputEvent({type:'mouseDown',...r,button:'left',clickCount:1});w.webContents.sendInputEvent({type:'mouseUp',...r,button:'left',clickCount:1});return true;};
// A real click on a sidebar row must open that Session in a tab and render it (needs a live connection service).
const opens=async(w,id)=>{const tabs=tabsForTest();if(!await click(w,'[data-thread-id="'+id+'"]'))return false;if(!await until(()=>[...tabs.tabs.values()].some(t=>t.threadId===id),'tab '+id))return false;
 const t=[...tabs.tabs.values()].find(t=>t.threadId===id);return until(()=>evaluate(t.view.webContents,'document.querySelectorAll(".message").length>=30'),'messages '+id);};
const r={scenario};let willQuit=0;
const finish=()=>{r.log=log;fs.writeFileSync(path.join(__dirname,'result-'+scenario+'.json'),JSON.stringify(r,null,2));console.log('RESULT '+JSON.stringify(r));process.kill(process.pid,'SIGKILL');};
// Registered after the app's own handlers: records the state each quit pass leaves behind.
app.on('before-quit',()=>{r.serviceClosedAfterBeforeQuit=!!service.closed;});
app.on('will-quit',e=>{willQuit++;note('will-quit');e.preventDefault();r.willQuit=willQuit;r.windowsAtWillQuit=BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed()).length;finish();});
(async()=>{try{
 await app.whenReady();await until(()=>mainWin(),'window');const first=mainWin();
 await until(()=>evaluate(first.webContents,'!!document.querySelector(".native-workspace")'),'workspace');first.focus();
 r.opensBefore=await opens(first,a);
 if(scenario==='helper'){
   // Stand-in for a helper window whose close is refused (for example a page's beforeunload in a sign-in popup).
   const helper=new BrowserWindow({width:300,height:200,parent:first});helper.on('close',e=>{note('helper close prevented');e.preventDefault();});
   note('quit');app.quit();await new Promise(res=>setTimeout(res,5000));r.windowsLeft=BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed()).length;r.serviceClosed=!!service.closed;finish();
 } else if(scenario==='maincancel'){
   let refuse=true;first.on('close',e=>{if(refuse){refuse=false;note('main close prevented');e.preventDefault();}});
   note('quit 1');app.quit();await new Promise(res=>setTimeout(res,1500));
   r.mainOpenAfterCancel=!!mainWin();r.serviceClosedAfterCancel=!!service.closed;r.opensAfterCancel=r.mainOpenAfterCancel&&await opens(mainWin(),b);
   note('quit 2');app.quit();await new Promise(res=>setTimeout(res,5000));finish();
 } else if(scenario==='reopen'){
   note('close');first.close();await until(()=>!mainWin(),'closed');await new Promise(res=>setTimeout(res,300));
   note('activate');app.emit('activate',{},false);await until(()=>mainWin(),'reopened');const w=mainWin();
   await until(()=>evaluate(w.webContents,'!!document.querySelector(".native-workspace")'),'workspace 2');w.focus();
   r.serviceClosed=!!service.closed;r.opensAfterReopen=await opens(w,b);finish();
 }
}catch(e){r.failure=e.stack;finish();}})();
`;

test('Electron: quit finishes once even if a helper window refuses to close; a cancelled quit keeps the app usable; reopen works', { skip: !process.env.HERMES_TEST_ELECTRON, timeout: 120000 }, async () => {
  const root = new URL('..', import.meta.url).pathname;
  const keep = process.env.HERMES_KEEP_QUIT_HARNESS, folder = keep ?? await mkdtemp(join(tmpdir(), 'hermes-quit-'));
  try {
    await mkdir(folder, { recursive: true });
    await cp(join(root, 'dist'), join(folder, 'dist'), { recursive: true });
    const bundle = await build({ entryPoints: [join(root, 'src/main/index.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], write: false, plugins: [{ name: 'test-exports', setup(b) { b.onLoad({ filter: /src\/main\/index\.ts$/ }, async args => ({ contents: await readFile(args.path, 'utf8') + '\nexport {service}; export const tabsForTest=()=>tabs;\n', loader: 'ts' })); } }] });
    await writeFile(join(folder, 'dist/main/index.cjs'), bundle.outputFiles[0].text);
    await writeFile(join(folder, 'harness.cjs'), harness);
    await writeFile(join(folder, 'package.json'), '{"name":"hermes-quit-harness","main":"harness.cjs"}\n');
    const run = scenario => {
      // The harness ends itself with SIGKILL after writing its result line.
      const output = spawnSync('xvfb-run', ['-a', require('electron'), '--no-sandbox', folder, '--scenario=' + scenario], { encoding: 'utf8', timeout: 60000, maxBuffer: 2_000_000 }).stdout ?? '';
      const line = output.split('\n').find(l => l.startsWith('RESULT ')); assert.ok(line, output); return JSON.parse(line.slice(7));
    };
    const helper = run('helper');
    assert.equal(helper.failure, undefined, JSON.stringify(helper));
    assert.equal(helper.opensBefore, true, JSON.stringify(helper));
    assert.equal(helper.willQuit, 1, 'one quit request finishes although a helper window refuses to close: ' + JSON.stringify(helper));
    assert.equal(helper.serviceClosedAfterBeforeQuit, false, 'the service closes in will-quit, not in before-quit: ' + JSON.stringify(helper));
    assert.ok(!helper.log.includes('helper close prevented') && helper.log.findIndex(l => l.endsWith('client closed')) > helper.log.findIndex(l => l.endsWith('quit')), JSON.stringify(helper));
    const cancel = run('maincancel');
    assert.equal(cancel.failure, undefined, JSON.stringify(cancel));
    assert.equal(cancel.mainOpenAfterCancel, true, JSON.stringify(cancel));
    assert.equal(cancel.serviceClosedAfterCancel, false, 'a cancelled quit leaves the connection open: ' + JSON.stringify(cancel));
    assert.equal(cancel.opensAfterCancel, true, 'the window still opens Sessions after a cancelled quit: ' + JSON.stringify(cancel));
    assert.equal(cancel.willQuit, 1, 'the next quit request finishes: ' + JSON.stringify(cancel));
    const reopen = run('reopen');
    assert.equal(reopen.failure, undefined, JSON.stringify(reopen));
    assert.equal(reopen.serviceClosed, false, JSON.stringify(reopen));
    assert.equal(reopen.opensAfterReopen, true, 'a reopened window opens Sessions: ' + JSON.stringify(reopen));
  } finally { if (!keep) await rm(folder, { recursive: true, force: true }); }
});
