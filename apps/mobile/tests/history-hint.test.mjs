import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Execute the actual production initializer, not a copied implementation.
const source = readFileSync(new URL('../src/ChatTimeline.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('ChatTimeline.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let initializer;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'historyHintText') initializer = node.initializer.getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(initializer);
const hint = (props = {}, historyHint = 'idle', rows = [{}]) => runInNewContext(initializer, {
  props: { hasOlder: false, locatingBusy: false, ...props }, historyHint, rows,
});

test('complete history has no conversation-start text or accessibility announcement', () => {
  assert.equal(hint(), '');
  assert.equal(hint({ hasOlder: true }), 'Pull down for earlier messages');
  assert.equal(hint(), ''); // transition from partial to complete history
  assert.ok(!source.includes('Start of conversation'));
  assert.match(source, /accessible=\{!!historyHintText\} accessibilityLabel=\{historyHintText \|\| undefined\}/);
});
test('release and loading hints remain available, including final loading request', () => {
  assert.equal(hint({ hasOlder: true }, 'release'), 'Release to load');
  assert.equal(hint({ hasOlder: true }, 'loading'), 'Loading history…');
  assert.equal(hint({ hasOlder: false }, 'loading'), 'Loading history…');
});
test('empty history and locating states do not show idle hints', () => {
  assert.equal(hint({ hasOlder: true }, 'idle', []), '');
  assert.equal(hint({ hasOlder: true, locatingBusy: true }), '');
  assert.equal(hint({ hasOlder: true, locatingMessage: 'Keep looking' }), '');
});
