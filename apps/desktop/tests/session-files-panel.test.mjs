import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import { create, act } from 'react-test-renderer';

// Production SessionFilesPanel (status bar > Session files).
const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: [new URL('../src/renderer/session-files-panel.tsx', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', external: ['react', 'react/jsx-runtime'], write: false });
const mod = { exports: {} }; new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, mod, mod.exports);
const { SessionFilesPanel } = mod.exports;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const file = (id, list, extra = {}) => ({ id, threadId: 'th', name: id + '.pdf', mime: 'application/pdf', size: 4096, state: 'available', list, createdAt: 1792000000, ...extra });

async function fixture(api = {}) {
  const calls = []; let closed = 0, tree;
  const record = (name, result) => async (...args) => { calls.push([name, ...args]); return typeof result === 'function' ? result(...args) : result; };
  globalThis.window = { hermesDesktop: {
    listSessionFiles: record('list', (list, after) => list === 'delivered'
      ? (after ? { supported: true, items: [file('att_3', 'delivered')], nextAfter: null } : { supported: true, items: [file('att_1', 'delivered', { caption: 'Q3 report' }), file('att_2', 'delivered', { state: 'missing' })], nextAfter: '1:att_2' })
      : { supported: true, items: [], nextAfter: null }),
    prepareSessionFile: record('prepare'), previewAttachment: record('preview'), downloadAttachment: record('download'),
    ...Object.fromEntries(Object.entries(api).map(([name, result]) => [name, record(name, result)])),
  } };
  await act(async () => { tree = create(React.createElement(SessionFilesPanel, { close: () => closed++ })); });
  const buttons = () => tree.root.findAllByType('button');
  const button = label => buttons().find(b => b.props['aria-label'] === label || b.children.join('') === label || (b.props.role === 'tab' && String(b.children[0]) === label));
  const text = () => JSON.stringify(tree.toJSON());
  const click = async target => { await act(async () => target.props.onClick()); };
  return { tree, calls, button, buttons, text, click, closed: () => closed, dispose: async () => { await act(async () => tree.unmount()); } };
}

test('Session files lists delivered files first; a missing file stays listed but cannot be opened', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(f.calls.filter(c => c[0] === 'list').map(c => c[1]).sort(), ['delivered', 'uploaded']);
    assert.ok(f.text().includes('att_1.pdf') && f.text().includes('Q3 report') && f.text().includes('No longer available'));
    const missing = f.buttons().find(b => b.props.className === 'session-file-main' && b.props.title === 'att_2.pdf');
    assert.equal(missing.props.disabled, true);
    assert.equal(f.button('Open att_2.pdf'), undefined, 'no Open or Save for a missing file');
    await f.click(f.button('Show more'));
    assert.ok(f.text().includes('att_3.pdf'));
    assert.deepEqual(f.calls.filter(c => c[0] === 'list').at(-1), ['list', 'delivered', '1:att_2']);
  } finally { await f.dispose(); }
});

test('A click previews; Open and Save prepare the file first; Attachments shows its own empty text', async () => {
  const f = await fixture();
  try {
    await f.click(f.buttons().find(b => b.props.title === 'att_1.pdf'));
    assert.deepEqual(f.calls.slice(-2), [['prepare', 'att_1'], ['preview', 'att_1']]);
    assert.equal(f.closed(), 1, 'preview closes the panel');
    await f.click(f.button('Save att_1.pdf'));
    assert.deepEqual(f.calls.slice(-2), [['prepare', 'att_1'], ['download', 'att_1', 'save']]);
    await f.click(f.button('Open att_1.pdf'));
    assert.deepEqual(f.calls.slice(-2), [['prepare', 'att_1'], ['download', 'att_1', 'open']]);
    await f.click(f.buttons().find(b => b.props.role === 'tab' && b.props['aria-selected'] === false));
    assert.ok(f.text().includes('You have not sent files in this session.'));
  } finally { await f.dispose(); }
});

test('An unavailable file or an older server shows a plain message', async () => {
  const f = await fixture({ prepareSessionFile: () => { throw new Error('gone'); } });
  try {
    await f.click(f.buttons().find(b => b.props.title === 'att_1.pdf'));
    assert.ok(f.text().includes('could not be opened'));
    assert.equal(f.closed(), 0);
  } finally { await f.dispose(); }
  const old = await fixture({ listSessionFiles: { supported: false, items: [], nextAfter: null } });
  try { assert.ok(old.text().includes('does not list session files yet')); } finally { await old.dispose(); }
});
