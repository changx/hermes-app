import test from 'node:test';
import assert from 'node:assert/strict';
import { compactFileDetail, toolDisplayLabel, toolPresentation } from '../../../packages/client/src/toolPresentation.ts';
test('read-file preview follows Discord basename and line-range rules', () => {
 assert.equal(compactFileDetail('functions.read_file', '/repo/src/tenancy.py · offset=150 · limit=110'), 'tenancy.py L150-259');
 assert.equal(compactFileDetail('read_file', 'C:\\work\\src\\file.ts · offset=1 · limit=1'), 'file.ts L1');
 assert.equal(compactFileDetail('read_file', '/repo/a/b/…'), 'Path truncated');
 assert.equal(compactFileDetail('read_file', 'Dockerfile'), 'Dockerfile');
 assert.equal(compactFileDetail('read_file', '/repo/a.ts · limit=5'), 'a.ts');
 assert.equal(toolDisplayLabel('read_file', 'Read file'), 'Reading');
 assert.equal(toolDisplayLabel('read_file', 'Custom safe summary'), 'Custom safe summary');
});
test('write/edit use capped previews; unknown tools, commands, queries remain unchanged', () => {
 const detail = '/very/long/workspace/project/folder/with/a/long/file.ts';
 for (const name of ['patch','write_file']) assert.equal(compactFileDetail(name,detail), detail.slice(0,37)+'...');
 for (const name of ['terminal','web_search','search_files','unknown']) assert.equal(compactFileDetail(name,detail),detail);
 assert.equal(compactFileDetail('read_file','https://example.com/a/b'), 'https://example.com/a/b');
 assert.ok(!compactFileDetail('write_file', '😀'.repeat(50)).includes('\ud83d...'));
});
test('action icons never infer outcomes and commands require exact tool type', () => {
 for (const [name,icon] of [['read_file','📖'],['write_file','✍️'],['web_extract','📄'],['process_manage','⚙️'],['tool_describe','📖']]) assert.equal(toolPresentation(name).icon,icon);
 assert.equal(toolPresentation('functions.terminal').command,true);
 assert.equal(toolPresentation('terminal_fake').command,false);
 assert.equal(toolPresentation('unknown').icon,'⚙️');
});
