import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import { create, act } from 'react-test-renderer';

// Production ProjectDialog: one modal for New project and Project settings.
const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: [new URL('../src/renderer/project-dialog.tsx', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', external: ['react', 'react/jsx-runtime'], write: false });
const mod = { exports: {} }; new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, mod, mod.exports);
const { ProjectDialog } = mod.exports;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const key = 'a'.repeat(24);
const connection = { id: 'primary', connectionKey: key, name: 'First', server: 'https://first.example.test', state: 'online', supportsProjectFiles: true };
const snapshot = { connections: [connection], connectionKey: key, connectionState: 'online', channels: [{ id: 'p1', name: 'Research', connectionKey: key }] };
const etag = '"' + 'e'.repeat(64) + '"';
const file = (name, size = 5) => ({ name, size });

async function fixture({ value = snapshot, channelId, api = {} } = {}) {
  const calls = []; let closed = 0, tree;
  const record = (name, result) => async (...args) => { calls.push([name, ...args]); return typeof result === 'function' ? result(...args) : result; };
  globalThis.window = { confirm: () => true, hermesDesktop: {
    createChannel: record('create', 'p-new'),
    updateChannel: record('update'),
    deleteChannel: record('delete'),
    getChannelInfo: record('info', { id: 'p1', name: 'Research', description: 'Old context' }),
    getProjectWorkspace: record('workspace', { supported: true, agents: { content: '# Rules', etag }, files: [{ name: 'notes.md', kind: 'file', size: 2048 }, { name: 'data', kind: 'directory', size: null }], moreFiles: false }),
    saveProjectAgents: record('agents', { ok: true, etag }),
    addProjectFiles: record('files', (_id, files) => ({ uploaded: files.map(f => f.name) })),
    ...Object.fromEntries(Object.entries(api).map(([name, result]) => [name, record(name, result)])),
  } };
  const close = () => closed++;
  const element = () => React.createElement(ProjectDialog, { snapshot: value, channelId, close });
  await act(async () => { tree = create(element()); });
  const field = label => tree.root.findByProps({ 'aria-label': label });
  const has = label => tree.root.findAllByProps({ 'aria-label': label }).length > 0;
  const type = async (label, text) => { await act(async () => field(label).props.onChange({ target: { value: text } })); };
  const stage = async (...files) => { await act(async () => tree.root.findByProps({ type: 'file' }).props.onChange({ target: { files, value: '' } })); };
  const submit = async () => { await act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} })); };
  const alert = () => tree.root.findAllByProps({ role: 'alert' }).map(node => node.children.join('')).join(' ');
  const saveButton = () => tree.root.findByProps({ type: 'submit' });
  return { tree, calls, field, has, type, stage, submit, alert, saveButton, closed: () => closed, dispose: async () => { await act(async () => tree.unmount()); } };
}

test('New project shows Title, Context, Files and AGENTS.md and writes them in order after creation', async () => {
  const f = await fixture();
  try {
    for (const label of ['Project title', 'Project context', 'Project files', 'Project AGENTS.md']) assert.ok(f.has(label), label);
    await f.type('Project title', 'Launch'); await f.type('Project context', 'Q4 launch'); await f.type('Project AGENTS.md', 'Be brief.');
    await f.stage(file('brief.pdf'), file('plan.md'));
    await f.submit();
    assert.deepEqual(f.calls.map(c => c[0]), ['create', 'agents', 'files']);
    assert.deepEqual(f.calls[0][1], { connectionKey: key, name: 'Launch', description: 'Q4 launch' });
    assert.deepEqual(f.calls[1].slice(1), ['p-new', 'Be brief.', null]);
    assert.deepEqual(f.calls[2][2].map(x => x.name), ['brief.pdf', 'plan.md']);
    assert.equal(f.closed(), 1);
  } finally { await f.dispose(); }
});

test('New project without server support hides Files and AGENTS.md and never calls workspace APIs', async () => {
  const f = await fixture({ value: { ...snapshot, connections: [{ ...connection, supportsProjectFiles: false }] } });
  try {
    assert.equal(f.has('Project files'), false); assert.equal(f.has('Project AGENTS.md'), false);
    await f.type('Project title', 'Plain'); await f.submit();
    assert.deepEqual(f.calls.map(c => c[0]), ['create']); assert.equal(f.closed(), 1);
  } finally { await f.dispose(); }
});

test('A failure after creation keeps the form, never creates twice and Save finishes the remaining writes', async () => {
  let attempts = 0;
  const f = await fixture({ api: { saveProjectAgents: () => (++attempts === 1 ? { ok: false, reason: 'failed' } : { ok: true, etag }) } });
  try {
    await f.type('Project title', 'Launch'); await f.type('Project AGENTS.md', 'Rules'); await f.stage(file('a.txt'));
    await f.submit();
    assert.equal(f.closed(), 0);
    assert.match(f.alert(), /project was created/i);
    assert.equal(f.field('Project AGENTS.md').props.value, 'Rules');
    assert.equal(f.saveButton().children.join(''), 'Save');
    await f.submit();
    assert.deepEqual(f.calls.map(c => c[0]), ['create', 'saveProjectAgents', 'saveProjectAgents', 'files']);
    assert.equal(f.calls[2][1], 'p-new');
    assert.equal(f.closed(), 1);
  } finally { await f.dispose(); }
});

test('Project settings loads details and files, and saves only changed parts with the loaded version', async () => {
  const f = await fixture({ channelId: 'p1' });
  try {
    assert.equal(f.has('Project connection'), false);
    assert.equal(f.field('Project title').props.value, 'Research');
    assert.equal(f.field('Project context').props.value, 'Old context');
    assert.equal(f.field('Project AGENTS.md').props.value, '# Rules');
    const names = f.tree.root.findAllByProps({ className: 'project-file-name' }).map(node => node.children.join(''));
    assert.deepEqual(names, ['notes.md', 'data/']);
    assert.equal(f.saveButton().props.disabled, true, 'nothing changed');
    await f.type('Project AGENTS.md', '# Rules\nNew rule');
    await f.submit();
    assert.deepEqual(f.calls.filter(c => !['info', 'getChannelInfo', 'workspace'].includes(c[0])), [['agents', 'p1', '# Rules\nNew rule', etag]]);
    assert.equal(f.closed(), 1);
  } finally { await f.dispose(); }
});

test('An existing file name is refused before upload and a server conflict keeps the staged file', async () => {
  const f = await fixture({ channelId: 'p1', api: { addProjectFiles: () => ({ uploaded: [], failed: { name: 'new.md', reason: 'exists' } }) } });
  try {
    await f.stage(file('notes.md'));
    assert.match(f.alert(), /already in this project/);
    await f.stage(file('new.md'));
    await f.submit();
    assert.match(f.alert(), /already exists/);
    assert.equal(f.closed(), 0);
    assert.ok(f.tree.root.findAllByProps({ className: 'project-file-name' }).some(node => node.children.join('') === 'new.md'));
  } finally { await f.dispose(); }
});

test('An AGENTS.md version conflict keeps the text and stops further saves', async () => {
  const f = await fixture({ channelId: 'p1', api: { saveProjectAgents: { ok: false, reason: 'conflict' } } });
  try {
    await f.type('Project AGENTS.md', 'Mine'); await f.submit();
    assert.match(f.alert(), /changed on another device/);
    assert.equal(f.field('Project AGENTS.md').props.value, 'Mine');
    assert.equal(f.saveButton().props.disabled, true);
  } finally { await f.dispose(); }
});

// Primary folder: AGENTS.md follows it, so a folder change and an AGENTS.md edit never save together.
const folderInfo = (primaryPath) => ({ id: 'p1', name: 'Research', description: 'Old context', primaryPathSupported: true, ...(primaryPath ? { primaryPath } : {}) });

test('Project settings binds a primary folder, strips a trailing slash and leaves AGENTS.md alone', async () => {
  const f = await fixture({ channelId: 'p1', api: { getChannelInfo: folderInfo(), setProjectFolder: { ok: true } } });
  try {
    assert.equal(f.field('Project primary folder').props.value, '');
    await f.type('Project primary folder', ' /opt/projects/jamie/app/ ');
    assert.equal(f.field('Project AGENTS.md').props.disabled, true, 'AGENTS.md is locked while the folder changes');
    await f.submit();
    assert.deepEqual(f.calls.filter(c => !['info', 'getChannelInfo', 'workspace'].includes(c[0])), [['setProjectFolder', 'p1', '/opt/projects/jamie/app']]);
    assert.equal(f.closed(), 1);
  } finally { await f.dispose(); }
});

test('An AGENTS.md edit locks the folder field; clearing the folder asks first and sends null', async () => {
  const f = await fixture({ channelId: 'p1', api: { getChannelInfo: folderInfo('/opt/projects/x'), setProjectFolder: { ok: true } } });
  try {
    await f.type('Project AGENTS.md', 'Changed');
    assert.equal(f.field('Project primary folder').props.disabled, true);
    await f.type('Project AGENTS.md', '# Rules');
    assert.equal(f.field('Project primary folder').props.disabled, false);
    let asked = 0; globalThis.window.confirm = () => { asked++; return false; };
    await f.type('Project primary folder', '');
    await f.submit();
    assert.equal(asked, 1); assert.equal(f.calls.some(c => c[0] === 'setProjectFolder'), false); assert.equal(f.closed(), 0);
    globalThis.window.confirm = () => true;
    await f.submit();
    assert.deepEqual(f.calls.find(c => c[0] === 'setProjectFolder'), ['setProjectFolder', 'p1', null]);
    assert.equal(f.closed(), 1);
  } finally { await f.dispose(); }
});

test('Folder rejections keep the form open with a plain reason', async () => {
  for (const [reason, text] of [['invalid', /inside \/opt\/projects/], ['taken', /Another project already uses this folder/], ['failed', /could not be confirmed/]]) {
    const f = await fixture({ channelId: 'p1', api: { getChannelInfo: folderInfo(), setProjectFolder: { ok: false, reason } } });
    try {
      await f.type('Project primary folder', '/opt/projects/bad'); await f.submit();
      assert.match(f.alert(), text); assert.equal(f.closed(), 0);
      assert.equal(f.field('Project primary folder').props.value, '/opt/projects/bad');
    } finally { await f.dispose(); }
  }
});

test('New project sets the folder after creation and skips AGENTS.md; older servers hide the field', async () => {
  const f = await fixture({ value: { ...snapshot, connections: [{ ...connection, supportsPrimaryPath: true }] }, api: { setProjectFolder: { ok: true } } });
  try {
    await f.type('Project title', 'Repo'); await f.type('Project primary folder', '/opt/projects/repo');
    await f.submit();
    assert.deepEqual(f.calls.map(c => c[0]), ['create', 'setProjectFolder']);
    assert.deepEqual(f.calls[1].slice(1), ['p-new', '/opt/projects/repo']);
  } finally { await f.dispose(); }
  const old = await fixture({ channelId: 'p1' });
  try { assert.equal(old.has('Project primary folder'), false); } finally { await old.dispose(); }
});

test('Project settings archives through the server when supported and never deletes', async () => {
  const f = await fixture({ channelId: 'p1', api: { getChannelInfo: { id: 'p1', name: 'Research', archiveSupported: true }, archiveChannel: undefined } });
  try {
    const buttons = () => f.tree.root.findAllByType('button').map(b => b.children.join(''));
    assert.ok(buttons().includes('Archive project')); assert.ok(!buttons().includes('Delete project'));
    await act(async () => f.tree.root.findAllByType('button').find(b => b.children.join('') === 'Archive project').props.onClick());
    assert.deepEqual(f.calls.filter(c => ['archiveChannel', 'delete'].includes(c[0])), [['archiveChannel', 'p1']]);
    assert.equal(f.closed(), 1);
  } finally { await f.dispose(); }
});

test('Project settings keeps Delete project on a server without archive and shows an archive failure', async () => {
  const old = await fixture({ channelId: 'p1' });
  try {
    const labels = old.tree.root.findAllByType('button').map(b => b.children.join(''));
    assert.ok(labels.includes('Delete project')); assert.ok(!labels.includes('Archive project'));
  } finally { await old.dispose(); }
  const f = await fixture({ channelId: 'p1', api: { getChannelInfo: { id: 'p1', name: 'Research', archiveSupported: true }, archiveChannel: () => { throw new Error('offline'); } } });
  try {
    await act(async () => f.tree.root.findAllByType('button').find(b => b.children.join('') === 'Archive project').props.onClick());
    assert.equal(f.closed(), 0); assert.match(f.alert(), /could not be archived/);
  } finally { await f.dispose(); }
});
