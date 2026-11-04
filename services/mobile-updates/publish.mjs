#!/usr/bin/env node
// Publish, roll back and inspect self-hosted Expo updates for the Hermes App.
//
//   node services/mobile-updates/publish.mjs publish  --platform ios [--message TEXT] [--expect-runtime RV]
//   node services/mobile-updates/publish.mjs rollback --platform ios --runtime RV --to <updateId>
//   node services/mobile-updates/publish.mjs rollback --platform ios --runtime RV --embedded
//   node services/mobile-updates/publish.mjs list     --platform ios --runtime RV
//
// Common options (environment variables in brackets):
//   --store DIR      [MOBILE_UPDATES_STORE]   update store read by server.mjs
//   --key FILE       [MOBILE_UPDATES_KEY]     code signing private key (PEM); never commit it
//   --base-url URL   [MOBILE_UPDATES_BASE_URL] public prefix, e.g. https://hermes-app-api.tuly.space/mobile-updates
//   --project DIR    Expo project (default apps/mobile next to this script)
//
// The client loads an update only when its createdAt is newer than the running one, so
// "rollback --to" republishes the old content with a new id and createdAt.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PLATFORMS, RUNTIME_RE, UUID_RE, base64url, contentTypeFor, md5Hex, readRecord, sha256, signBody,
  storePaths, verifyBody, writeFileAtomic,
} from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function compactTime(iso) {
  return iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function copyAsset(paths, buffer, ext) {
  const name = `${sha256(buffer).toString('hex')}.${ext}`;
  const file = path.join(paths.assets, name);
  if (!fs.existsSync(file)) writeFileAtomic(file, buffer);
  return name;
}

function assetEntry({ paths, baseUrl, buffer, ext, fileExtension, contentType }) {
  const name = copyAsset(paths, buffer, ext);
  return {
    hash: base64url(sha256(buffer)),
    key: md5Hex(buffer),
    fileExtension,
    contentType,
    url: `${baseUrl}/assets/${name}`,
  };
}

/**
 * Build and store one signed update from an `expo export` output directory.
 * Returns the stored record. Pure file work: it does not run Expo.
 */
export function storeUpdate({
  exportDir, platform, runtimeVersion, expoConfig, baseUrl, storeDir, privateKey, certificate,
  message = '', gitCommit = '', now = new Date(), id = crypto.randomUUID(),
}) {
  if (!PLATFORMS.has(platform)) throw new Error(`Unsupported platform: ${platform}`);
  if (!RUNTIME_RE.test(runtimeVersion)) throw new Error(`Invalid runtime version: ${runtimeVersion}`);
  const paths = storePaths(storeDir);
  const metadata = JSON.parse(fs.readFileSync(path.join(exportDir, 'metadata.json'), 'utf8'));
  const fileMetadata = metadata.fileMetadata?.[platform];
  if (!fileMetadata?.bundle) throw new Error(`Export has no ${platform} bundle.`);

  const bundle = fs.readFileSync(path.join(exportDir, fileMetadata.bundle));
  const bundleExt = path.extname(fileMetadata.bundle).slice(1) || 'js';
  const launchAsset = assetEntry({
    paths, baseUrl, buffer: bundle, ext: bundleExt, fileExtension: '.bundle', contentType: 'application/javascript',
  });
  const assets = (fileMetadata.assets ?? []).map((asset) => {
    const buffer = fs.readFileSync(path.join(exportDir, asset.path));
    return assetEntry({
      paths, baseUrl, buffer, ext: asset.ext, fileExtension: `.${asset.ext}`, contentType: contentTypeFor(asset.ext),
    });
  });

  const createdAt = now.toISOString();
  const manifest = {
    id,
    createdAt,
    runtimeVersion,
    launchAsset,
    assets,
    metadata: {},
    extra: { expoClient: expoConfig },
  };
  return writeRecord({
    storeDir, platform, runtimeVersion, kind: 'update', id, createdAt, body: JSON.stringify(manifest),
    privateKey, certificate, message, gitCommit,
    summary: { bundle: launchAsset.url, bundleBytes: bundle.length, assets: assets.length },
  });
}

function writeRecord({
  storeDir, platform, runtimeVersion, kind, id, createdAt, body, privateKey, certificate, message, gitCommit, summary,
}) {
  const signature = signBody(body, privateKey);
  if (certificate && !verifyBody(body, signature, certificate)) {
    throw new Error('Signature does not verify with the app certificate: wrong private key.');
  }
  const record = {
    schema: 1, kind, id, createdAt, platform, runtimeVersion, message, gitCommit, summary, body, signature,
  };
  const paths = storePaths(storeDir);
  const text = `${JSON.stringify(record, null, 2)}\n`;
  writeFileAtomic(path.join(paths.releases(platform, runtimeVersion), `${compactTime(createdAt)}-${id}.json`), text);
  writeFileAtomic(paths.current(platform, runtimeVersion), text);
  return record;
}

export function listReleases({ storeDir, platform, runtimeVersion }) {
  const paths = storePaths(storeDir);
  const dir = paths.releases(platform, runtimeVersion);
  const current = readRecord(paths.current(platform, runtimeVersion));
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return files.map((name) => {
    const record = readRecord(path.join(dir, name));
    return {
      id: record.id, kind: record.kind, createdAt: record.createdAt, message: record.message,
      gitCommit: record.gitCommit, current: current?.id === record.id,
    };
  });
}

/** Make an earlier update current again, as a new update (new id and createdAt). */
export function republish({ storeDir, platform, runtimeVersion, fromId, privateKey, certificate, now = new Date() }) {
  if (!UUID_RE.test(fromId)) throw new Error(`Invalid update id: ${fromId}`);
  const paths = storePaths(storeDir);
  const dir = paths.releases(platform, runtimeVersion);
  const name = fs.readdirSync(dir).find((file) => file.endsWith(`-${fromId}.json`));
  if (!name) throw new Error(`No update ${fromId} for ${platform} ${runtimeVersion}.`);
  const old = readRecord(path.join(dir, name));
  if (old.kind !== 'update') throw new Error(`${fromId} is not an update.`);
  const manifest = JSON.parse(old.body);
  manifest.id = crypto.randomUUID();
  manifest.createdAt = now.toISOString();
  return writeRecord({
    storeDir, platform, runtimeVersion, kind: 'update', id: manifest.id, createdAt: manifest.createdAt,
    body: JSON.stringify(manifest), privateKey, certificate,
    message: `republish of ${fromId}${old.message ? `: ${old.message}` : ''}`, gitCommit: old.gitCommit,
    summary: old.summary,
  });
}

/** Tell clients of this runtime to run the update embedded in their binary. */
export function rollBackToEmbedded({ storeDir, platform, runtimeVersion, privateKey, certificate, now = new Date() }) {
  const createdAt = now.toISOString();
  const directive = { type: 'rollBackToEmbedded', parameters: { commitTime: createdAt } };
  return writeRecord({
    storeDir, platform, runtimeVersion, kind: 'rollback', id: crypto.randomUUID(), createdAt,
    body: JSON.stringify(directive), privateKey, certificate, message: 'roll back to embedded', gitCommit: '',
    summary: {},
  });
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      args._.push(arg);
    } else if (arg === '--embedded') {
      args.embedded = true;
    } else {
      args[arg.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function required(value, name) {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  const platform = args.platform ?? 'ios';
  const project = path.resolve(args.project ?? path.join(here, '..', '..', 'apps', 'mobile'));
  const storeDir = required(args.store ?? process.env.MOBILE_UPDATES_STORE, '--store');
  const keyFile = args.key ?? process.env.MOBILE_UPDATES_KEY;
  const certificate = fs.readFileSync(path.join(project, 'certs', 'certificate.pem'), 'utf8');
  const privateKey = () => fs.readFileSync(required(keyFile, '--key'), 'utf8');

  if (command === 'list') {
    const rows = listReleases({ storeDir, platform, runtimeVersion: required(args.runtime, '--runtime') });
    for (const row of rows) {
      console.log(`${row.current ? '*' : ' '} ${row.createdAt} ${row.id} ${row.kind} ${row.gitCommit.slice(0, 12)} ${row.message}`);
    }
    return;
  }

  if (command === 'rollback') {
    const runtimeVersion = required(args.runtime, '--runtime');
    const record = args.embedded
      ? rollBackToEmbedded({ storeDir, platform, runtimeVersion, privateKey: privateKey(), certificate })
      : republish({ storeDir, platform, runtimeVersion, fromId: required(args.to, '--to or --embedded'), privateKey: privateKey(), certificate });
    console.log(JSON.stringify({ id: record.id, kind: record.kind, createdAt: record.createdAt, message: record.message }));
    return;
  }

  if (command !== 'publish') throw new Error('Usage: publish | rollback | list (see header).');

  const baseUrl = required(args['base-url'] ?? process.env.MOBILE_UPDATES_BASE_URL, '--base-url').replace(/\/+$/, '');
  const key = privateKey();
  const runtimeVersion = JSON.parse(run('npx', ['expo-updates', 'runtimeversion:resolve', '--platform', platform], project)).runtimeVersion;
  if (args['expect-runtime'] && args['expect-runtime'] !== runtimeVersion) {
    throw new Error(`Runtime version is ${runtimeVersion}, expected ${args['expect-runtime']}. Build a new binary first.`);
  }
  const expoConfig = JSON.parse(run('npx', ['expo', 'config', '--type', 'public', '--json'], project));
  let gitCommit = '';
  try {
    gitCommit = run('git', ['rev-parse', 'HEAD'], project).trim();
    if (run('git', ['status', '--porcelain', '--', '.'], project).trim()) gitCommit += '-dirty';
  } catch {
    gitCommit = '';
  }
  const exportDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'mobile-update-'));
  try {
    run('npx', ['expo', 'export', '--platform', platform, '--output-dir', exportDir, '--max-workers', '2'], project);
    const record = storeUpdate({
      exportDir, platform, runtimeVersion, expoConfig, baseUrl, storeDir, privateKey: key, certificate,
      message: args.message ?? '', gitCommit,
    });
    console.log(JSON.stringify({ id: record.id, createdAt: record.createdAt, runtimeVersion, platform, gitCommit, ...record.summary }));
  } finally {
    fs.rmSync(exportDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
