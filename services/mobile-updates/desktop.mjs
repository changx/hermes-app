// Desktop (macOS) update feed for Electron's built-in autoUpdater (Squirrel.Mac, server mode).
// See docs/desktop-auto-update.md.
//
// Store layout (under <store>/desktop):
//   files/Hermes-<version>-macOS-<arch>.zip   immutable update packages (signed, notarized app)
//   current/darwin-<arch>.json                active release record
//   releases/darwin-<arch>/<version>.json     every published record
//
// Routes:
//   GET /desktop-updates/darwin-<arch>/<running version>   204 (no update) or 200 JSON for Squirrel.Mac
//   GET /desktop-updates/files/<zip name>                  the package; Range and ETag for resumed downloads
//
// Squirrel.Mac checks that the downloaded app satisfies the code signature requirement of the running
// app, and the sha256/size in the feed entry, before it installs anything. The feed itself is unsigned.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { writeFileAtomic } from './lib.mjs';

export const DESKTOP_PREFIX = '/desktop-updates';
export const DESKTOP_ARCHES = new Set(['arm64']);
export const VERSION_RE = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
export const ZIP_NAME_RE = /^Hermes-(\d{1,6}\.\d{1,6}\.\d{1,6})-macOS-(arm64)\.zip$/;

export function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}

export function desktopPaths(storeDir) {
  const root = path.join(storeDir, 'desktop');
  return {
    files: path.join(root, 'files'),
    current: (arch) => path.join(root, 'current', `darwin-${arch}.json`),
    releases: (arch) => path.join(root, 'releases', `darwin-${arch}`),
  };
}

export function readDesktopRecord(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const record = JSON.parse(text);
  if (record.schema !== 1 || !VERSION_RE.test(record.version) || !ZIP_NAME_RE.test(record.file)
      || !/^[0-9a-f]{64}$/.test(record.sha256) || !Number.isSafeInteger(record.size)) {
    throw new Error(`Unsupported desktop update record: ${file}`);
  }
  return record;
}

function json(res, status, value, cache = 'no-store') {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': cache });
  res.end(body);
}

function feed(req, res, paths, baseUrl, arch, running) {
  if (!DESKTOP_ARCHES.has(arch) || !VERSION_RE.test(running)) return json(res, 400, { error: 'Invalid platform or version.' });
  res.locals = { platform: `darwin-${arch}`, runtime: running, current: running };
  const record = readDesktopRecord(paths.current(arch));
  if (!record || compareVersions(record.version, running) <= 0) {
    res.writeHead(204, { 'cache-control': 'no-store' });
    return res.end();
  }
  return json(res, 200, {
    url: `${baseUrl}/files/${record.file}`,
    name: `Hermes ${record.version}`,
    notes: record.notes ?? '',
    pub_date: record.pub_date,
    sha256: record.sha256,
    size: record.size,
  });
}

// One byte range ("bytes=a-b", "bytes=a-", "bytes=-n"); anything else is answered with the whole file.
export function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? '').trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  let start;
  let end;
  if (match[1] === '') {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start > end || start >= size) return 'unsatisfiable';
  return { start, end };
}

function file(req, res, paths, name) {
  if (!ZIP_NAME_RE.test(name)) return json(res, 404, { error: 'Not found.' });
  const full = path.join(paths.files, name);
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    return json(res, 404, { error: 'Not found.' });
  }
  // Files never change after publication, so name + size + mtime is a strong validator.
  const etag = `"${crypto.createHash('sha256').update(`${name}:${stat.size}:${stat.mtimeMs}`).digest('hex').slice(0, 32)}"`;
  const headers = {
    'content-type': 'application/zip',
    'accept-ranges': 'bytes',
    etag,
    'last-modified': stat.mtime.toUTCString(),
    'cache-control': 'public, max-age=31536000, immutable',
  };
  const ifRange = req.headers['if-range'];
  const range = ifRange && ifRange !== etag && ifRange !== headers['last-modified'] ? null : parseRange(req.headers.range, stat.size);
  if (range === 'unsatisfiable') {
    res.writeHead(416, { ...headers, 'content-range': `bytes */${stat.size}` });
    return res.end();
  }
  const { start, end } = range ?? { start: 0, end: stat.size - 1 };
  res.writeHead(range ? 206 : 200, {
    ...headers,
    'content-length': end - start + 1,
    ...(range ? { 'content-range': `bytes ${start}-${end}/${stat.size}` } : {}),
  });
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(full, { start, end }).on('error', () => res.destroy()).pipe(res);
}

/** Handles /desktop-updates/* requests; returns false for other paths. */
export function handleDesktop(req, res, url, { storeDir, baseUrl }) {
  if (!url.pathname.startsWith(`${DESKTOP_PREFIX}/`)) return false;
  const paths = desktopPaths(storeDir);
  const rest = url.pathname.slice(DESKTOP_PREFIX.length + 1);
  if (rest === 'health') {
    json(res, 200, { ok: true });
    return true;
  }
  if (rest.startsWith('files/')) {
    file(req, res, paths, rest.slice('files/'.length));
    return true;
  }
  const match = /^darwin-([a-z0-9]+)\/([^/]+)$/.exec(rest);
  if (match) {
    feed(req, res, paths, baseUrl, match[1], match[2]);
    return true;
  }
  json(res, 404, { error: 'Not found.' });
  return true;
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1 << 20);
    let read;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

/**
 * Copies a release zip into the store and makes it the current desktop update.
 * `expectSha256` (from the build's .sha256 file) must match the copied bytes.
 */
export function publishDesktop({ storeDir, zip, notes = '', expectSha256, now = new Date() }) {
  const name = path.basename(zip);
  const match = ZIP_NAME_RE.exec(name);
  if (!match) throw new Error(`Package name must look like Hermes-<x.y.z>-macOS-arm64.zip: ${name}`);
  const [, version, arch] = match;
  const paths = desktopPaths(storeDir);
  const current = readDesktopRecord(paths.current(arch));
  if (current && compareVersions(version, current.version) <= 0) {
    throw new Error(`Version ${version} is not newer than the current update ${current.version}.`);
  }
  fs.mkdirSync(paths.files, { recursive: true });
  const target = path.join(paths.files, name);
  if (fs.existsSync(target)) throw new Error(`${name} is already in the store; published packages never change.`);
  const tmp = `${target}.tmp-${process.pid}`;
  fs.copyFileSync(zip, tmp);
  const sha256 = sha256File(tmp);
  if (expectSha256 && expectSha256 !== sha256) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`SHA-256 mismatch for ${name}: expected ${expectSha256}, got ${sha256}.`);
  }
  fs.chmodSync(tmp, 0o644);
  fs.renameSync(tmp, target);
  const record = {
    schema: 1, version, arch, file: name, sha256, size: fs.statSync(target).size,
    notes: String(notes), pub_date: now.toISOString(),
  };
  const text = `${JSON.stringify(record, null, 2)}\n`;
  writeFileAtomic(path.join(paths.releases(arch), `${version}.json`), text);
  writeFileAtomic(paths.current(arch), text);
  return record;
}

export function listDesktop({ storeDir, arch = 'arm64' }) {
  const paths = desktopPaths(storeDir);
  const current = readDesktopRecord(paths.current(arch));
  let versions = [];
  try {
    versions = fs.readdirSync(paths.releases(arch)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  versions = versions.filter((v) => VERSION_RE.test(v)).sort(compareVersions).reverse();
  return { current: current?.version ?? null, versions };
}

/** Deletes package files older than the newest `keep`; the current package is always kept. Records stay. */
export function pruneDesktop({ storeDir, keep = 2 }) {
  const paths = desktopPaths(storeDir);
  let names = [];
  try {
    names = fs.readdirSync(paths.files).filter((n) => ZIP_NAME_RE.test(n));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const currents = new Set([...DESKTOP_ARCHES].map((a) => readDesktopRecord(paths.current(a))?.file).filter(Boolean));
  const sorted = names.sort((a, b) => compareVersions(ZIP_NAME_RE.exec(b)[1], ZIP_NAME_RE.exec(a)[1]));
  const removed = [];
  for (const name of sorted.slice(keep)) {
    if (currents.has(name)) continue;
    fs.rmSync(path.join(paths.files, name), { force: true });
    removed.push(name);
  }
  return removed;
}
