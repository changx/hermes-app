import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: [new URL('../src/main/draft-presence.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false });
const mod = { exports: {} }; new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports);
const { updateDraftPresence } = mod.exports;

test('typing: only a change of draft presence asks for a new snapshot', () => {
  const threads = new Set();
  const publishes = ['h', 'he', 'hel', 'hello', '   ', '', 'x'].map(text => updateDraftPresence(threads, 'th_1', { text, attachments: [] }));
  assert.deepEqual(publishes, [true, false, false, false, true, false, true]);
  assert.equal(updateDraftPresence(threads, 'th_2', { text: '', attachments: [{ id: 'att_1' }] }), true);
  assert.deepEqual([...threads], ['th_1', 'th_2']);
  assert.equal(updateDraftPresence(threads, 'th_2', null), true);
  assert.deepEqual([...threads], ['th_1']);
});
