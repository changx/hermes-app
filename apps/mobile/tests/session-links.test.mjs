import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as links from '../../../packages/client/src/sessionLinks.ts';
import { parseMessageMarkdown } from '../src/messageMarkdown.ts';
import { routeId } from '../src/routeId.ts';
const server = 'https://agent.tuly.space';
const url = links.buildSessionLink(server, 'th_target');
const load = (path, modules) => {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText, { exports, require: key => { assert.ok(key in modules, key); return modules[key]; } });
  return exports;
};
test('shared session links round-trip stable thread and paired server with no credential fields', () => {
  assert.deepEqual(links.parseSessionLink(url), { threadId: 'th_target', server });
  assert.equal(links.buildSessionLink(server + '/', 'th_target'), url);
  assert.equal(links.sessionServer('http://127.0.0.1:8765'), 'http://127.0.0.1:8765');
  assert.equal(links.sessionLinkRoute(url), '/threads/th_target?server=https%3A%2F%2Fagent.tuly.space');
});
test('malformed, foreign schemas, credentials, arbitrary fields, physical session IDs and traversal fail closed', () => {
  for (const bad of [url + '&token=hidden', url + '&server=other', url + '#x', url.replace('th_target', '20261002_184814_fa5d7246'), url.replace('th_target', 'bad/../th_target'), url.replace('th_target', 'th_x/../th_target'), url.replace('th_target', '%74h_target'), url.replace('session/', 'evil/'), url.replace('hermesapp:', 'javascript:'), url.replace('https%3A%2F%2Fagent.tuly.space', encodeURIComponent('https://user:secret@agent.tuly.space')), url.replace('https%3A%2F%2Fagent.tuly.space', encodeURIComponent('http://remote.test')), url + '\n', url.replace('th_target', 'th_\u202etarget')]) assert.equal(links.parseSessionLink(bad), null, bad);
});
test('native external intent rewrites only strict session URLs and retains normal Expo Go routes', () => {
  const { redirectSystemPath } = load('../src/app/+native-intent.tsx', { '../../../../packages/client/src/sessionLinks': links });
  for (const initial of [false, true]) assert.equal(redirectSystemPath({ path: url, initial }), links.sessionLinkRoute(url));
  assert.equal(redirectSystemPath({ path: 'hermesapp://session/invalid', initial: true }), '/session-unavailable');
  assert.equal(redirectSystemPath({ path: 'exps://agent.tuly.space/--/channels/p_one', initial: true }), 'exps://agent.tuly.space/--/channels/p_one');
});
test('mobile route waits for credentials, blocks wrong server without mounting a conversation, then opens the exact target', () => {
  let state = { ready: false, config: null }, params = { threadId: 'th_target', server };
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) };
  const { default: Route } = load('../src/app/threads/[threadId].tsx', { react, 'expo-router': { useLocalSearchParams: () => params }, 'react-native-safe-area-context': { SafeAreaView: 'SafeArea' }, '../../App': { Notice: 'Notice', ThreadScreen: 'Thread', useApp: () => state }, '../../routeId': { routeId }, '../../../../../packages/client/src/sessionLinks': links });
  assert.equal(Route().type, 'Notice');
  state = { ready: true, config: { baseUrl: 'https://other.test' } }; assert.equal(Route().type, 'Notice');
  assert.match(Route().props.text, /another Hermes/);
  state = { ready: true, config: { baseUrl: server } };
  assert.equal(Route().props.children[0].props.threadId, 'th_target');
  params = { threadId: 'th_target', server: [server] }; assert.equal(Route().type, 'Notice');
});
test('mobile Markdown accepts named and bare links but never loads session links as images', () => {
  for (const text of [`[Open](${url})`, `Open ${url}.`]) {
    const body = parseMessageMarkdown(text);
    assert.equal(body[0].children.find(n => n.kind === 'link')?.href, url);
  }
  const image = parseMessageMarkdown(`![image](${url})`)[0].children.find(n => n.kind === 'image');
  assert.equal(image.src, null);
  assert.equal(parseMessageMarkdown('`' + url + '`')[0].children[0].kind, 'code');
});
