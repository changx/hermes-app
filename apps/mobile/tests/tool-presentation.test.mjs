import test from 'node:test';
import assert from 'node:assert/strict';
import { compactFileDetail, compactToolCaption, toolDisplayLabel, toolPresentation } from '../../../packages/client/src/toolPresentation.ts';
test('read-file preview follows Discord basename and line-range rules', () => {
 assert.equal(compactFileDetail('functions.read_file', '/repo/src/tenancy.py · offset=150 · limit=110'), 'tenancy.py L150-259');
 assert.equal(compactFileDetail('read_file', 'C:\\work\\src\\file.ts · offset=1 · limit=1'), 'file.ts L1');
 assert.equal(compactFileDetail('read_file', '/repo/a/b/…'), 'Path truncated');
 assert.equal(compactFileDetail('read_file', 'Dockerfile'), 'Dockerfile');
 assert.equal(compactFileDetail('read_file', '/repo/a.ts · limit=5'), 'a.ts');
 assert.equal(toolDisplayLabel('read_file', 'Read file'), 'Reading');
 assert.equal(toolDisplayLabel('read_file', 'Custom safe summary'), 'Custom safe summary');
});
test('write/edit show basenames; unknown tools, commands, queries remain unchanged', () => {
 const detail = '/very/long/workspace/project/folder/with/a/long/file.ts';
 for (const name of ['patch','write_file']) assert.equal(compactFileDetail(name,detail), 'file.ts');
 for (const name of ['terminal','web_search','search_files','unknown']) assert.equal(compactFileDetail(name,detail),detail);
 assert.equal(compactFileDetail('read_file','https://example.com/a/b'), 'https://example.com/a/b');
 assert.ok(!compactFileDetail('write_file', '😀'.repeat(50)).includes('\ud83d...'));
});
test('direct, V4A and legacy file summaries have consistent compact captions', () => {
 for (const name of ['patch', 'functions.patch', 'write_file', 'functions.write_file']) {
  const verb = name.endsWith('patch') ? 'Editing' : 'Writing';
  const label = name.endsWith('patch') ? 'Edit file' : 'Write file';
  for (const detail of ['/opt/project/src/EditorScreens.tsx', 'path=/opt/project/src/EditorScreens.tsx']) {
   assert.equal(compactToolCaption(name, label, detail, `${verb} path=/opt/project/s...`), `${verb} EditorScreens.tsx`);
  }
 }
 assert.equal(compactToolCaption('patch', 'Edit file', 'path=/repo/a.ts · path=C:\\work\\b.ts · …', 'Editing path=/repo/a.ts...'), 'Editing a.ts · b.ts · …');
 assert.equal(compactFileDetail('patch', '/repo/a.ts · /repo/b.ts'), 'a.ts · b.ts');
 assert.equal(compactFileDetail('patch', 'path=/repo/频道/说明.md · mode=replace · old_string=PRIVATE'), '说明.md');
 assert.equal(compactFileDetail('patch', 'path=/repo/truncated…'), 'Path truncated');
 assert.equal(compactFileDetail('patch', 'path=/repo/truncated...'), 'Path truncated');
 assert.equal(compactFileDetail('patch', '{"path":"/repo/a.ts","old_string":"PRIVATE"}'), '');
 assert.equal(compactToolCaption('patch', 'Edit file', 'mode=replace · old_string=PRIVATE', 'Editing mode=replace'), 'Editing');
 assert.equal(compactToolCaption('patch', 'Edit file', undefined, 'Editing'), 'Editing');
 assert.equal(compactToolCaption('read_file', 'Read file', 'path=/repo/a.ts · offset=10 · limit=3', 'Reading stale...'), 'Reading a.ts L10-12');
 assert.equal(compactToolCaption('web_search', 'Search web', 'query=something', 'Searching something'), 'Searching something');
 assert.equal(compactToolCaption('terminal', 'Run command', 'pwd', 'terminal'), 'terminal');
 assert.equal(compactToolCaption('terminal', 'Run command', 'pwd'), 'terminal');
 const long = compactFileDetail('patch', 'path=/repo/' + '😀'.repeat(50));
 assert.equal(Array.from(long).length, 40);
 assert.ok(!long.includes('\ud83d...'));
});
test('action icons never infer outcomes and commands require exact tool type', () => {
 for (const [name,icon] of [['read_file','📖'],['write_file','✍️'],['web_extract','📄'],['process_manage','⚙️'],['tool_describe','📖']]) assert.equal(toolPresentation(name).icon,icon);
 assert.equal(toolPresentation('functions.terminal').command,true);
 assert.equal(toolPresentation('terminal_fake').command,false);
 assert.equal(toolPresentation('unknown').icon,'⚙️');
});
