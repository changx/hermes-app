// SDK streams are controlled fixtures. Pairing uses a local HTTP fixture server.
// BrowserWindow, views, production preload/IPC/React and atomic storage files are real.
// Linux has no Mac Keychain. Only the safeStorage provider is replaced with test AES-GCM.
const { app, BrowserWindow, safeStorage } = require('electron');
const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');
const fixtureKey = randomBytes(32);
safeStorage.isEncryptionAvailable = () => true;
safeStorage.encryptString = text => {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', fixtureKey, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
};
safeStorage.decryptString = bytes => {
  const decipher = createDecipheriv('aes-256-gcm', fixtureKey, bytes.subarray(0,12));
  decipher.setAuthTag(bytes.subarray(12,28));
  return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8');
};
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
app.setPath('userData', path.join(__dirname, 'user-data'));
app.setPath('temp', __dirname);
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('password-store', 'basic');
const { service: accounts, tabsForTest, settingsForTest } = require('./dist/main/index.cjs');
const thread = 'th_same0000', tokens = new Set(), requests = [], clients = new Map();
let localAddress;
let projectReadGate;
const originalFetch = global.fetch;
global.fetch = (url, init) => {
  const u = new URL(url);
  return originalFetch(localAddress + '/' + u.hostname.split('.')[0] + u.pathname, init);
};
const fixtureServer = http.createServer(async (req, res) => {
  requests.push({ method: req.method, path: req.url });
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.url.startsWith('/pending/')) return send(503, { error: 'Controlled offline server' });
  if (req.url.endsWith('/v1/capabilities')) return send(tokens.has(req.headers.authorization) ? 200 : 401, { protocol: 1 });
  if (req.url.endsWith('/v1/pairing/exchange')) {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    if (req.url.startsWith('/expired/')) return send(400, { error: 'Controlled expired code' });
    assert.equal(input.code, 'ABCD-EFGH-JKLM-NPQR');
    tokens.add('Bearer ' + input.device_token);
    return send(201, { device_id: input.device_token.slice(7, 31) });
  }
  send(404, {});
});
function install(service) {
  service.startClient = async function(connection) {
    this.closed = false; this.connection = connection; this.phase = 'connected'; this.connectionState = 'online'; this.selectedChannelId = 'p';
    this.outbox = [...await this.outboxStore.list(connection.id)];
    const owner = new URL(connection.baseUrl).hostname, pages = new Map(), calls = [];
    const client = {
      channels: new Map([['p', { id: 'p', name: 'Controlled shared Project' }]]),
      threads: new Map([[thread, { id: thread, project_id: 'p', title: 'Controlled ' + owner, last_message_at: Date.now() / 1000 }]]),
      messages: new Map(), receipts: new Map(), interactions: new Map(), attachments: new Map(), supportsLatest: true, isCatalogueReady: true, supportsSessionLabels: true,
      page: id => pages.get(id), isThreadAvailable: id => client.threads.has(id), releasePage(id) { pages.delete(id); client.messages.delete(id); },
      acquirePage(id) {
        const page = { messages: client.messages, async openConversation() { client.messages.set(id, [{ id: 'same-message', ref_seq: 1, role: 'assistant', text: 'Controlled content from ' + owner }]); service.changed(); } };
        pages.set(id, page); return page;
      },
      async getModelSettings() { calls.push(['model', owner]); return { scope: 'connected-default', provider: 'fixture', model: owner, providers: [{ id: 'fixture', name: 'Controlled provider', models: [owner] }] }; },
      async stop(id) { calls.push(['stop', id]); }, async markResultRead(id) { calls.push(['read', id]); },
      async createChannel(name, description) { calls.push(['project-create', owner, name]); const value={id:'p_created',name,description};client.channels.set(value.id,value);service.changed();return value; },
      async getChannelInfo(id) { calls.push(['project-read', owner, id]); if(projectReadGate)await projectReadGate;return client.channels.get(id); },
      async createThread(project, title, id) { assert.equal(project, 'p'); const t = { id, project_id: project, title, last_message_at: Date.now()/1000 }; client.threads.set(id,t); service.changed(); return t; },
      async send(id, messageId, text) { calls.push(['send', id, text]); return { id: 'fixture-receipt', thread_id: id, client_message_id: messageId, state: 'queued', durable: true, ref_seq: 2 }; },
      rememberAcceptedInput(id, messageId, text, files, time, receipt) { client.messages.set(id, [...client.messages.get(id) ?? [], { id: receipt.id, role:'user', text, client_message_id: messageId, receipt_id:receipt.id, ref_seq:2 }]); },
      close() { calls.push(['close']); pages.clear(); }, calls,
    };
    this.client = client; clients.set(owner, { service:this, client }); this.changed();
  };
}
function installFactory(workspace) {
  install(workspace.primary);
  const make = workspace.make.bind(workspace);
  workspace.make = (...args) => { const a = make(...args); install(a.service); return a; };
}
installFactory(accounts);
const seed = { version:1, baseUrl:'https://first.example.test', id:'a'.repeat(24), token:'ha_dev_' + 'a'.repeat(24) + '_' + 'c'.repeat(43) };
accounts.primary.initialize = async () => { await accounts.primary.store.saveConnection(seed); await accounts.primary.startClient(seed); };
const evaluate = (contents, code) => contents.executeJavaScript(code, true).catch(error => { throw Error('Renderer script failed: ' + code.slice(0,180) + ' ' + error.message); });
async function until(check, label) {
  console.log('CHECK ' + label); const end = Date.now() + 15000;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve,25)); }
  throw Error('Timed out: ' + label);
}
async function field(contents, label, value) {
  await evaluate(contents, `(()=>{const e=document.querySelector(${JSON.stringify('[aria-label="'+label+'"]')});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
}
(async () => {
  await new Promise(resolve => fixtureServer.listen(0,'127.0.0.1',resolve)); localAddress = 'http://127.0.0.1:' + fixtureServer.address().port;
  await app.whenReady(); await until(()=>BrowserWindow.getAllWindows().length,'window');
  const window = BrowserWindow.getAllWindows()[0], shell = window.webContents;
  await until(()=>evaluate(shell,'!!document.querySelector(".native-workspace")'),'production workspace');
  const manager = tabsForTest();
  await evaluate(shell,`window.hermesDesktop.selectThread('${thread}')`);
  const primaryTab = [...manager.tabs.values()][0], primaryView = primaryTab.view.webContents;
  await until(()=>evaluate(primaryView,'!!document.querySelector(".message-list")'),'primary session');
  await evaluate(primaryView,"document.querySelector('.message-list').dataset.retained='primary-retained'");
  await evaluate(shell,"document.querySelector('[aria-label=Settings]').click()");
  await until(()=>settingsForTest().isOpen,'Settings window open'); let sw = settingsForTest().contents;
  await until(()=>evaluate(sw,'!!document.querySelector(".settings-window")'),'Settings open');
  await evaluate(sw,"document.querySelector('#settings-tab-connection').click()");
  await until(()=>evaluate(sw,'document.querySelectorAll(".settings-connection-list li").length===1'),'legacy saved connection displayed');
  assert.equal(await evaluate(sw,'document.querySelector(".settings-connection-address").textContent'),'https://first.example.test');
  await evaluate(sw,"[...document.querySelectorAll('.settings-connections button')].find(e=>e.textContent==='Add connection').click()");
  await field(sw,'Server address','https://second.example.test'); await field(sw,'One-time pairing code','ABCD-EFGH-JKLM-NPQR');
  await evaluate(sw,"document.querySelector('.settings-connections form').requestSubmit()");
  await until(()=>accounts.snapshot().connections.length===2 && accounts.snapshot().connections[1].state==='online','second connection paired');
  await until(()=>evaluate(sw,'document.querySelectorAll(".settings-connection-list li").length===2'),'two real Settings rows');
  assert.equal(await evaluate(sw,"getComputedStyle(document.querySelector('.settings-connection-list')).borderTopWidth"),'1px');
  assert.equal(await evaluate(sw,"document.querySelector('.settings-content').scrollWidth<=document.querySelector('.settings-content').clientWidth"),true);
  assert.equal(primaryView.isDestroyed(),false); assert.equal(await evaluate(primaryView,"document.querySelector('.message-list').dataset.retained"),'primary-retained');
  assert.ok(requests.some(r=>r.path==='/second/v1/pairing/exchange'));
  assert.equal(await evaluate(sw,"document.body.textContent.includes('ha_dev_')"),false);
  const peerRow = accounts.snapshot().connections[1], peerAccount = accounts.accounts.get(peerRow.id), peerThread = peerRow.id + ':' + thread;
  if (process.env.HERMES_CONNECTIONS_EVIDENCE) {
    await fs.mkdir(process.env.HERMES_CONNECTIONS_EVIDENCE,{recursive:true});
    await fs.writeFile(path.join(process.env.HERMES_CONNECTIONS_EVIDENCE,'connections-fixture.png'),(await sw.capturePage()).toPNG());
  }
  // Model target is the opened connection page, not inferred from the active tab.
  await evaluate(sw,`document.querySelector('[data-connection-id="${peerRow.id}"] .settings-connection-open').click()`);
  await until(()=>evaluate(sw,`document.querySelector('[role=tab][aria-selected=true]')?.textContent.startsWith(${JSON.stringify(peerRow.name)})`),'peer connection page selected');
  await evaluate(sw,`document.getElementById(${JSON.stringify('connection-' + peerRow.id + '-tab-model')}).click()`);
  await until(()=>evaluate(sw,"[...document.querySelectorAll('[aria-label=Model]')].find(e=>!e.closest('[hidden]'))?.value==='second.example.test'"),'model read reaches second connection');
  BrowserWindow.fromWebContents(sw).close(); await until(()=>!settingsForTest().isOpen,'Settings window closed');
  await until(()=>evaluate(shell,'document.querySelectorAll(".channel-tree .tree-thread").length===2'),'both connections sessions directly in sidebar');
  await evaluate(shell,`window.hermesDesktop.selectThread('${peerThread}')`);
  const peerTab = [...manager.tabs.values()].find(t=>t.threadId===peerThread), peerView = peerTab.view.webContents;
  await until(()=>evaluate(peerView,'!!document.querySelector(".message-list")'),'peer session with equal raw Thread ID');
  assert.equal(manager.tabs.size,2); assert.equal(primaryView.isDestroyed(),false);
  await evaluate(peerView,"document.querySelector('.message-list').dataset.retained='peer-retained'");
  await evaluate(peerView,"(()=>{const e=document.querySelector('[aria-label=Message]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Peer retained draft');e.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await until(async()=> (await accounts.loadLocalDrafts(peerRow.connectionKey))[peerThread]?.text==='Peer retained draft','peer draft encrypted in own identity');
  await evaluate(shell,`window.hermesDesktop.activateTab('${primaryTab.id}')`);
  await evaluate(peerView,"window.hermesDesktop.stopThread()");
  assert.ok(clients.get('second.example.test').client.calls.some(c=>c[0]==='stop'&&c[1]===thread));
  assert.ok(!clients.get('first.example.test').client.calls.some(c=>c[0]==='stop'));
  assert.equal(await evaluate(peerView,"document.querySelector('.message-list').dataset.retained"),'peer-retained');
  // Creating a tab on the second connection, while primary is active, must route by Project.
  await evaluate(shell,`window.hermesDesktop.newTab('${peerRow.id}:p')`);
  const newTab = [...manager.tabs.values()].find(t=>t.kind==='new'), newView = newTab.view.webContents;
  await until(()=>evaluate(newView,'!!document.querySelector(".new-chat-page")'),'peer New chat');
  const created = await evaluate(newView,`window.hermesDesktop.createThread({channelId:'${peerRow.id}:p',title:'Controlled new peer',clientThreadId:'th_newpeer0000'})`);
  assert.equal(created,peerRow.id+':th_newpeer0000');
  await evaluate(newView,"window.hermesDesktop.sendMessage({text:'Peer send only',attachmentIds:[],clientMessageId:'desktop:11111111-1111-1111-1111-111111111111'})");
  await evaluate(newView,'window.hermesDesktop.completeNewTab()');
  assert.ok(clients.get('second.example.test').client.calls.some(c=>c[0]==='send'&&c[1]==='th_newpeer0000'));
  assert.ok(!clients.get('first.example.test').client.calls.some(c=>c[0]==='send'));
  const existingPeerView=peerView;
  await evaluate(shell,`window.hermesDesktop.activateTab('${primaryTab.id}')`);
  await evaluate(shell,"document.querySelector('.sidebar-section-header [aria-label=\"New project\"]').click()");
  await until(()=>evaluate(shell,`!!document.querySelector('[role="dialog"][aria-label="New project"]')`),'New Project dialog');
  assert.equal(await evaluate(shell,`document.querySelector('[aria-label="Project connection"]').value`),'');
  await field(shell,'Project title','Controlled peer Project');
  await evaluate(shell,`(()=>{const e=document.querySelector('[aria-label="Project connection"]');e.value='${peerRow.connectionKey}';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await evaluate(shell,`window.hermesDesktop.activateTab('${peerTab.id}')`);
  assert.equal(await evaluate(shell,`document.querySelector('[aria-label="Project title"]').value`),'Controlled peer Project');
  assert.equal(await evaluate(shell,`document.querySelector('[aria-label="Project connection"]').value`),peerRow.connectionKey);
  let releaseProject;projectReadGate=new Promise(resolve=>releaseProject=resolve);
  await evaluate(shell,`document.querySelector('[role="dialog"][aria-label="New project"]').requestSubmit()`);
  await until(()=>clients.get('second.example.test').client.calls.some(c=>c[0]==='project-read'),'project reads exact selected connection');
  await evaluate(shell,`window.hermesDesktop.activateTab('${primaryTab.id}')`);
  releaseProject();projectReadGate=undefined;
  await until(()=>evaluate(shell,`!document.querySelector('[role="dialog"][aria-label="New project"]')`),'confirmed Project creation closes dialog');
  assert.ok(!clients.get('first.example.test').client.calls.some(c=>c[0]==='project-create'||c[0]==='project-read'));
  assert.equal(clients.get('second.example.test').client.channels.get('p_created').name,'Controlled peer Project');
  await assert.rejects(evaluate(shell,"window.hermesDesktop.createChannel({name:'Missing target',description:''})"));
  await evaluate(shell,`window.hermesDesktop.activateTab('${primaryTab.id}')`);
  await evaluate(shell,"document.querySelector('[aria-label=Settings]').click()");
  await until(()=>settingsForTest().isOpen,'Settings window reopened'); sw = settingsForTest().contents;
  await until(()=>evaluate(sw,'!!document.querySelector(".settings-window")'),'Settings reopened');
  await evaluate(sw,"document.querySelector('#settings-tab-connection').click()");
  peerAccount.service.connectionState='blocked';peerAccount.service.connectionIssue='Controlled authorization failure. Pair again.';peerAccount.service.changed();
  const peerStatus = JSON.stringify(`[data-connection-id="${peerRow.id}"] .settings-connection-state`);
  await until(()=>evaluate(sw,`document.querySelector(${peerStatus}).textContent==='Needs attention'`),'per-connection authorization status');
  assert.equal(await evaluate(sw,"document.querySelector('[data-connection-id=primary] .settings-connection-state').textContent"),'Online');
  peerAccount.service.connectionState='retrying';peerAccount.service.connectionIssue=undefined;peerAccount.service.changed();
  await until(()=>evaluate(sw,`document.querySelector(${peerStatus}).textContent==='Reconnecting'`),'per-connection reconnecting status');
  peerAccount.service.connectionState='online';peerAccount.service.changed();
  await evaluate(sw,"document.querySelector('#settings-tab-connection-primary').click()");
  await evaluate(sw,"document.querySelector('.settings-connection-page[data-connection-id=primary] .settings-remove').click()");
  assert.equal(manager.tabs.size,3,'confirmation must not remove anything');
  await evaluate(sw,"[...document.querySelectorAll('.settings-danger button')].find(e=>e.textContent==='Keep connection').click()");
  assert.equal(manager.tabs.size,3);
  await evaluate(sw,"document.querySelector('.settings-connection-page[data-connection-id=primary] .settings-remove').click()");
  await evaluate(sw,"document.querySelector('.settings-danger button').click()");
  await until(()=>accounts.snapshot().connections.length===1,'exact primary connection removed');
  await until(()=>evaluate(sw,"document.querySelector('[role=tab][aria-selected=true]')?.id==='settings-tab-connection'"),'removed page returns to Connections overview');
  await until(()=>primaryView.isDestroyed() && manager.tabs.size===2,'only primary tab released');
  assert.equal(primaryView.isDestroyed(),true); assert.equal(existingPeerView.isDestroyed(),false); assert.equal(manager.tabs.size,2);
  assert.equal(await evaluate(existingPeerView,"document.querySelector('.message-list').dataset.retained"),'peer-retained');
  assert.equal((await accounts.loadLocalDrafts(peerRow.connectionKey))[peerThread].text,'Peer retained draft');
  await assert.rejects(fs.readFile(path.join(__dirname,'user-data','connection.secure.json')),{code:'ENOENT'});
  const envelope=JSON.parse(await fs.readFile(path.join(__dirname,'user-data',`connection-${peerRow.id}.secure.json`),'utf8'));
  assert.equal(envelope.version,1);assert.equal(typeof envelope.encrypted,'string');assert.equal(JSON.stringify(envelope).includes('ha_dev_'),false);
  assert.equal(requests.some(r=>r.method==='DELETE'),false,'removal is local; server conversations are unchanged');
  // Retained pending pairing is cancellable without deleting the working connection.
  await accounts.addConnection({baseUrl:'https://pending.example.test',code:'ABCD-EFGH-JKLM-NPQR',deviceName:'Controlled pending'});
  await until(()=>accounts.snapshot().connections.some(c=>c.state==='pairing'),'pending pairing shown');
  const pending=accounts.snapshot().connections.find(c=>c.state==='pairing');await accounts.removeConnection(pending.id);
  assert.equal(accounts.snapshot().connections.length,1);assert.equal(existingPeerView.isDestroyed(),false);
  await accounts.addConnection({baseUrl:'https://expired.example.test',code:'ABCD-EFGH-JKLM-NPQR',deviceName:'Controlled expired'});
  await until(()=>accounts.snapshot().connections.some(c=>c.state==='blocked'),'expired pairing displayed as needs attention');
  const failed=accounts.snapshot().connections.find(c=>c.state==='blocked');assert.match(failed.detail,/invalid or expired/i);await accounts.removeConnection(failed.id);
  // A fresh manager restores independent credential slots and raw per-account drafts.
  const restored = new accounts.constructor(()=>{});installFactory(restored);await restored.initialize();
  assert.equal(restored.snapshot().connections.length,1);assert.equal(restored.snapshot().connections[0].id,peerRow.id);
  assert.equal((await restored.loadLocalDrafts(peerRow.connectionKey))[peerThread].text,'Peer retained draft');
  assert.equal((await restored.primary.store.load()),null);restored.close();
  console.log('CONNECTIONS_NATIVE_OK '+JSON.stringify({settingsList:true,pairingExchange:true,scopedCredentials:true,equalIdsIsolated:true,tabsRetained:true,scopedSend:true,draftRetained:true,statusTransitions:true,removalConfirmation:true,restartRestored:true,transport:'controlled SDK; local HTTP pairing fixture'}));
  accounts.close();fixtureServer.close();app.exit(0);
})().catch(error=>{console.error(error);fixtureServer.close();app.exit(1);});
