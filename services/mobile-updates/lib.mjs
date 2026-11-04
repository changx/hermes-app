// Shared helpers for the self-hosted Expo Updates (protocol v1) service.
// Spec: https://docs.expo.dev/technical-specs/expo-updates-1/
// No npm dependencies: the service and the publish tool use Node built-ins only.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PLATFORMS = new Set(['ios', 'android']);
// Fingerprint runtime versions are hex SHA-1 strings; allow manual versions too.
export const RUNTIME_RE = /^[A-Za-z0-9._-]{1,128}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Stored asset file names are content addressed: <sha256 hex>.<ext>
export const ASSET_NAME_RE = /^[0-9a-f]{64}\.[a-z0-9]{1,10}$/;

const CONTENT_TYPES = {
  js: 'application/javascript',
  hbc: 'application/javascript',
  bundle: 'application/javascript',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  html: 'text/html',
  css: 'text/css',
  txt: 'text/plain',
  wasm: 'application/wasm',
};

export function contentTypeFor(ext) {
  return CONTENT_TYPES[String(ext).toLowerCase()] ?? 'application/octet-stream';
}

export function base64url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest();
}

export function md5Hex(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

// Expo SFV dictionary with string values, e.g. sig="...", keyid="main".
export function sfvDictionary(entries) {
  return Object.entries(entries)
    .map(([key, value]) => `${key}="${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(', ');
}

export function signBody(body, privateKeyPem, keyid = 'main') {
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(body, 'utf8');
  signer.end();
  return sfvDictionary({ sig: signer.sign(privateKeyPem, 'base64'), keyid });
}

export function verifyBody(body, signatureHeader, publicKeyOrCertPem) {
  const match = /sig="([^"]+)"/.exec(signatureHeader ?? '');
  if (!match) return false;
  const key = publicKeyOrCertPem.includes('BEGIN CERTIFICATE')
    ? new crypto.X509Certificate(publicKeyOrCertPem).publicKey
    : publicKeyOrCertPem;
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(body, 'utf8');
  verifier.end();
  return verifier.verify(key, match[1], 'base64');
}

export function storePaths(storeDir) {
  return {
    assets: path.join(storeDir, 'assets'),
    releases: (platform, runtime) => path.join(storeDir, 'releases', platform, runtime),
    current: (platform, runtime) => path.join(storeDir, 'current', platform, `${runtime}.json`),
  };
}

// Write a file atomically: temp file in the same directory, then rename.
export function writeFileAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export function readRecord(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const record = JSON.parse(text);
  if (record.schema !== 1 || !['update', 'rollback'].includes(record.kind)) {
    throw new Error(`Unsupported update record: ${file}`);
  }
  if (typeof record.body !== 'string' || typeof record.signature !== 'string') {
    throw new Error(`Update record has no signed body: ${file}`);
  }
  return record;
}
