import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function harness(store = new Map()) {
  const writes = [], reads = [];
  let get = async key => store.get(key) ?? null;
  let put = async (key, value) => { store.set(key, value); };
  let cells = [], effects = [], cursor = 0, scheduled = [], mounted = false;
  const slot = init => cells[cursor++] ??= { value: typeof init === 'function' ? init() : init };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const cell = slot(initial); return [cell.value, next => { cell.value = typeof next === 'function' ? next(cell.value) : next; }]; },
    useRef(initial) { return slot(() => ({ current: initial })).value; },
    useEffect(fn, deps) { const cell = slot(null); if (!cell.deps || deps.some((d, i) => d !== cell.deps[i])) {
      scheduled.push(() => { cell.cleanup?.(); cell.cleanup = fn(); cell.deps = deps; });
    } }
  };
  const native = { StyleSheet: { create: value => value }, View: 'View', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable' };
  const disk = { getItemAsync: key => { reads.push(key); return get(key); }, setItemAsync: (key, value) => { writes.push([key, value]); return put(key, value); } };
  const mods = { react: { ...react, default: react }, 'react-native': native, 'expo-secure-store': disk };
  const output = { exports: {} };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/AgentSettings.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
    { module: output, exports: output.exports, require: key => { assert.ok(key in mods, key); return mods[key]; }, Promise });
  function render(id, commit = true) {
    cursor = 0; scheduled = [];
    const result = output.exports.useAgentName(id);
    if (commit) { scheduled.forEach(f => f()); mounted = true; }
    return result;
  }
  function form(props, commit = true) {
    // A form has its own hook slots; mounting it does not remount the parent hook.
    const saved = cells; const savedMounted = mounted;
    cells = effects; cursor = 0; scheduled = [];
    const tree = output.exports.AgentSettings(props);
    if (commit) scheduled.forEach(f => f());
    effects = cells; cells = saved; mounted = savedMounted;
    return tree;
  }
  function unmount() { if (mounted) { for (const cell of cells) cell?.cleanup?.(); mounted = false; } }
  function unmountForm() { for (const cell of effects) cell?.cleanup?.(); effects = []; }
  const flatten = node => !node || typeof node !== 'object' ? [] : [node, ...node.props.children.flatMap(flatten)];
  const field = tree => flatten(tree).find(n => n.type === 'TextInput');
  const button = (tree, label) => { const result = flatten(tree).find(n => n.type === 'Pressable' && n.props.accessibilityLabel === label); assert.ok(result, `missing ${label}`); return result; };
  return { store, writes, reads, render, form, unmount, unmountForm, field, button, setGet(fn) { get = fn; }, setPut(fn) { put = fn; } };
}

const view = async (h, id) => { h.render(id); await tick(); return h.render(id); };
const props = (state, onClose) => ({ ...state, onSave: state.save, onClose });

test('blank/custom durable round trip and cold restart, with collision-free per-connection keys', async () => {
  const store = new Map(), h = harness(store);
  let state = await view(h, 'ab'); assert.equal(state.name, 'Agent'); assert.equal(state.ready, true);
  assert.equal(await state.save('  小猫🐈  '), true);
  state = h.render('ab'); assert.equal(state.name, '小猫🐈');
  assert.equal(await state.save('   '), true); assert.equal(h.render('ab').name, 'Agent');
  assert.equal(await state.save('custom'), true);
  h.unmount();
  const cold = harness(store);
  assert.equal((await view(cold, 'ab')).name, 'custom');
  assert.equal((await view(cold, 'a\u0062')).name, 'custom');
  // Distinct UTF-16 strings cannot overlap even where separator/punctuation exists.
  const other = await view(cold, 'a:b'); assert.equal(other.name, 'Agent');
  assert.equal(await other.save('Other'), true);
  assert.equal((await view(cold, 'ab')).name, 'custom');
  assert.equal((await view(cold, 'a:b')).name, 'Other');
  assert.notEqual(h.reads[0], cold.reads.at(-1));
  for (const [key] of [...h.writes, ...cold.writes]) assert.match(key, /^[A-Za-z0-9._-]+$/);
  assert.equal((await view(cold, 'a\ud800')).name, 'Agent');
  assert.notEqual(cold.reads.at(-1), h.reads[0]);
});

test('validation enforces Unicode codepoints after trimming and rejects controls/bidi', async () => {
  const h = harness(); const state = await view(h, 'x');
  assert.equal(await state.save(`  ${'🐈'.repeat(40)}  `), true);
  assert.equal(h.render('x').name, '🐈'.repeat(40));
  const count = h.writes.length;
  for (const bad of ['🐈'.repeat(41), 'a\u0000b', 'x\ny', '\u202eSpoof', '\u2066isolate', 'x\u0085', '\u200f']) {
    assert.equal(await h.render('x').save(bad), false);
    assert.ok(h.render('x').error);
  }
  assert.equal(h.writes.length, count);
  assert.equal(h.render('x').name, '🐈'.repeat(40));
});

test('cold read failure can retry without overwriting saved name', async () => {
  const h = harness(); let failed = true;
  h.setGet(async () => { if (failed) throw Error('locked'); return 'restored'; });
  let state = await view(h, 'x'); assert.equal(state.ready, false);
  let tree = h.form({ ...props(state, () => {}), onRetry: state.reload });
  h.button(tree, 'Retry loading').props.onPress();
  failed = false; state = await view(h, 'x');
  assert.equal(state.name, 'restored'); assert.equal(state.ready, true);
  assert.equal(state.error, ''); assert.equal(h.writes.length, 0);
});

test('saving guard and failure preserve name; form draft remains editable and closes only on durable success', async () => {
  const h = harness(), gate = deferred(); let close = 0;
  let state = await view(h, 'x');
  let tree = h.form(props(state, () => close++));
  assert.equal(h.field(tree).props.maxLength, 80);
  assert.equal(h.field(tree).props.placeholder, 'Agent');
  assert.equal(h.field(tree).props.value, '');
  assert.match(JSON.stringify(tree), /Only changes how the Agent appears on this device/);
  h.field(tree).props.onChangeText('draft');
  h.setPut(() => gate.promise);
  tree = h.form(props(h.render('x'), () => close++));
  h.button(tree, 'Save').props.onPress();
  await tick();
  assert.equal(h.render('x').saving, true);
  h.button(tree, 'Save').props.onPress();
  assert.equal(h.writes.length, 1);
  gate.reject(new Error('storage full')); await tick();
  state = h.render('x'); assert.equal(state.name, 'Agent'); assert.match(state.error, /Could not save the name/);
  tree = h.form(props(state, () => close++)); assert.equal(h.field(tree).props.value, 'draft'); assert.equal(close, 0);
  h.setPut(async (key, value) => h.store.set(key, value));
  h.button(tree, 'Save').props.onPress(); await tick();
  assert.equal(h.render('x').name, 'draft'); assert.equal(close, 1);
});

test('cancel makes no write; loaded name populates form unless user already typed', async () => {
  const h = harness(); const gate = deferred(); h.setGet(() => gate.promise);
  let state = h.render('x'); let closed = 0;
  let tree = h.form(props(state, () => closed++));
  assert.equal(h.button(tree, 'Save').props.disabled, true);
  h.button(tree, 'Close').props.onPress(); assert.equal(closed, 1); assert.equal(h.writes.length, 0);
  gate.resolve('persisted'); await tick();
  state = h.render('x'); tree = h.form(props(state, () => closed++));
  // State updates from effects appear after the next render.
  tree = h.form(props(state, () => closed++));
  assert.equal(h.field(tree).props.value, 'persisted');
});

test('cold read failure visible with manual override; late read never replaces edit', async () => {
  const h = harness(); h.setGet(async () => { throw Error('locked'); });
  let state = await view(h, 'x'); assert.equal(state.ready, false); assert.match(state.error, /Could not read the display name/);
  let tree = h.form(props(state, () => {})); assert.equal(h.button(tree, 'Save').props.disabled, true);
  h.field(tree).props.onChangeText('manual'); tree = h.form(props(state, () => {}));
  assert.equal(h.button(tree, 'Save').props.disabled, false);
  assert.equal(await state.save('manual'), true); assert.equal(h.render('x').name, 'manual');
  const delayed = harness(), gate = deferred(); delayed.setGet(() => gate.promise);
  delayed.render('a'); assert.equal(await delayed.render('a').save('new'), true);
  gate.resolve('old'); await tick(); assert.equal(delayed.render('a').name, 'new');
});

test('switching back during a pending write reloads the durable result, never an older read', async () => {
  const h = harness(), gate = deferred();
  const a = await view(h, 'a'); h.setPut(async (key, value) => { await gate.promise; h.store.set(key, value); });
  const saving = a.save('Alice');
  await view(h, 'b');
  assert.equal(h.render('a').name, 'Agent');
  assert.equal(h.render('a').ready, false);
  gate.resolve(); assert.equal(await saving, false);
  await tick();
  assert.equal(h.render('a').name, 'Alice'); assert.equal(h.render('a').ready, true);
  const count = h.writes.length;
  assert.equal(await a.save('stale callback'), false);
  assert.equal(h.writes.length, count);
  assert.equal(h.render('a').name, 'Alice');
});

test('unmounted pending write cannot publish a name or report success', async () => {
  const h = harness(), gate = deferred(); h.setPut(() => gate.promise);
  const state = await view(h, 'a'), result = state.save('Alice');
  h.unmount(); gate.resolve(); assert.equal(await result, false);
});

test('late save from a closed form never closes a newly opened form', async () => {
  const h = harness(), gate = deferred(); h.setPut(() => gate.promise);
  const state = await view(h, 'a'); let closes = 0;
  let tree = h.form(props(state, () => closes++));
  h.field(tree).props.onChangeText('Alice');
  tree = h.form(props(state, () => closes++)); h.button(tree, 'Save').props.onPress();
  h.unmountForm();
  const reopened = h.form(props(h.render('a'), () => closes++));
  assert.equal(h.button(reopened, 'Save').props.disabled, true);
  gate.resolve(); await tick();
  assert.equal(closes, 0); assert.equal(h.render('a').name, 'Alice');
});

test('scope switch masks name immediately and ignores old read/write callbacks', async () => {
  const h = harness(), read = deferred(); let first = true;
  h.setGet(() => first ? read.promise : Promise.resolve(null));
  h.render('a'); const old = h.render('a');
  first = false;
  assert.equal(h.render('b', false).name, 'Agent');
  assert.equal((await view(h, 'b')).name, 'Agent');
  read.resolve('Alice'); await tick();
  assert.equal(h.render('b').name, 'Agent');
  assert.equal(await old.save('bad'), false);
  assert.equal(h.writes.length, 0);

  const other = harness(), done = deferred(); other.setPut(() => done.promise);
  const a = await view(other, 'a'); let closed = 0;
  const tree = other.form(props(a, () => closed++));
  other.field(tree).props.onChangeText('Alice');
  other.button(other.form(props(a, () => closed++)), 'Save').props.onPress();
  await tick();
  assert.equal(other.render('b', false).name, 'Agent');
  assert.equal((await view(other, 'b')).name, 'Agent');
  done.resolve(); await tick();
  assert.equal(other.render('b').name, 'Agent'); assert.equal(closed, 0);
  other.unmount();
  const late = harness(), readGate = deferred(); late.setGet(() => readGate.promise); late.render('a'); late.unmount();
  readGate.resolve('Alice'); await tick(); assert.equal(late.writes.length, 0);
});
