import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { compareVersions, listDesktop, parseRange, publishDesktop, pruneDesktop } from '../desktop.mjs';
import { createUpdatesServer } from '../server.mjs';

const BASE_URL = 'https://updates.example.test/desktop-updates';
let root;
let storeDir;
let server;
let base;

function zip(version, bytes) {
  const file = path.join(root, `Hermes-${version}-macOS-arm64.zip`);
  fs.writeFileSync(file, bytes);
  return file;
}

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-updates-'));
  storeDir = path.join(root, 'store');
  server = createUpdatesServer({ storeDir, desktopBaseUrl: BASE_URL });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
});

test('versions compare numerically', () => {
  assert.equal(compareVersions('0.1.10', '0.1.9'), 1);
  assert.equal(compareVersions('0.1.9', '0.1.10'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
});

test('feed: 204 before the first publication, then the newer release only', async () => {
  let response = await fetch(`${base}/desktop-updates/darwin-arm64/0.1.132`);
  assert.equal(response.status, 204);

  const bytes = crypto.randomBytes(4096);
  const record = publishDesktop({ storeDir, zip: zip('0.1.133', bytes), notes: 'Auto update', now: new Date('2026-11-10T00:00:00Z') });
  assert.equal(record.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));

  response = await fetch(`${base}/desktop-updates/darwin-arm64/0.1.132`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    url: `${BASE_URL}/files/Hermes-0.1.133-macOS-arm64.zip`, name: 'Hermes 0.1.133', notes: 'Auto update',
    pub_date: '2026-11-10T00:00:00.000Z', sha256: record.sha256, size: 4096,
  });
  for (const running of ['0.1.133', '0.1.200']) {
    assert.equal((await fetch(`${base}/desktop-updates/darwin-arm64/${running}`)).status, 204, running);
  }
  assert.equal((await fetch(`${base}/desktop-updates/darwin-x64/0.1.1`)).status, 400);
  assert.equal((await fetch(`${base}/desktop-updates/darwin-arm64/latest`)).status, 400);
});

test('package download: whole file, byte ranges, If-Range and HEAD', async () => {
  const url = `${base}/desktop-updates/files/Hermes-0.1.133-macOS-arm64.zip`;
  const stored = fs.readFileSync(path.join(storeDir, 'desktop/files/Hermes-0.1.133-macOS-arm64.zip'));
  let response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(response.headers.get('content-type'), 'application/zip');
  const etag = response.headers.get('etag');
  assert.ok(etag && response.headers.get('last-modified'));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), stored);

  response = await fetch(url, { headers: { range: 'bytes=1000-' , 'if-range': etag } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), `bytes 1000-4095/4096`);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), stored.subarray(1000));

  // A changed validator restarts the download from the beginning.
  response = await fetch(url, { headers: { range: 'bytes=1000-', 'if-range': '"other"' } });
  assert.equal(response.status, 200);
  assert.equal((await response.arrayBuffer()).byteLength, 4096);

  response = await fetch(url, { headers: { range: 'bytes=5000-' } });
  assert.equal(response.status, 416);
  await response.arrayBuffer();

  response = await fetch(url, { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-length'), '4096');

  for (const name of ['../current/darwin-arm64.json', 'Hermes-0.1.133-macOS-arm64.dmg', '%2e%2e%2fkeys']) {
    assert.equal((await fetch(`${base}/desktop-updates/files/${name}`)).status, 404, name);
  }
});

test('range parsing', () => {
  assert.deepEqual(parseRange('bytes=0-9', 100), { start: 0, end: 9 });
  assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=90-500', 100), { start: 90, end: 99 });
  assert.equal(parseRange('bytes=100-', 100), 'unsatisfiable');
  assert.equal(parseRange('bytes=0-1,5-6', 100), null);
  assert.equal(parseRange(undefined, 100), null);
});

test('publish refuses an older or repeated version, a wrong name and a wrong checksum', () => {
  assert.throws(() => publishDesktop({ storeDir, zip: zip('0.1.133', Buffer.from('x')) }), /not newer/);
  assert.throws(() => publishDesktop({ storeDir, zip: zip('0.1.100', Buffer.from('x')) }), /not newer/);
  const other = path.join(root, 'Hermes.zip');
  fs.writeFileSync(other, 'x');
  assert.throws(() => publishDesktop({ storeDir, zip: other }), /Package name/);
  assert.throws(() => publishDesktop({ storeDir, zip: zip('0.1.134', Buffer.from('x')), expectSha256: '0'.repeat(64) }), /SHA-256 mismatch/);
  assert.equal(fs.existsSync(path.join(storeDir, 'desktop/files/Hermes-0.1.134-macOS-arm64.zip')), false);
  assert.equal(listDesktop({ storeDir }).current, '0.1.133');
});

test('prune keeps the newest packages and the current one; the iOS routes still answer', async () => {
  publishDesktop({ storeDir, zip: zip('0.1.134', Buffer.from('b')) });
  publishDesktop({ storeDir, zip: zip('0.1.135', Buffer.from('c')) });
  assert.deepEqual(listDesktop({ storeDir }), { current: '0.1.135', versions: ['0.1.135', '0.1.134', '0.1.133'] });
  assert.deepEqual(pruneDesktop({ storeDir, keep: 2 }), ['Hermes-0.1.133-macOS-arm64.zip']);
  assert.deepEqual(fs.readdirSync(path.join(storeDir, 'desktop/files')).sort(), ['Hermes-0.1.134-macOS-arm64.zip', 'Hermes-0.1.135-macOS-arm64.zip']);
  assert.equal((await fetch(`${base}/mobile-updates/health`)).status, 200);
  assert.equal((await fetch(`${base}/desktop-updates/health`)).status, 200);
});
