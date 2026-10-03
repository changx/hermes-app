import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import vm from 'node:vm';
import { reconciledSendNotice } from '../src/sendNotice.ts';

const mobile = fileURLToPath(new URL('..', import.meta.url));
const cjk = /[\u3400-\u9fff]/u;

// Check product-owned literals, not comments, regexes or user/model data.
// The generated offline renderer bundles third-party libraries and is excluded.
test('all built-in mobile strings and HTML templates use English', () => {
  const failures = [];
  for (const name of readdirSync(path.join(mobile, 'src'))) {
    if (!/\.tsx?$/.test(name) || name.endsWith('.generated.ts')) continue;
    const text = readFileSync(path.join(mobile, 'src', name), 'utf8');
    const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
    const visit = node => {
      if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) ||
           ts.isTemplateTail(node) || ts.isJsxText(node)) && cjk.test(node.text)) {
        failures.push(`${name}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${node.text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(failures, []);
});

test('classified send notices retain their actual meaning and pairing state remains scoped', () => {
  const source = ts.createSourceFile('App.tsx', readFileSync(path.join(mobile, 'src/App.tsx'), 'utf8'), ts.ScriptTarget.Latest, true);
  let pairing;
  const visit = node => {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'onStatus') pairing = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(pairing);
  const states = [];
  const context = vm.createContext({ active: true, setPairingStatus: value => states.push(value) });
  vm.runInContext(ts.transpileModule(`globalThis.status = ${pairing.getText(source)};`, {}).outputText, context);
  const outbox = readFileSync(path.join(mobile, 'src/outbox.ts'), 'utf8');
  const actualNotice = outbox.match(/this\.emit\('([^']*connection permissions[^']*)'\)/)?.[1];
  assert.ok(actualNotice);
  assert.equal(reconciledSendNotice('', [], actualNotice), actualNotice);
  const storageNotice = 'Your message was received, but its status could not be saved on this device. Keep your app data.';
  assert.equal(reconciledSendNotice('', [], storageNotice), storageNotice);
  const cleanupNotice = 'A received message could not be cleared from this device. Keep your app data.';
  assert.equal(reconciledSendNotice('', [], cleanupNotice), cleanupNotice);
  const pairingSource = readFileSync(path.join(mobile, 'src/pairing.ts'), 'utf8');
  const actualStates = [...new Set(pairingSource.match(/(?:Waiting for a connection\.[^']*|Connecting securely…)/g))];
  assert.equal(actualStates.length, 2);
  for (const status of actualStates) context.status(status);
  assert.deepEqual(states, actualStates);
  context.active = false;
  context.status('Ignored after closing');
  assert.deepEqual(states, actualStates);
});

test('the app display name is English without changing its connection identity', () => {
  const { expo } = JSON.parse(readFileSync(path.join(mobile, 'app.json'), 'utf8'));
  assert.equal(expo.name, 'Hermes App');
  assert.equal(expo.scheme, 'hermesapp');
  assert.equal(expo.ios.bundleIdentifier, 'space.tuly.hermesapp.dev');
  assert.equal(expo.android.package, 'space.tuly.hermesapp.dev');
});
