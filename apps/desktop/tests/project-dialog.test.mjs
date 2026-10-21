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

async function fixture({ value = snapshot, channelId, api = {} } = {}) {
  const calls = []; let closed = 0, tree;
  const record = (name, result) => async (...args) => { calls.push([name, ...args]); return typeof result === 'function' ? result(...args) : result; };
  globalThis.window = { confirm: () => true, hermesDesktop: {
    createChannel: record('create', 'p-new'),
    updateChannel: record('update'),
    deleteChannel: record('delete'),
    getChannelInfo: record('info', { id: 'p1', name: 'Research', description: 'Old context' }),
    getProjectWorkspace: record('workspace', { supported: true, agents: { content: '# Rules', etag } }),
    saveProjectAgents: record('agents', { ok: true, etag }),
    ...Object.fromEntries(Object.entries(api).map(([name, result]) => [name, record(name, result)])),
  } };
  const close = () => closed++;
  const element = () => React.createElement(ProjectDialog, { snapshot: value, channelId, close });
  await act(async () => { tree = create(element()); });
  const field = label => tree.root.findByProps({ 'aria-label': label });
  const has = label => tree.root.findAllByProps({ 'aria-label': label }).length > 0;
  const type = async (label, text) => { await act(async () => field(label).props.onChange({ target: { value: text } })); };
  const submit = async () => { await act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} })); };
  const alert = () => tree.root.findAllByProps({ role: 'alert' }).map(node => node.children.join('')).join(' ');
  const saveButton = () => tree.root.findByProps({ type: 'submit' });
  return { tree, calls, field, has, type, submit, alert, saveButton, closed: () => closed, dispose: async () => { await act(async () => tree.unmount()); } };
}

const tabs = f => f.tree.root.findAllByProps({ role: 'tab' }).map(node => [node.findAllByType('span').length ? node.children[0] : node.children.join(''), node.props['aria-selected']]);
const panel = (f, id) => f.tree.root.findByProps({ id: `project-panel-${id}` });
const classOf = (f, name) => f.tree.root.findAll(node => typeof node.props.className === 'string' && node.props.className.split(' ').includes(name));

test('New project shows the fields on the left, Context and AGENTS.md as tabs on the right, and writes them in order', async () => {
  const f = await fixture();
  try {
    for (const label of ['Project title', 'Project context', 'Project AGENTS.md']) assert.ok(f.has(label), label);
    assert.equal(f.has('Project files'), false, 'Project files are not managed in this modal');
    assert.equal(f.tree.root.findAllByProps({ type: 'file' }).length, 0);
    assert.equal(classOf(f, 'wide').length, 1, 'the modal is wide');
    const [fields] = classOf(f, 'project-dialog-fields'), [right] = classOf(f, 'project-dialog-editor');
    assert.ok(fields.findByProps({ 'aria-label': 'Project title' }));
    for (const label of ['Project context', 'Project AGENTS.md']) {
      assert.ok(right.findByProps({ 'aria-label': label }), label);
      assert.equal(fields.findAllByProps({ 'aria-label': label }).length, 0, label);
    }
    assert.deepEqual(tabs(f), [['Context', true], ['AGENTS.md', false]], 'Context is the first, open tab');
    await f.type('Project title', 'Launch'); await f.type('Project context', 'Q4 launch'); await f.type('Project AGENTS.md', 'Be brief.');
    await f.submit();
    assert.deepEqual(f.calls.map(c => c[0]), ['create', 'agents']);
    assert.deepEqual(f.calls[0][1], { connectionKey: key, name: 'Launch', description: 'Q4 launch' });
    assert.deepEqual(f.calls[1].slice(1), ['p-new', 'Be brief.', null]);
    assert.equal(f.closed(), 1);
  } finally { await f.dispose(); }
});

test('New project without server support shows the Context tab only and never calls workspace APIs', async () => {
  const f = await fixture({ value: { ...snapshot, connections: [{ ...connection, supportsProjectFiles: false }] } });
  try {
    assert.equal(f.has('Project AGENTS.md'), false);
    assert.deepEqual(tabs(f), [['Context', true]]);
    assert.ok(classOf(f, 'project-dialog-editor')[0].findByProps({ 'aria-label': 'Project context' }));
    await f.type('Project title', 'Plain'); await f.submit();
    assert.deepEqual(f.calls.map(c => c[0]), ['create']); assert.equal(f.closed(), 1);
  } finally { await f.dispose(); }
});

test('A failure after creation keeps the form, never creates twice and Save finishes the remaining writes', async () => {
  let attempts = 0;
  const f = await fixture({ api: { saveProjectAgents: () => (++attempts === 1 ? { ok: false, reason: 'failed' } : { ok: true, etag }) } });
  try {
    await f.type('Project title', 'Launch'); await f.type('Project AGENTS.md', 'Rules');
    await f.submit();
    assert.equal(f.closed(), 0);
    assert.match(f.alert(), /project was created/i);
    assert.equal(f.field('Project AGENTS.md').props.value, 'Rules');
    assert.equal(f.saveButton().children.join(''), 'Save');
    await f.submit();
    assert.deepEqual(f.calls.map(c => c[0]), ['create', 'saveProjectAgents', 'saveProjectAgents']);
    assert.equal(f.calls[2][1], 'p-new');
    assert.equal(f.closed(), 1);
  } finally { await f.dispose(); }
});

test('Project settings loads details and AGENTS.md, and saves only changed parts with the loaded version', async () => {
  const f = await fixture({ channelId: 'p1' });
  try {
    assert.equal(f.has('Project connection'), false);
    assert.equal(f.field('Project title').props.value, 'Research');
    assert.equal(f.field('Project context').props.value, 'Old context');
    assert.equal(f.field('Project AGENTS.md').props.value, '# Rules');
    assert.equal(classOf(f, 'project-file-name').length, 0, 'no file list');
    assert.equal(f.saveButton().props.disabled, true, 'nothing changed');
    await f.type('Project AGENTS.md', '# Rules\nNew rule');
    await f.submit();
    assert.deepEqual(f.calls.filter(c => !['info', 'getChannelInfo', 'workspace'].includes(c[0])), [['agents', 'p1', '# Rules\nNew rule', etag]]);
    assert.equal(f.closed(), 1);
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

test('Project settings never shows Delete before the archive capability is known', async () => {
  // Capability from the connection: Archive from the first frame, before getChannelInfo resolves.
  let resolveInfo; const pending = new Promise(r => { resolveInfo = r; });
  const archived = { ...snapshot, connections: [{ ...connection, supportsChannelArchive: true }] };
  const f = await fixture({ value: archived, channelId: 'p1', api: { getChannelInfo: () => pending } });
  try {
    const labels = () => f.tree.root.findAllByType('button').map(b => b.children.join(''));
    assert.ok(labels().includes('Archive project')); assert.ok(!labels().includes('Delete project'));
    await act(async () => { resolveInfo({ id: 'p1', name: 'Research' }); await pending; });
    assert.ok(labels().includes('Archive project')); assert.ok(!labels().includes('Delete project'));
  } finally { await f.dispose(); }
  // Capability unknown while loading: no removal button until the server answers.
  let late; const waiting = new Promise(r => { late = r; });
  const g = await fixture({ channelId: 'p1', api: { getChannelInfo: () => waiting } });
  try {
    const labels = () => g.tree.root.findAllByType('button').map(b => b.children.join(''));
    assert.ok(!labels().includes('Delete project') && !labels().includes('Archive project'));
    await act(async () => { late({ id: 'p1', name: 'Research', archiveSupported: true }); await waiting; });
    assert.ok(labels().includes('Archive project')); assert.ok(!labels().includes('Delete project'));
  } finally { await g.dispose(); }
});

test('Tabs switch the editor, keep both texts, mark unsaved changes and open the tab of a failed save', async () => {
  const f = await fixture({ channelId: 'p1', api: { saveProjectAgents: { ok: false, reason: 'failed' } } });
  try {
    assert.equal(panel(f, 'context').props.hidden, false); assert.equal(panel(f, 'agents').props.hidden, true);
    const click = async label => { await act(async () => f.tree.root.findAllByProps({ role: 'tab' }).find(node => tabs(f)[f.tree.root.findAllByProps({ role: 'tab' }).indexOf(node)][0] === label).props.onClick()); };
    const marked = () => f.tree.root.findAllByProps({ className: 'project-tab-changed' }).length;
    await f.type('Project context', 'New context');
    assert.equal(marked(), 1, 'Context shows the unsaved dot');
    await click('AGENTS.md');
    assert.deepEqual(tabs(f).map(t => t[1]), [false, true]);
    assert.equal(panel(f, 'context').props.hidden, true); assert.equal(panel(f, 'agents').props.hidden, false);
    assert.equal(f.field('Project context').props.value, 'New context', 'the hidden editor keeps its text');
    await act(async () => f.tree.root.findByProps({ role: 'tablist' }).props.onKeyDown({ key: 'ArrowRight', currentTarget: { querySelector: () => null } }));
    assert.deepEqual(tabs(f).map(t => t[1]), [true, false], 'arrow keys wrap around');
    await f.type('Project AGENTS.md', 'Changed');
    assert.equal(marked(), 2);
    await f.submit();
    assert.match(f.alert(), /AGENTS.md could not be saved/);
    assert.deepEqual(tabs(f).map(t => t[1]), [false, true], 'the failed editor is shown');
  } finally { await f.dispose(); }
});
