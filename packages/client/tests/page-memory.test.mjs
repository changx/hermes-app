import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('GC: 50 page acquire/open/release cycles leave no owners, transcripts or socket fixtures', () => {
 const result = JSON.parse(execFileSync(process.execPath, ['--expose-gc', fileURLToPath(new URL('./fixtures/page-memory-probe.mjs', import.meta.url))], { encoding: 'utf8', timeout: 60000 }));
 assert.equal(result.retained_page_weakrefs, 0);
 assert.equal(result.page_instances, 100);
 assert.equal(result.sockets.active, 0);
 assert.equal(result.sockets.opened, result.sockets.closed);
 console.log('PAGE_MEMORY_PROBE', JSON.stringify(result));
});
