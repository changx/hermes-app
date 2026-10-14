import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const bundle = await build({ entryPoints: [new URL('../src/main/app-icon.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false });
const mod = { exports: {} }; new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(mod, mod.exports, require);
const { DesktopAppIcon, validAppIcon } = mod.exports;

// Real packaged images; the image factory records which file reached the Dock.
const setup = async () => {
  const folder = await mkdtemp(join(tmpdir(), 'desktop-app-icon-'));
  const images = join(folder, 'images'); await mkdir(images);
  for (const name of ['mochi', 'bubble', 'orb']) await copyFile(new URL(`../resources/app-icons/${name}.png`, import.meta.url), join(images, `${name}.png`));
  const sizes = new Map(await Promise.all(['mochi', 'bubble', 'orb'].map(async name => [(await readFile(join(images, `${name}.png`))).length, name])));
  const dock = { shown: [], setIcon(image) { this.shown.push(image.name); } };
  const factory = { fromBuffer: buffer => ({ name: sizes.get(buffer.length), isEmpty: () => buffer.length === 0 }) };
  return { folder, images, dock, factory, file: join(folder, 'user', 'app-icon.json') };
};

test('Choices are a closed list', () => {
  for (const ok of ['mochi', 'bubble', 'orb']) assert.equal(validAppIcon(ok), true);
  for (const bad of ['', 'Orb', '../orb', 'mochi.png', null, 3, {}]) assert.equal(validAppIcon(bad), false);
});

test('First start keeps the packaged default and does not touch the Dock', async () => {
  const s = await setup();
  try {
    const icon = new DesktopAppIcon(s.file, s.images, s.factory, s.dock);
    await icon.load();
    assert.deepEqual(icon.state(), { icon: 'mochi', dock: true });
    assert.deepEqual(s.dock.shown, []);
  } finally { await rm(s.folder, { recursive: true, force: true }); }
});

test('A change is saved, shown in the Dock, and applied again at the next start', async () => {
  const s = await setup();
  try {
    const icon = new DesktopAppIcon(s.file, s.images, s.factory, s.dock);
    await icon.load();
    assert.deepEqual(await icon.set('orb'), { icon: 'orb', dock: true });
    assert.deepEqual(JSON.parse(await readFile(s.file, 'utf8')), { icon: 'orb' });
    assert.deepEqual(s.dock.shown, ['orb']);
    await icon.set('mochi');
    assert.deepEqual(s.dock.shown, ['orb', 'mochi'], 'returning to Mochi shows the default image again');
    await icon.set('bubble');
    const dock = { shown: [], setIcon(image) { this.shown.push(image.name); } };
    const next = new DesktopAppIcon(s.file, s.images, s.factory, dock);
    await next.load();
    assert.deepEqual(next.state(), { icon: 'bubble', dock: true });
    assert.deepEqual(dock.shown, ['bubble']);
  } finally { await rm(s.folder, { recursive: true, force: true }); }
});

test('Unknown choices are rejected without changing the saved file or the Dock', async () => {
  const s = await setup();
  try {
    const icon = new DesktopAppIcon(s.file, s.images, s.factory, s.dock);
    await icon.set('bubble');
    await assert.rejects(icon.set('../../etc/passwd'), /Unknown app icon/);
    assert.deepEqual(JSON.parse(await readFile(s.file, 'utf8')), { icon: 'bubble' });
    assert.deepEqual(s.dock.shown, ['bubble']);
  } finally { await rm(s.folder, { recursive: true, force: true }); }
});

test('A damaged or tampered file falls back to the default', async () => {
  const s = await setup();
  try {
    await mkdir(join(s.folder, 'user'));
    for (const content of ['{', '{"icon":"../x"}', '[]', '']) {
      await writeFile(s.file, content);
      const icon = new DesktopAppIcon(s.file, s.images, s.factory, s.dock);
      await icon.load();
      assert.equal(icon.state().icon, 'mochi', content);
    }
    assert.deepEqual(s.dock.shown, []);
  } finally { await rm(s.folder, { recursive: true, force: true }); }
});

test('Without a Dock (not macOS) the choice is still saved', async () => {
  const s = await setup();
  try {
    const icon = new DesktopAppIcon(s.file, s.images, s.factory, undefined);
    assert.deepEqual(await icon.set('orb'), { icon: 'orb', dock: false });
    assert.deepEqual(JSON.parse(await readFile(s.file, 'utf8')), { icon: 'orb' });
  } finally { await rm(s.folder, { recursive: true, force: true }); }
});
