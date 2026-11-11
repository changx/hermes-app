#!/usr/bin/env node
// Publish and inspect macOS desktop updates (docs/desktop-auto-update.md).
//
//   node services/mobile-updates/desktop-publish.mjs publish --zip <Hermes-x.y.z-macOS-arm64.zip> [--sha256-file F] [--notes TEXT]
//   node services/mobile-updates/desktop-publish.mjs list
//   node services/mobile-updates/desktop-publish.mjs prune [--keep 2]
//
//   --store DIR  [MOBILE_UPDATES_STORE]  the store read by server.mjs
//
// The zip comes from scripts/macmini-desktop-release.sh: `ditto` of the signed, notarized and stapled
// Hermes.app. Publish only after the GitHub Release of the same tag is published.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listDesktop, publishDesktop, pruneDesktop } from './desktop.mjs';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    options[key.slice(2)] = rest[i + 1];
    i += 1;
  }
  return { command, options };
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const storeDir = options.store ?? process.env.MOBILE_UPDATES_STORE;
  if (!storeDir) throw new Error('--store or MOBILE_UPDATES_STORE is required.');
  if (command === 'publish') {
    if (!options.zip) throw new Error('--zip is required.');
    let expectSha256;
    if (options['sha256-file']) {
      const line = fs.readFileSync(options['sha256-file'], 'utf8').trim().split(/\s+/);
      if (path.basename(line[1] ?? '') !== path.basename(options.zip)) throw new Error('The .sha256 file names another package.');
      expectSha256 = line[0];
    }
    const record = publishDesktop({ storeDir, zip: options.zip, notes: options.notes ?? '', expectSha256 });
    console.log(JSON.stringify(record, null, 2));
    return;
  }
  if (command === 'list') {
    console.log(JSON.stringify(listDesktop({ storeDir }), null, 2));
    return;
  }
  if (command === 'prune') {
    const keep = Number(options.keep ?? 2);
    if (!Number.isInteger(keep) || keep < 1) throw new Error('--keep must be a positive integer.');
    console.log(JSON.stringify({ removed: pruneDesktop({ storeDir, keep }) }));
    return;
  }
  throw new Error('Usage: desktop-publish.mjs publish|list|prune [options]');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
