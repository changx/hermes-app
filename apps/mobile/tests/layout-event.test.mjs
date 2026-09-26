import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Execute the actual composer's callback with React-style deferred state updates.
// RN may release nativeEvent after the handler returns; no native renderer is claimed.
test('composer captures layout height before the native event is released', () => {
  const source=readFileSync(new URL('../src/ChatTimeline.tsx',import.meta.url),'utf8');
  const match=source.match(/style=\{styles\.composer\} onLayout=\{([^}]+)\}/);
  assert.ok(match,'composer handler is present');
  let height=0;
  const pending=[];
  const handler=runInNewContext('('+match[1]+')',{setComposerHeight:value=>pending.push(value)});
  for(const next of [56,96,96,56]) {
    const event={nativeEvent:{layout:{height:next}}};
    handler(event);
    event.nativeEvent=null;
    for(const update of pending.splice(0)) height=typeof update==='function'?update(height):update;
    assert.equal(height,next);
  }
});
