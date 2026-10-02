import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('desktop removes read-position accounting from renderer, bridge and service', async () => {
  for (const path of ['src/main/connection-service.ts','src/main/index.ts','src/preload/index.ts','src/renderer/shell.tsx','src/shared/desktop-api.ts']) {
    const source=await readFile(new URL('../'+path,import.meta.url),'utf8');
    assert.doesNotMatch(source,/markVisible|markRead|desktop:mark-visible|unreadCount/,path);
  }
});
test('desktop navigation has running and shared completed-unread status, not counts',async()=>{
  const source=await readFile(new URL('../src/renderer/navigation-panel.tsx',import.meta.url),'utf8');
  assert.match(source,/running/);assert.doesNotMatch(source,/unreadCount|unread_count/);
  assert.match(source,/thread\.completedUnread/);
  assert.match(source,/Completed · Unread/);
});
