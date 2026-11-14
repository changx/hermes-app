import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

// The Settings window may call only the channels in SETTINGS_CHANNELS (main/index.ts). A Settings
// component that calls any other channel fails at run time and its feature silently disappears.
const src = new URL('../src/', import.meta.url).pathname;
const read = path => readFileSync(join(src, path), 'utf8');
const allowed = new Set([...read('main/index.ts').match(/const SETTINGS_CHANNELS = new Set\(\[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]));
const channelOf = new Map([...read('preload/index.ts').matchAll(/^\s+(\w+):\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke\(\s*["']([^"']+)["']/gm)].map(m => [m[1], m[2]]));

/** Renderer files reachable from the Settings page by relative imports. */
function reachable(entry) {
  const seen = new Set(), queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, spec] of read(file).matchAll(/from '(\.[^']+)'/g)) {
      const base = join(dirname(file), spec);
      const next = ['.tsx', '.ts', ''].map(ext => base + ext).find(path => existsSync(join(src, path)) && !path.endsWith('/'));
      if (next && next.startsWith('renderer/')) queue.push(next);
    }
  }
  return [...seen];
}

test('every desktop API call reachable from the Settings window has an allowed channel', () => {
  assert.ok(allowed.has('desktop:get-env-keys') && channelOf.get('getEnvKeys') === 'desktop:get-env-keys', 'parsers found the lists');
  const files = reachable('renderer/settings.tsx');
  assert.ok(files.includes('renderer/connection-settings.tsx'));
  const missing = [];
  for (const file of files) for (const [, method] of read(file).matchAll(/window\.hermesDesktop\.(\w+)\(/g)) {
    const channel = channelOf.get(method);
    if (channel && !allowed.has(channel)) missing.push(`${file}: ${method} -> ${channel}`);
  }
  assert.deepEqual([...new Set(missing)], []);
});
