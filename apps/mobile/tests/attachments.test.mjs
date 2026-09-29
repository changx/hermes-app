import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { chooseAttachments, draftBusy, isImage, MAX_ATTACHMENT_BYTES, uploadedInOrder } from '../src/attachmentHelpers.ts';

const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function harness({ platform = 'ios', nativePaste = true } = {}) {
  const disks = new Map([['file://a', Uint8Array.from([1, 2])], ['file://b', Uint8Array.from([3, 4])]]);
  const removed = [], uploads = [], downloads = [], deletions = [], notices = [], pasted = [], viewers = [];
  let clipboardText = '', clipboardUrl = null, hasImage = true;
  let imagePick = async () => ({ canceled: true }), documentPick = async () => ({ canceled: true }), clipboardRead = async () => null;
  let cameraPick = async () => ({ canceled: true }), cameraPermission = async () => ({ granted: true }), copyGate = async () => {};
  let hook = 0, effects = [], props, component, mounted = false;
  const cells = [], effectCells = [], viewerCells = [];
  let activeCells = cells;
  const react = {
    createElement: (type, p, ...children) => ({ type, props: { ...p, children } }),
    useState(initial) { const at = hook++; const store = activeCells; if (!(at in store)) store[at] = initial; return [store[at], next => { store[at] = typeof next === 'function' ? next(store[at]) : next; }]; },
    useRef(initial) { const at = hook++; const store = activeCells; if (!(at in store)) store[at] = { current: initial }; return store[at]; },
    useEffect(fn, deps) {
      const at = hook++;
      const old = effectCells[at];
      if (!old || !deps || deps.some((d, i) => d !== old.deps[i])) effects.push(() => { old?.cleanup?.(); effectCells[at] = { deps, cleanup: fn() }; });
    }
  };
  const native = { Platform: { OS: platform }, StyleSheet: { create: x => x }, useWindowDimensions: () => ({ width: 390, height: 844 }) };
  for (const type of ['Image', 'Modal', 'Pressable', 'ScrollView', 'Text', 'View']) native[type] = type;
  class File {
    constructor(...parts) { this.uri = parts.at(-1).startsWith('file:') ? parts.at(-1) : `file://${parts.at(-1)}`; }
    get exists() { return disks.has(this.uri); }
    get size() { return disks.get(this.uri)?.length ?? 0; }
    create() { if (this.exists) throw new Error('already exists'); disks.set(this.uri, new Uint8Array()); }
    write(value) { disks.set(this.uri, value); }
    async bytes() { if (!this.exists) throw new Error('not found'); return disks.get(this.uri); }
    async text() { return new TextDecoder().decode(await this.bytes()); }
    async copy(destination) { await copyGate(); destination.write(Uint8Array.from(await this.bytes())); }
    delete() { removed.push(this.uri); disks.delete(this.uri); }
  }
  const modules = {
    react: { ...react, default: react }, 'react-native': native,
    './FontSize': { Text: native.Text },
    './Viewers': { useViewer: () => ({ openViewer: (title, content, onClose) => viewers.push({ title, content, onClose }) }) },
    'expo-image-picker': { launchImageLibraryAsync: (...args) => imagePick(...args), launchCameraAsync: (...args) => cameraPick(...args), requestCameraPermissionsAsync: () => cameraPermission() },
    'expo-document-picker': { getDocumentAsync: (...args) => documentPick(...args) },
    'expo-clipboard': { isPasteButtonAvailable: nativePaste, ClipboardPasteButton: 'ClipboardPasteButton', getImageAsync: (...args) => clipboardRead(...args), hasImageAsync: async () => hasImage, getStringAsync: async () => clipboardText, getUrlAsync: async () => clipboardUrl },
    'expo-file-system': { File, Paths: { cache: 'file://cache/' } },
    'base64-js': { toByteArray: text => Uint8Array.from(Buffer.from(text, 'base64')) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 20, bottom: 10 }) },
    './attachmentHelpers': { chooseAttachments, draftBusy, isImage, MAX_ATTACHMENT_BYTES, uploadedInOrder, readableText: (mime, name) => mime?.startsWith('text/') || name?.endsWith('.txt') }
  };
  const out = { exports: {} };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/Attachments.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
    { module: out, exports: out.exports, require: key => { assert.ok(key in modules, key); return modules[key]; }, AbortController, Uint8Array, Date, Math, Buffer, console, Promise });
  const client = {
    upload: (thread, name, bytes, signal) => { uploads.push({ thread, name, bytes, signal }); return Promise.resolve({ id: `att_${uploads.length}`, thread_id: thread, name, mime: name.endsWith('png') ? 'image/png' : 'text/plain', size: bytes.length, state: 'available', receipt_id: null }); },
    download: (thread, id, signal) => { downloads.push({ thread, id, signal }); return Promise.resolve(Uint8Array.from([7, 8])); },
    deleteUnattached: (thread, id) => { deletions.push([thread, id]); return Promise.resolve(); }
  };
  function expand(node) {
    if (Array.isArray(node)) return node.flatMap(expand);
    if (node === null || typeof node !== 'object') return [];
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return [node, ...expand(node.props.children)];
  }
  function render(nextProps) {
    if (nextProps) props = nextProps;
    activeCells = cells;
    hook = 0; effects = [];
    const nodes = expand(component(props));
    for (const effect of effects) effect();
    mounted = true;
    return nodes;
  }
  const start = (kind, overrides = {}) => { component = out.exports[kind]; props = { client, threadId: 'th', attachments: [], clearKey: 0, onPasteText: text => pasted.push(text), onChange: (a, b) => notices.push([a.map(x => x.id), b]), ...overrides }; return render(); };
  const press = (label, nodes = render()) => {
    if (['Choose file', 'Photo library', 'Take photo', 'Paste'].includes(label) && !nodes.some(x => x.props.accessibilityLabel === label)) {
      press('Add attachment', nodes); nodes = render();
    }
    const button = nodes.find(x => x.props.accessibilityLabel === label);
    assert.ok(button, `missing ${label}`); assert.notEqual(button.props.disabled, true, `${label} disabled`); button.props.onPress();
  };
  const unmount = () => { if (!mounted) return; for (const cell of effectCells) cell?.cleanup?.(); mounted = false; };
  return { start, render, press, unmount, client, disks, uploads, downloads, deletions, removed, notices, pasted,
    viewers, view() { activeCells = viewerCells[viewers.length - 1] ??= []; hook = 0; return expand(viewers.at(-1).content); },
    close() { const route = viewers.pop(); route?.onClose?.(); },
    setCopyGate(fn) { copyGate = fn; },
    setClipboardText(text, url = null) { hasImage = false; clipboardText = text; clipboardUrl = url; },
    setCamera(fn) { cameraPick = fn; }, setPermission(fn) { cameraPermission = fn; },
    setImages(fn) { imagePick = fn; }, setFiles(fn) { documentPick = fn; }, setClipboard(fn) { clipboardRead = fn; } };
}

test('plus menu opens inside the shared composer surface, without a separate nested shadow', () => {
  const h = harness();
  const input = { type: 'TextInput', props: { accessibilityLabel: 'Message text' } };
  const closed = h.start('AttachmentComposer', { children: input });
  assert.equal(closed[0].type, 'View');
  assert.equal(closed[0].props.style.backgroundColor, 'transparent');
  assert.equal(closed.some(n => n.props.accessibilityLabel === 'Choose file'), false);
  h.press('Add attachment', closed);
  const opened = h.render();
  assert.equal(opened[0].props.style, closed[0].props.style);
  const menu = opened[0].props.children[0];
  assert.equal(menu.type, 'View');
  const labels = opened.map(n => n.props.accessibilityLabel);
  for (const label of ['Choose file', 'Photo library', 'Take photo', 'Paste']) {
    assert.ok(labels.includes(label));
    assert.ok(labels.indexOf(label) < labels.indexOf('Message text'));
  }
  assert.equal(opened.some(n => n.props.style?.boxShadow), false, 'parent owns the only shadow');
  h.press('Add attachment', opened);
  assert.equal(h.render().some(n => n.props.accessibilityLabel === 'Choose file'), false);
});

test('plus shares the input row while menu and previews remain above it', async () => {
  const h = harness(); let height;
  const input = { type: 'TextInput', props: { accessibilityLabel: 'Message text' } };
  const nodes = h.start('AttachmentComposer', { children: input, onComposerHeight: value => { height = value; } });
  const row = nodes.find(x => x.type === 'View' && x.props.style?.alignItems === 'flex-end');
  assert.equal(row.props.style.flexDirection, 'row');
  const children = row.props.children.flat(Infinity);
  assert.equal(children[0].props.accessibilityLabel, 'Add attachment'); assert.equal(children[1], input);
  row.props.onLayout({ nativeEvent: { layout: { height: 60 } } }); assert.equal(height, 60);
  h.setImages(async () => ({ canceled: false, assets: [{ uri: 'file://a', fileName: 'x.png', fileSize: 2, mimeType: 'image/png' }] }));
  h.press('Photo library'); await flush();
  h.press('Add attachment'); let opened = h.render();
  assert.ok(opened.findIndex(x => x.props.accessibilityLabel === 'Photo library') < opened.findIndex(x => x.props.accessibilityLabel === 'Add attachment'));
  assert.ok(opened.findIndex(x => x.props.accessibilityLabel === 'View image: x.png') < opened.findIndex(x => x.props.accessibilityLabel === 'Add attachment'));
  h.press('Add attachment'); h.render(); assert.equal(h.uploads.length, 1); assert.deepEqual(h.deletions, []); h.unmount();
});

test('selection helpers cap count and actual size without accepting unknown bytes', () => {
  const src = Array.from({ length: 10 }, (_, i) => ({ uri: 'file://a', name: `f${i}.txt`, size: 1 }));
  const selected = chooseAttachments(2, src);
  assert.equal(selected.accepted.length, 6); assert.match(selected.error, /up to 8 attachments/);
  assert.equal(chooseAttachments(0, [{ uri: 'file://a', name: 'too.txt', size: MAX_ATTACHMENT_BYTES + 1 }]).accepted.length, 0);
  assert.equal(chooseAttachments(0, [{ uri: 'file://a', name: 'unknown.txt' }]).accepted.length, 0);
  assert.equal(chooseAttachments(0, [{ uri: 'file://a', name: 'a/b.txt', size: 1 }]).accepted[0].name, 'a_b.txt');
});

test('picker cancel, multiple upload, failed retry, explicit removal and clear ownership', async () => {
  const h = harness();
  h.start('AttachmentComposer');
  h.press('Choose file'); await flush();
  assert.equal(h.uploads.length, 0);
  h.setFiles(async opts => { assert.equal(opts.multiple, true); assert.equal(opts.copyToCacheDirectory, true); return { canceled: false, assets: [{ uri: 'file://a', name: 'a.txt', size: 2 }, { uri: 'file://b', name: 'b.txt', size: 2 }] }; });
  h.press('Choose file'); await flush(); h.render();
  assert.equal(JSON.stringify(h.notices.at(-1)), JSON.stringify([['att_1', 'att_2'], false]));
  h.press('Remove: a.txt'); await flush(); h.render();
  assert.deepEqual(h.deletions, [['th', 'att_1']]);
  assert.equal(JSON.stringify(h.notices.at(-1)), JSON.stringify([['att_2'], false]));
  h.render({ client: h.client, threadId: 'th', clearKey: 1, onChange: (a, b) => h.notices.push([a.map(x => x.id), b]) });
  h.unmount();
  assert.deepEqual(h.deletions, [['th', 'att_1']], 'clear/unmount must not delete a submitted upload');
});

test('picker failure stays visible and busy until retry succeeds; server bytes are checked', async () => {
  const h = harness();
  let fail = true;
  h.client.upload = async (...args) => { h.uploads.push(args); if (fail) throw new Error('offline'); return { id: 'att_ok', thread_id: 'th', name: 'a.txt', mime: 'text/plain', size: 2, state: 'available' }; };
  h.setFiles(async () => ({ canceled: false, assets: [{ uri: 'file://a', name: 'a.txt', size: 2 }] }));
  h.start('AttachmentComposer'); h.press('Choose file'); await flush();
  assert.equal(JSON.stringify(h.notices.at(-1)), JSON.stringify([[], true]));
  assert.ok(h.render().some(x => x.props.accessibilityLabel === 'Retry: a.txt'));
  fail = false; h.press('Retry: a.txt'); await flush();
  assert.equal(JSON.stringify(h.notices.at(-1)), JSON.stringify([['att_ok'], false]));
  h.unmount();
  const invalid = harness(); invalid.disks.set('file://a', new Uint8Array(MAX_ATTACHMENT_BYTES + 1));
  invalid.setFiles(async () => ({ canceled: false, assets: [{ uri: 'file://a', name: 'large.txt', size: 1 }] }));
  invalid.start('AttachmentComposer'); invalid.press('Choose file'); await flush();
  assert.equal(invalid.uploads.length, 0); assert.equal(JSON.stringify(invalid.notices.at(-1)), JSON.stringify([[], true])); invalid.unmount();
});

test('iOS paste image opens a routed, viewer-owned copy that survives composer cleanup', async () => {
  const h = harness(); h.start('AttachmentComposer');
  let reads = 0;
  h.setClipboard(async () => { reads++; return { data: 'data:image/png;base64,AQID' }; });
  assert.equal(reads, 0);
  assert.ok(!h.render().some(x => x.type === 'ClipboardPasteButton'));
  h.press('Paste'); await flush();
  assert.equal(reads, 1);
  assert.equal(h.uploads[0].bytes.length, 3);
  h.press('View image: pasted-image.png');
  await flush();
  assert.equal(h.viewers.at(-1).title, 'pasted-image.png');
  const nodes = h.view();
  assert.equal(nodes.find(x => x.type === 'ScrollView' && x.props.minimumZoomScale === 1).props.maximumZoomScale, 4);
  const viewerUri = nodes.find(x => x.type === 'Image').props.source.uri;
  assert.notEqual(viewerUri, h.render().find(x => x.type === 'Image').props.source.uri);
  assert.deepEqual([...h.disks.get(viewerUri)], [1, 2, 3]);
  h.unmount();
  assert.equal(h.removed.length, 1);
  assert.ok(h.disks.has(viewerUri), 'viewer copy outlives composer');
  h.close();
  assert.equal(h.disks.has(viewerUri), false);
  assert.equal(h.removed.length, 2); assert.equal(h.deletions.length, 0);
});

test('image copy cannot open after its draft row is removed; Android route retains zoom controls', async () => {
  const h = harness({ platform: 'android' });
  h.setImages(async () => ({ canceled: false, assets: [{ uri: 'file://a', fileName: 'x.png', fileSize: 2, mimeType: 'image/png' }] }));
  h.start('AttachmentComposer'); h.press('Photo library'); await flush();
  const pending = deferred();
  h.setCopyGate(() => pending.promise);
  h.press('View image: x.png');
  h.press('Remove: x.png');
  pending.resolve(); await flush();
  assert.equal(h.viewers.length, 0, 'stale async copy cannot navigate');
  assert.equal(h.disks.size, 2, 'stale viewer-owned copy deleted');
  h.press('Photo library'); await flush();
  h.setCopyGate(async () => {});
  h.press('View image: x.png'); await flush();
  const viewer = h.view();
  const image = () => h.view().find(n => n.type === 'Image');
  assert.equal(viewer.find(n => n.props.accessibilityLabel === 'Zoom in') !== undefined, true);
  assert.equal(image().props.style.width, 390);
  viewer.find(n => n.props.accessibilityLabel === 'Zoom in').props.onPress();
  assert.equal(image().props.style.width, 585);
  h.close(); h.unmount();
});

test('Android fallback reads clipboard only after explicit press', async () => {
  const h = harness({ platform: 'android', nativePaste: false });
  let reads = 0; h.setClipboard(async () => { reads++; return { data: 'data:image/png;base64,AQID' }; });
  h.start('AttachmentComposer'); assert.equal(reads, 0);
  h.press('Paste'); await flush(); assert.equal(reads, 1); assert.equal(h.uploads.length, 1); h.unmount();
});

test('history loads images through SDK, routes image/text views and separates viewer copy lifetime', async () => {
  const h = harness();
  const attachments = [{ id: 'att_i', name: 'x.png', mime: 'image/png', size: 2, state: 'available' }, { id: 'att_t', name: 'note.txt', mime: 'text/plain', size: 2, state: 'available' }, { id: 'att_missing', name: 'gone.png', mime: 'image/png', state: 'missing' }];
  h.start('MessageAttachments', { attachments }); await flush();
  assert.deepEqual(h.downloads.map(x => x.id), ['att_i']);
  let nodes = h.render();
  assert.ok(nodes.some(x => x.type === 'Image' && x.props.source.uri.startsWith('file://')));
  h.press('View attachment: x.png', nodes);
  await flush();
  assert.equal(h.viewers.at(-1).title, 'x.png');
  const imageUri = h.view().find(x => x.type === 'Image').props.source.uri;
  assert.notEqual(imageUri, nodes.find(x => x.type === 'Image').props.source.uri);
  assert.deepEqual([...h.disks.get(imageUri)], [7, 8]);
  h.press('View attachment: note.txt'); await flush();
  assert.deepEqual(h.downloads.map(x => x.id), ['att_i', 'att_t']);
  h.press('View attachment: note.txt');
  assert.equal(h.viewers.at(-1).title, 'note.txt');
  assert.equal(h.view().find(x => x.type === 'Text' && x.props.selectable).props.children[0], '\u0007\b');
  h.close();
  h.unmount();
  assert.ok(h.disks.has(imageUri), 'row cache was evicted but image route owns a copy');
  assert.equal(h.removed.length, 2);
  h.close();
  assert.equal(h.disks.has(imageUri), false);
  assert.equal(h.removed.length, 3); assert.equal(h.deletions.length, 0);

});

test('late picker result after clear is ignored without deleting uploaded IDs', async () => {
  const h = harness(); const pending = deferred();
  h.setImages(() => pending.promise); h.start('AttachmentComposer'); h.press('Photo library');
  h.render({ client: h.client, threadId: 'other', clearKey: 1, onChange: (a, b) => h.notices.push([a.map(x => x.id), b]) });
  pending.resolve({ canceled: false, assets: [{ uri: 'file://a', fileName: 'x.png', fileSize: 2, mimeType: 'image/png' }] });
  await flush(); assert.equal(h.uploads.length, 0); h.unmount();
});

test('production picker trims to eight and retains a visible limit notice', async () => {
  const h = harness();
  h.setImages(async options => {
    assert.equal(options.allowsMultipleSelection, true);
    return { canceled: false, assets: Array.from({ length: 10 }, (_, i) => ({ uri: 'file://a', fileName: `x${i}.png`, fileSize: 2, mimeType: 'image/png' })) };
  });
  h.start('AttachmentComposer'); h.press('Photo library'); await flush();
  assert.equal(h.uploads.length, 8);
  assert.ok(h.render().some(x => x.props.accessibilityRole === 'alert'));
  h.press('Add attachment');
  assert.equal(h.render().find(x => x.props.accessibilityLabel === 'Photo library').props.disabled, true);
  assert.equal(h.render().find(x => x.props.accessibilityLabel === 'Paste').props.disabled, false);
  h.unmount();
});

test('history download failures remain retryable and pending work aborts on unmount', async () => {
  const h = harness();
  const pending = deferred(); let calls = 0;
  h.client.download = (thread, id, signal) => { h.downloads.push({ thread, id, signal }); return ++calls === 1 ? Promise.reject(new Error('offline')) : pending.promise; };
  const attachments = [{ id: 'att_i', name: 'x.png', mime: 'image/png', size: 2, state: 'available' }];
  h.start('MessageAttachments', { attachments }); await flush();
  assert.ok(h.render().some(x => x.props.accessibilityRole === 'button' && x.props.accessibilityLabel === 'View attachment: x.png'));
  assert.equal(h.render().find(x => x.type === 'Text' && x.props.children.includes('Failed to load. Tap to retry')) !== undefined, true);
  h.press('View attachment: x.png'); await flush(); assert.equal(h.downloads.length, 2);
  h.unmount(); assert.equal(h.downloads[1].signal.aborted, true);
  pending.resolve(Uint8Array.from([7, 8])); await flush(); assert.equal(h.disks.size, 2, 'late download must not write cache');
});

test('one plus toggles choices without a new modal; cancel closes menu', async () => {
  const h = harness(); const nodes = h.start('AttachmentComposer');
  assert.ok(nodes.some(x => x.props.accessibilityLabel === 'Add attachment'));
  assert.ok(!nodes.some(x => ['Choose file', 'Photo library', 'Take photo', 'Paste'].includes(x.props.accessibilityLabel)));
  h.press('Add attachment');
  const opened = h.render();
  for (const label of ['Choose file', 'Photo library', 'Take photo', 'Paste']) assert.ok(opened.some(x => x.props.accessibilityLabel === label));
  assert.ok(!opened.some(x => x.type === 'Modal' && x.props.visible));
  h.press('Add attachment'); assert.equal(h.render().find(x => x.props.accessibilityLabel === 'Add attachment').props.accessibilityState.expanded, false);
  h.press('Photo library'); await flush();
  assert.ok(!h.render().some(x => x.props.accessibilityLabel === 'Photo library')); assert.equal(h.uploads.length, 0); h.unmount();
});

test('camera permission is on demand, denial/cancel safe, photo uses upload and preview', async () => {
  const h = harness(); let requests = 0, launches = 0, granted = false;
  h.setPermission(async () => { requests++; return { granted }; });
  h.setCamera(async options => { launches++; assert.equal(options.mediaTypes[0], 'images'); return { canceled: true }; });
  h.start('AttachmentComposer'); assert.equal(requests, 0);
  h.press('Take photo'); await flush(); assert.equal(requests, 1); assert.equal(launches, 0);
  assert.ok(h.render().some(x => x.props.accessibilityRole === 'alert'));
  granted = true; h.press('Take photo'); await flush(); assert.equal(launches, 1); assert.equal(h.uploads.length, 0);
  h.setCamera(async () => ({ canceled: false, assets: [{ uri: 'file://a', mimeType: 'image/png', fileSize: 2 }] }));
  h.press('Take photo'); await flush(); assert.equal(h.uploads[0].name, 'photo.png');
  h.press('View image: photo.png'); await flush();
  assert.equal(h.viewers.at(-1).title, 'photo.png');
  assert.equal(h.view().find(x => x.type === 'ScrollView').props.maximumZoomScale, 4);
  h.close(); h.unmount();
});

test('camera permission and image results cannot cross composer lifetime', async () => {
  for (const phase of ['permission', 'capture']) {
    const h = harness(), pending = deferred(); let launches = 0;
    if (phase === 'permission') h.setPermission(() => pending.promise);
    h.setCamera(async () => { launches++; return pending.promise; });
    h.start('AttachmentComposer'); h.press('Take photo'); await flush(); h.unmount();
    pending.resolve(phase === 'permission' ? { granted: true } : { canceled: false, assets: [{ uri: 'file://a', fileSize: 2 }] });
    await flush(); assert.equal(h.uploads.length, 0); assert.equal(launches, phase === 'permission' ? 0 : 1);
  }
});

test('generic paste dispatches text and URL without uploading; empty remains honest', async () => {
  const h = harness(); h.start('AttachmentComposer');
  h.setClipboardText('文字和富文本的纯文字'); h.press('Paste'); await flush();
  h.setClipboardText('', 'https://example.com'); h.press('Paste'); await flush();
  assert.deepEqual(h.pasted, ['文字和富文本的纯文字', 'https://example.com']); assert.equal(h.uploads.length, 0);
  h.setClipboardText(''); h.press('Paste'); await flush();
  assert.ok(h.render().some(x => x.props.accessibilityRole === 'alert')); assert.equal(h.pasted.length, 2); h.unmount();
});
