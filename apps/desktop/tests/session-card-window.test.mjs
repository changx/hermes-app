// Sidebar Session card popup: request validation, placement, and the real native window in Electron.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);

const compiled = await build({ entryPoints: [new URL('../src/main/session-card-window.ts', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', external: ['electron'], write: false });
const mod = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(name => name === 'electron' ? {} : require(name), mod, mod.exports);
const { sessionCardRequest, cardBounds, cardWidth, CARD_GAP } = mod.exports;

const request = { title: 'T', statuses: [], labels: [], rowTop: 100, rowBottom: 132, sidebarRight: 280, fontSize: 16 };

test('session card request: plain text and numbers only, bounded', () => {
  assert.equal(sessionCardRequest(null), null);
  assert.deepEqual(sessionCardRequest({ ...request, project: 'P', lastMessage: '' }), { ...request, project: 'P', connection: undefined, lastMessage: undefined, usage: undefined });
  assert.equal(sessionCardRequest({ ...request, usage: 'Context 28.2K · Total 206M' }).usage, 'Context 28.2K · Total 206M');
  for (const bad of [undefined, [], 'x', { ...request, title: 1 }, { ...request, title: 'x'.repeat(2001) }, { ...request, labels: 'a' }, { ...request, labels: Array(21).fill('a') },
    { ...request, statuses: [{}] }, { ...request, usage: 7 }, { ...request, usage: 'x'.repeat(101) }, { ...request, rowTop: NaN }, { ...request, rowBottom: 50 }, { ...request, fontSize: 200 }, { ...request, sidebarRight: -1 }])
    assert.throws(() => sessionCardRequest(bad), /Invalid desktop request/, JSON.stringify(bad));
});

test('session card placement: right of the sidebar, level with the row, kept on screen', () => {
  const content = { x: 100, y: 50, width: 1200, height: 800 }, area = { x: 0, y: 0, width: 1600, height: 1000 };
  assert.equal(cardWidth(16), 320); assert.equal(cardWidth(10), 260); assert.equal(cardWidth(30), 420);
  assert.deepEqual(cardBounds(content, area, request, 320, 90), { x: 100 + 280 + CARD_GAP, y: 150, width: 320, height: 90 });
  // Near the bottom of the screen the card moves up, never below the work area.
  assert.deepEqual(cardBounds(content, area, { ...request, rowTop: 900 }, 320, 90).y, 1000 - 8 - 90);
  // Near the right screen edge it narrows; its left edge never moves over the sidebar.
  const right = cardBounds({ ...content, x: 1000 }, area, request, 320, 90);
  assert.equal(right.x, 1000 + 280 + CARD_GAP); assert.equal(right.width, 1600 - 8 - right.x);
  // It keeps a readable minimum width even when that runs past the screen edge.
  assert.equal(cardBounds({ ...content, x: 1150 }, area, request, 320, 90).width, 220);
});

test('Electron: hovering a sidebar row shows the full title in a popup right of the sidebar, over the Session page', { skip: !process.env.HERMES_TEST_ELECTRON, timeout: 120000 }, async () => {
  const root = new URL('..', import.meta.url).pathname, folder = await mkdtemp(join(tmpdir(), 'hermes-session-card-'));
  try {
    await cp(join(root, 'dist'), join(folder, 'dist'), { recursive: true });
    const bundle = await build({ entryPoints: [join(root, 'src/main/index.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], write: false, plugins: [{ name: 'test-exports', setup(b) { b.onLoad({ filter: /src\/main\/index\.ts$/ }, async args => ({ contents: await readFile(args.path, 'utf8') + '\nexport {service}; export const tabsForTest=()=>tabs; export const cardForTest=()=>sessionCard;\n', loader: 'ts' })); } }] });
    await writeFile(join(folder, 'dist/main/index.cjs'), bundle.outputFiles[0].text);
    await writeFile(join(folder, 'harness.cjs'), String.raw`
const {app,BrowserWindow}=require('electron');const assert=require('node:assert/strict'),path=require('node:path');
app.setPath('userData',path.join(__dirname,'user-data'));app.commandLine.appendSwitch('disable-gpu');
const {service:accounts,tabsForTest,cardForTest}=require('./dist/main/index.cjs');
const LONG='A very long Session title that the sidebar must truncate and the popup must show in full, without cutting a single word of it';
const service=accounts.primary,a='th_aaaaaaaa',b='th_bbbbbbbb',pages=new Map();
const client={channels:new Map([['p',{id:'p',name:'Fixture project'}]]),threads:new Map([[a,{id:a,project_id:'p',title:'Short session',last_message_at:Date.now()/1000-30}],[b,{id:b,project_id:'p',title:LONG,last_message_at:Date.now()/1000-60,running:true}]]),messages:new Map(),receipts:new Map(),interactions:new Map(),attachments:new Map(),isCatalogueReady:true,supportsLatest:true,
 isThreadAvailable:id=>client.threads.has(id),page:id=>pages.get(id),releasePage(id){pages.delete(id);client.messages.delete(id);},acquirePage(id){if(!pages.has(id))pages.set(id,{messages:client.messages,async openConversation(){client.messages.set(id,[{id:'m-'+id,ref_seq:1,role:'assistant',text:'Hello',attachments:[]}]);service.changed();}});return pages.get(id);},close(){}};
service.initialize=async()=>{service.phase='connected';service.connectionState='online';service.connection={id:'a'.repeat(24),baseUrl:'https://controlled.example.test',token:'test-only-never-browser'};service.client=client;service.selectedChannelId='p';service.localDraftStore={async list(){return{}},async put(){},async clear(){}};service.changed();};
const evaluate=(contents,code)=>contents.executeJavaScript(code,true).catch(error=>{throw Error('Renderer script failed: '+code.slice(0,160)+' '+error.message)});
async function until(check,label,ms=12000){console.log('CHECK '+label);const end=Date.now()+ms;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,20));}throw Error('Timed out: '+label);}
const evidence={};
(async()=>{
 await app.whenReady();await until(()=>BrowserWindow.getAllWindows().length,'main window');const main=BrowserWindow.getAllWindows().find(w=>!w.getParentWindow()),shell=main.webContents;
 await until(()=>evaluate(shell,'!!document.querySelector(".native-workspace")'),'workspace');
 const manager=tabsForTest(),card=cardForTest();
 await evaluate(shell,'window.hermesDesktop.selectThread('+JSON.stringify(a)+')');await until(()=>manager.tabs.size===1,'session tab');const tab=[...manager.tabs.values()][0];
 await until(()=>tab.view.getVisible()&&tab.view.getBounds().width>100,'Session page visible right of the sidebar');
 await until(()=>card.contents&&!card.contents.isLoading(),'card window prepared hidden');
 assert.equal(card.visible,false,'no card before hover');
 const row='[...document.querySelectorAll(".channel-tree .tree-thread[data-thread-id]")].find(r=>r.textContent.includes("A very long"))';
 await until(()=>evaluate(shell,'!!'+row),'long row');
 const geo=await evaluate(shell,'(()=>{const r='+row+'.getBoundingClientRect(),s=document.querySelector("aside.native-sidebar").getBoundingClientRect(),t='+row+'.querySelector(".thread-title");return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),top:r.top,sidebarRight:s.right,truncated:t.scrollWidth>t.clientWidth}})()');
 assert.ok(geo.truncated,'row truncates the long title');
 // Normal use: keyboard focus is in the Session page (composer) while the pointer moves over the sidebar.
 main.focus();tab.view.webContents.focus();await new Promise(r=>setTimeout(r,200));
 shell.sendInputEvent({type:'mouseMove',x:geo.x,y:geo.y});
 const hoverAt=Date.now();
 await until(()=>card.visible,'card shown on hover',3000);evidence.showMs=Date.now()-hoverAt;
 const content=main.getContentBounds(),bounds=card.bounds,view=tab.view.getBounds();
 evidence.bounds=bounds;evidence.content=content;evidence.sidebarRight=geo.sidebarRight;evidence.sessionView=view;
 assert.ok(bounds.x>=content.x+geo.sidebarRight,'card does not cover the sidebar: '+JSON.stringify(evidence));
 assert.ok(bounds.x<=content.x+geo.sidebarRight+12,'card starts at the sidebar edge');
 assert.ok(bounds.x+bounds.width>content.x+view.x+40,'card extends over the Session page');
 assert.ok(Math.abs(bounds.y-(content.y+geo.top))<=1,'card level with its row');
 assert.ok(bounds.height>60,'long title wraps onto several lines: '+bounds.height);
 const text=await evaluate(card.contents,'document.getElementById("card").innerText');evidence.text=text;
 assert.ok(text.startsWith(LONG),'full title in the card');assert.match(text,/Fixture project/);assert.match(text,/Running/);
 const fit=await evaluate(card.contents,'document.documentElement.scrollHeight<=window.innerHeight+1&&document.documentElement.scrollWidth<=window.innerWidth+1');assert.ok(fit,'text fits the window');
 const win=BrowserWindow.getAllWindows().find(w=>w.webContents===card.contents);
 assert.equal(win.getParentWindow(),main,'child of the main window');assert.equal(win.isFocusable(),false,'never takes focus');assert.equal(win.isFocused(),false);
 assert.equal(tab.view.getVisible(),true,'Session page stays visible under the card');
 // Pointer moves off the rows: the card hides.
 shell.sendInputEvent({type:'mouseMove',x:Math.round(geo.sidebarRight/2),y:Math.round(content.height-120)});
 await until(()=>!card.visible,'card hidden when the pointer leaves the row',2000);
 // A window move hides it too.
 await new Promise(r=>setTimeout(r,600));shell.sendInputEvent({type:'mouseMove',x:geo.x,y:geo.y});await until(()=>card.visible,'card shown again',3000);
 const old=main.getBounds();main.setBounds({...old,x:old.x+20});await until(()=>!card.visible,'card hidden when the window moves',2000);
 // The card page has no preload: it cannot reach the app API.
 assert.equal(await evaluate(card.contents,'typeof window.hermesDesktop'),'undefined');
 console.log('EVIDENCE '+JSON.stringify(evidence));app.exit(0);
})().catch(error=>{console.error('FAIL '+(error&&error.stack||error));app.exit(1);});
`);
    const output = execFileSync('xvfb-run', ['-a', require('electron'), '--no-sandbox', join(folder, 'harness.cjs')], { encoding: 'utf8', timeout: 110000, env: process.env, maxBuffer: 2_000_000 });
    const line = output.split('\n').find(item => item.startsWith('EVIDENCE '));
    assert.ok(line, output.slice(-3000));
    console.log(line);
  } finally {
    await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
