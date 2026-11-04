import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { verifyBody } from '../lib.mjs';
import { listReleases, republish, rollBackToEmbedded, storeUpdate } from '../publish.mjs';
import { createUpdatesServer } from '../server.mjs';

const RUNTIME = 'b32a4b59c09764da6bb60618bb3513d46fe43d86';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE = privateKey.export({ type: 'pkcs8', format: 'pem' });
const PUBLIC = publicKey.export({ type: 'spki', format: 'pem' });

let root;
let storeDir;
let exportDir;
let server;
let base;

function makeExport(dir, bundleText) {
  fs.mkdirSync(path.join(dir, '_expo/static/js/ios'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, '_expo/static/js/ios/entry-abc.hbc'), bundleText);
  fs.writeFileSync(path.join(dir, 'assets/0123abcd'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({
    version: 0,
    bundler: 'metro',
    fileMetadata: {
      ios: { bundle: '_expo/static/js/ios/entry-abc.hbc', assets: [{ path: 'assets/0123abcd', ext: 'png' }] },
    },
  }));
}

function manifestHeaders(extra = {}) {
  return {
    'expo-protocol-version': '1',
    'expo-platform': 'ios',
    'expo-runtime-version': RUNTIME,
    accept: 'application/expo+json;q=0.9, application/json;q=0.8, multipart/mixed',
    'expo-expect-signature': 'sig, keyid="main", alg="rsa-v1_5-sha256"',
    ...extra,
  };
}

function parseMultipart(response, text) {
  const boundary = /boundary=([^;]+)/.exec(response.headers.get('content-type'))[1];
  const parts = text.split(`--${boundary}`).slice(1, -1);
  return parts.map((part) => {
    const [head, ...rest] = part.replace(/^\r\n/, '').split('\r\n\r\n');
    const headers = Object.fromEntries(head.split('\r\n').map((line) => {
      const index = line.indexOf(':');
      return [line.slice(0, index).toLowerCase(), line.slice(index + 1).trim()];
    }));
    return { headers, body: rest.join('\r\n\r\n').replace(/\r\n$/, '') };
  });
}

before(async () => {
  root = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'mobile-updates-test-'));
  storeDir = path.join(root, 'store');
  exportDir = path.join(root, 'export');
  makeExport(exportDir, 'console.log("v1")');
  server = createUpdatesServer({ storeDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/mobile-updates`;
});

after(() => {
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('no current update returns 204 with protocol headers', async () => {
  const response = await fetch(`${base}/manifest`, { headers: manifestHeaders() });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('expo-protocol-version'), '1');
  assert.equal(response.headers.get('expo-sfv-version'), '0');
});

test('invalid requests are rejected', async () => {
  for (const extra of [
    { 'expo-protocol-version': '0' },
    { 'expo-platform': 'web' },
    { 'expo-runtime-version': '../../etc' },
  ]) {
    const response = await fetch(`${base}/manifest`, { headers: manifestHeaders(extra) });
    assert.equal(response.status, 400, JSON.stringify(extra));
  }
  assert.equal((await fetch(`${base}/manifest`, { method: 'POST', headers: manifestHeaders() })).status, 405);
  assert.equal((await fetch(`${base}/assets/..%2F..%2Fcurrent`)).status, 404);
  assert.equal((await fetch(`${base}/assets/${'0'.repeat(64)}.png`)).status, 404);
  assert.equal((await fetch(`${base.replace('/mobile-updates', '')}/other`)).status, 404);
});

let firstId;

test('published update is served as a signed multipart manifest', async () => {
  const record = storeUpdate({
    exportDir, platform: 'ios', runtimeVersion: RUNTIME, expoConfig: { name: 'Hermes App', slug: 'x' },
    baseUrl: `${base}`, storeDir, privateKey: PRIVATE, certificate: PUBLIC, message: 'first', gitCommit: 'abc',
    now: new Date('2026-11-03T10:00:00.000Z'),
  });
  firstId = record.id;
  const response = await fetch(`${base}/manifest`, { headers: manifestHeaders() });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, max-age=0');
  const parts = parseMultipart(response, await response.text());
  assert.equal(parts.length, 1);
  assert.match(parts[0].headers['content-disposition'], /name="manifest"/);
  assert.ok(verifyBody(parts[0].body, parts[0].headers['expo-signature'], PUBLIC), 'signature verifies');
  assert.match(parts[0].headers['expo-signature'], /keyid="main"/);

  const manifest = JSON.parse(parts[0].body);
  assert.equal(manifest.id, firstId);
  assert.equal(manifest.runtimeVersion, RUNTIME);
  assert.equal(manifest.createdAt, '2026-11-03T10:00:00.000Z');
  assert.equal(manifest.extra.expoClient.name, 'Hermes App');
  assert.equal(manifest.launchAsset.contentType, 'application/javascript');
  assert.equal(manifest.assets[0].contentType, 'image/png');
  assert.equal(manifest.assets[0].fileExtension, '.png');

  // Each asset downloads with the advertised SHA-256 (base64url) and type.
  for (const asset of [manifest.launchAsset, ...manifest.assets]) {
    const download = await fetch(asset.url);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('cache-control'), /immutable/);
    assert.equal(download.headers.get('content-type'), asset.contentType);
    const bytes = Buffer.from(await download.arrayBuffer());
    const hash = crypto.createHash('sha256').update(bytes).digest('base64url');
    assert.equal(hash, asset.hash);
    assert.equal(crypto.createHash('md5').update(bytes).digest('hex'), asset.key);
  }
});

test('client that already runs the current update gets 204', async () => {
  const response = await fetch(`${base}/manifest`, { headers: manifestHeaders({ 'expo-current-update-id': firstId.toUpperCase() }) });
  assert.equal(response.status, 204);
});

test('json-only clients get the manifest body with the signature header', async () => {
  const response = await fetch(`${base}/manifest`, { headers: manifestHeaders({ accept: 'application/expo+json' }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/expo+json');
  const body = await response.text();
  assert.ok(verifyBody(body, response.headers.get('expo-signature'), PUBLIC));
});

test('a wrong private key is refused before anything is written', () => {
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  const before = listReleases({ storeDir, platform: 'ios', runtimeVersion: RUNTIME }).length;
  assert.throws(() => storeUpdate({
    exportDir, platform: 'ios', runtimeVersion: RUNTIME, expoConfig: {}, baseUrl: base, storeDir,
    privateKey: other, certificate: PUBLIC,
  }), /wrong private key/);
  assert.equal(listReleases({ storeDir, platform: 'ios', runtimeVersion: RUNTIME }).length, before);
});

test('a new update replaces the old one; republish makes old content newest again', async () => {
  const second = path.join(root, 'export2');
  makeExport(second, 'console.log("v2")');
  const v2 = storeUpdate({
    exportDir: second, platform: 'ios', runtimeVersion: RUNTIME, expoConfig: {}, baseUrl: base, storeDir,
    privateKey: PRIVATE, certificate: PUBLIC, message: 'second', now: new Date('2026-11-03T11:00:00.000Z'),
  });
  let manifest = JSON.parse(parseMultipart(...await (async () => {
    const r = await fetch(`${base}/manifest`, { headers: manifestHeaders() });
    return [r, await r.text()];
  })())[0].body);
  assert.equal(manifest.id, v2.id);

  const again = republish({
    storeDir, platform: 'ios', runtimeVersion: RUNTIME, fromId: firstId, privateKey: PRIVATE, certificate: PUBLIC,
    now: new Date('2026-11-03T12:00:00.000Z'),
  });
  const response = await fetch(`${base}/manifest`, { headers: manifestHeaders() });
  const part = parseMultipart(response, await response.text())[0];
  assert.ok(verifyBody(part.body, part.headers['expo-signature'], PUBLIC));
  manifest = JSON.parse(part.body);
  assert.equal(manifest.id, again.id);
  assert.notEqual(manifest.id, firstId);
  assert.equal(manifest.createdAt, '2026-11-03T12:00:00.000Z');
  const releaseDir = path.join(storeDir, 'releases/ios', RUNTIME);
  const firstFile = fs.readdirSync(releaseDir).find((name) => name.endsWith(`-${firstId}.json`));
  const firstManifest = JSON.parse(JSON.parse(fs.readFileSync(path.join(releaseDir, firstFile), 'utf8')).body);
  assert.equal(manifest.launchAsset.hash, firstManifest.launchAsset.hash);

  const rows = listReleases({ storeDir, platform: 'ios', runtimeVersion: RUNTIME });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.current), [false, false, true]);
});

test('roll back to embedded sends a signed directive unless the client already runs embedded', async () => {
  rollBackToEmbedded({ storeDir, platform: 'ios', runtimeVersion: RUNTIME, privateKey: PRIVATE, certificate: PUBLIC });
  const response = await fetch(`${base}/manifest`, {
    headers: manifestHeaders({ 'expo-current-update-id': firstId, 'expo-embedded-update-id': crypto.randomUUID() }),
  });
  assert.equal(response.status, 200);
  const part = parseMultipart(response, await response.text())[0];
  assert.match(part.headers['content-disposition'], /name="directive"/);
  assert.ok(verifyBody(part.body, part.headers['expo-signature'], PUBLIC));
  assert.equal(JSON.parse(part.body).type, 'rollBackToEmbedded');

  const embedded = crypto.randomUUID();
  const same = await fetch(`${base}/manifest`, {
    headers: manifestHeaders({ 'expo-current-update-id': embedded, 'expo-embedded-update-id': embedded }),
  });
  assert.equal(same.status, 204);
});

test('health route answers', async () => {
  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});
