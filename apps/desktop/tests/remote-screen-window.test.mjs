import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const compiled = await build({ entryPoints: [new URL('../src/main/remote-screen-window.ts', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', external: ['electron'], write: false });

class Contents extends EventEmitter {
  sent = []; destroyed = false;
  isDestroyed() { return this.destroyed; } send(channel, value) { this.sent.push([channel, value]); }
}
const windows = [];
class FakeWindow extends EventEmitter {
  webContents = new Contents(); visible = false; minimized = false; destroyed = false; focused = false;
  constructor(options) { super(); this.options = options; this.title = options.title; windows.push(this); }
  loadFile(file) { this.file = file; return Promise.resolve(); }
  isDestroyed() { return this.destroyed; } isVisible() { return this.visible; } isMinimized() { return this.minimized; }
  show() { this.visible = true; this.emit('show'); } focus() { this.focused = true; }
  restore() { this.minimized = false; this.emit('restore'); } minimize() { this.minimized = true; this.emit('minimize'); }
  getTitle() { return this.title; } setTitle(value) { this.title = value; }
  close() { if (this.destroyed) return; this.destroyed = true; this.webContents.destroyed = true; this.emit('closed'); }
  destroy() { this.close(); }
}
const mod = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(name => name === 'electron' ? { BrowserWindow: FakeWindow } : require(name), mod, mod.exports);
const { RemoteScreenWindows } = mod.exports;

function fixture() {
  windows.length = 0;
  const state = { connections: [{ id: 'c1', name: 'jamie', connectionKey: 'k1', state: 'online' }], screens: { k1: 'AdsPower' } };
  const service = {
    snapshot: () => ({ revision: 1, phase: 'connected', connections: state.connections, channels: [{ id: 'p' }], threads: [{ id: 't' }], messages: [{ id: 'm', text: 'secret' }], interactions: [], draftIdentity: 'k1' }),
    hasConnection: key => state.connections.some(c => c.connectionKey === key),
    remoteScreenName: key => state.screens[key],
  };
  const secured = [];
  const manager = new RemoteScreenWindows('/app/main', service, contents => secured.push(contents));
  return { manager, state, secured };
}

test('one separate secure window per connection; opening again brings it to the front', () => {
  const { manager, secured } = fixture();
  assert.throws(() => manager.open('other'), /unavailable/);
  manager.open('k1');
  assert.equal(windows.length, 1);
  const [w] = windows;
  assert.equal(w.title, 'AdsPower');
  assert.equal(w.options.fullscreenable, true);
  assert.deepEqual(w.options.webPreferences, { preload: '/app/preload/index.cjs', additionalArguments: ['--hermes-remote-screen-view'],
    nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, allowRunningInsecureContent: false });
  assert.equal(w.file, '/app/renderer/index.html');
  assert.deepEqual(secured, [w.webContents]);
  let kept = false; w.emit('page-title-updated', { preventDefault() { kept = true; } }, 'Hermes');
  assert.equal(kept, true, 'the page title does not replace the window title');
  w.emit('ready-to-show'); assert.equal(w.visible, true);
  w.minimize(); manager.open('k1');
  assert.equal(windows.length, 1, 'the window is reused');
  assert.equal(w.minimized, false); assert.equal(w.focused, true);
});

test('the page reaches only its own screen and gets no conversation content', () => {
  const { manager } = fixture();
  manager.open('k1'); const [w] = windows; w.show();
  assert.equal(manager.owns(w.webContents), true);
  assert.equal(manager.owns(new Contents()), false);
  assert.equal(manager.target(w.webContents), 'k1');
  assert.throws(() => manager.target(new Contents()), /unavailable/);
  const page = manager.snapshot(w.webContents);
  assert.equal(page.tabKind, 'remote-screen');
  assert.deepEqual(page.remoteScreen, { name: 'AdsPower', online: true });
  assert.equal(page.tabActive, true);
  assert.deepEqual([page.channels, page.threads, page.messages, page.interactions], [[], [], [], []]);
  assert.equal(page.draftIdentity, undefined);
});

test('minimizing tells the page it is hidden; connection changes are published', () => {
  const { manager, state } = fixture();
  manager.open('k1'); const [w] = windows; w.show(); manager.snapshot(w.webContents);
  w.minimize();
  const hidden = w.webContents.sent.at(-1);
  assert.equal(hidden[0], 'desktop:snapshot'); assert.equal(hidden[1].kind, 'delta'); assert.equal(hidden[1].state.tabActive, false);
  w.restore(); assert.equal(w.webContents.sent.at(-1)[1].state.tabActive, true);
  state.connections = [{ ...state.connections[0], state: 'offline' }]; manager.publish();
  assert.equal(w.webContents.sent.at(-1)[1].state.remoteScreen.online, false);
});

test('the window closes when its connection or its screen goes away', () => {
  const { manager, state } = fixture();
  manager.open('k1'); const [w] = windows;
  delete state.screens.k1; manager.publish();
  assert.equal(w.destroyed, true); assert.equal(manager.owns(w.webContents), false);
  state.screens.k1 = 'AdsPower'; manager.open('k1');
  assert.equal(windows.length, 2, 'a new window opens after the old one closed');
  state.connections = []; manager.publish();
  assert.equal(windows[1].destroyed, true);
});

test('Cmd+W closes the window; other shortcuts reach the page', () => {
  const { manager } = fixture();
  manager.open('k1'); const [w] = windows;
  let prevented = false;
  w.webContents.emit('before-input-event', { preventDefault() { prevented = true; } }, { type: 'keyDown', key: 'l', meta: true, control: false, alt: false, shift: false, isAutoRepeat: false });
  assert.equal(prevented, false); assert.equal(w.destroyed, false);
  w.webContents.emit('before-input-event', { preventDefault() { prevented = true; } }, { type: 'keyDown', key: 'w', meta: true, control: false, alt: false, shift: false, isAutoRepeat: false });
  assert.equal(prevented, true); assert.equal(w.destroyed, true);
});

test('with several connections the title names the connection', () => {
  const { manager, state } = fixture();
  state.connections.push({ id: 'c2', name: 'team', connectionKey: 'k2', state: 'online' });
  manager.open('k1');
  assert.equal(windows[0].title, 'AdsPower · jamie');
  manager.dispose(); assert.equal(windows[0].destroyed, true);
});
