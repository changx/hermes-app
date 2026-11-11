#!/usr/bin/env node
// Self-hosted Expo Updates (protocol v1) server for the Hermes App iOS/Android builds.
//
// The server holds no signing key. `publish.mjs` writes signed records into the store;
// this process only reads them:
//   <store>/current/<platform>/<runtimeVersion>.json  active record (update or rollback)
//   <store>/assets/<sha256>.<ext>                      immutable, content-addressed files
//
// Routes (under /mobile-updates):
//   GET /mobile-updates/manifest        expo-updates manifest/directive request
//   GET /mobile-updates/assets/<name>   asset download
//   GET /mobile-updates/health          liveness
//
// The same process serves the macOS desktop update feed under /desktop-updates (desktop.mjs).

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleDesktop } from './desktop.mjs';
import { ASSET_NAME_RE, PLATFORMS, RUNTIME_RE, contentTypeFor, readRecord, storePaths } from './lib.mjs';

export const PREFIX = '/mobile-updates';

function commonHeaders() {
  return {
    'expo-protocol-version': '1',
    'expo-sfv-version': '0',
    'cache-control': 'private, max-age=0',
  };
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function noUpdate(res) {
  // Protocol v1: a multipart response with no parts may be a 204 with no body.
  res.writeHead(204, commonHeaders());
  res.end();
}

function multipart(res, name, body, signature) {
  const boundary = `hermes-${crypto.randomBytes(12).toString('hex')}`;
  const partHeaders = [
    `content-disposition: form-data; name="${name}"`,
    'content-type: application/json; charset=utf-8',
    `expo-signature: ${signature}`,
  ].join('\r\n');
  const payload = Buffer.from(`--${boundary}\r\n${partHeaders}\r\n\r\n${body}\r\n--${boundary}--\r\n`, 'utf8');
  res.writeHead(200, {
    ...commonHeaders(),
    'content-type': `multipart/mixed; boundary=${boundary}`,
    'content-length': payload.length,
  });
  res.end(payload);
}

function acceptKinds(accept) {
  const value = String(accept ?? '').toLowerCase();
  // A missing accept header is treated like */*.
  const any = value === '' || value.includes('*/*');
  return {
    multipart: any || value.includes('multipart/mixed'),
    json: any || value.includes('application/expo+json') || value.includes('application/json'),
  };
}

function handleManifest(req, res, paths) {
  if (req.headers['expo-protocol-version'] !== '1') {
    return sendJson(res, 400, { error: 'expo-protocol-version 1 is required.' });
  }
  const platform = req.headers['expo-platform'];
  if (!PLATFORMS.has(platform)) {
    return sendJson(res, 400, { error: 'Unsupported expo-platform.' });
  }
  const runtime = req.headers['expo-runtime-version'];
  if (typeof runtime !== 'string' || !RUNTIME_RE.test(runtime)) {
    return sendJson(res, 400, { error: 'Invalid expo-runtime-version.' });
  }
  res.locals = { platform, runtime, current: String(req.headers['expo-current-update-id'] ?? '-').slice(0, 8) };

  const record = readRecord(paths.current(platform, runtime));
  if (!record) return noUpdate(res);

  const accept = acceptKinds(req.headers.accept);
  const currentId = req.headers['expo-current-update-id'];

  if (record.kind === 'update') {
    if (typeof currentId === 'string' && currentId.toLowerCase() === record.id.toLowerCase()) {
      return noUpdate(res);
    }
    if (accept.multipart) return multipart(res, 'manifest', record.body, record.signature);
    if (accept.json) {
      const payload = Buffer.from(record.body, 'utf8');
      res.writeHead(200, {
        ...commonHeaders(),
        'content-type': 'application/expo+json',
        'expo-signature': record.signature,
        'content-length': payload.length,
      });
      return res.end(payload);
    }
    return sendJson(res, 406, { error: 'Unsupported accept header.' });
  }

  // kind === 'rollback': tell the client to run the update embedded in its binary.
  const embeddedId = req.headers['expo-embedded-update-id'];
  if (typeof currentId === 'string' && typeof embeddedId === 'string'
      && currentId.toLowerCase() === embeddedId.toLowerCase()) {
    return noUpdate(res);
  }
  if (!accept.multipart) return sendJson(res, 406, { error: 'Directives need multipart/mixed.' });
  return multipart(res, 'directive', record.body, record.signature);
}

function handleAsset(req, res, paths, name) {
  if (!ASSET_NAME_RE.test(name)) return sendJson(res, 404, { error: 'Not found.' });
  const file = path.join(paths.assets, name);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return sendJson(res, 404, { error: 'Not found.' });
  }
  res.writeHead(200, {
    'content-type': contentTypeFor(name.slice(name.lastIndexOf('.') + 1)),
    'content-length': stat.size,
    'cache-control': 'public, max-age=31536000, immutable',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

export const DEFAULT_DESKTOP_BASE_URL = 'https://hermes-app-api.tuly.space/desktop-updates';

export function createUpdatesServer({ storeDir, desktopBaseUrl = DEFAULT_DESKTOP_BASE_URL, log = () => {} }) {
  const paths = storePaths(storeDir);
  return http.createServer((req, res) => {
    const started = Date.now();
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.on('finish', () => {
      const meta = res.locals ? ` ${res.locals.platform} ${res.locals.runtime.slice(0, 12)} current=${res.locals.current}` : '';
      log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms${meta}`);
    });
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { error: 'Method not allowed.' });
      }
      if (handleDesktop(req, res, url, { storeDir, baseUrl: desktopBaseUrl })) return undefined;
      if (url.pathname === `${PREFIX}/health`) return sendJson(res, 200, { ok: true });
      if (url.pathname === `${PREFIX}/manifest`) return handleManifest(req, res, paths);
      if (url.pathname.startsWith(`${PREFIX}/assets/`)) {
        return handleAsset(req, res, paths, url.pathname.slice(`${PREFIX}/assets/`.length));
      }
      return sendJson(res, 404, { error: 'Not found.' });
    } catch (error) {
      log(`error ${url.pathname}: ${error.message}`);
      if (!res.headersSent) sendJson(res, 500, { error: 'Update service error.' });
      else res.destroy();
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const storeDir = process.env.MOBILE_UPDATES_STORE;
  const host = process.env.MOBILE_UPDATES_HOST ?? '127.0.0.1';
  const port = Number(process.env.MOBILE_UPDATES_PORT ?? 8090);
  if (!storeDir) {
    console.error('MOBILE_UPDATES_STORE is required.');
    process.exit(2);
  }
  const desktopBaseUrl = process.env.DESKTOP_UPDATES_BASE_URL ?? DEFAULT_DESKTOP_BASE_URL;
  const server = createUpdatesServer({ storeDir, desktopBaseUrl, log: (line) => console.log(line) });
  server.listen(port, host, () => console.log(`mobile-updates listening on ${host}:${port}, store ${storeDir}`));
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
