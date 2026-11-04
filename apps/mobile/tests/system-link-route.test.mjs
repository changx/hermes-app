import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionLink, systemLinkRoute } from '../../../packages/client/src/sessionLinks.ts';

test('a home-screen launch of the installed app opens the home page', () => {
  // Expo Router seeds the initial URL with createURL('/') when the app has no link.
  for (const root of ['hermesapp:///', 'hermesapp://', 'hermesapp:', 'HermesApp:///']) {
    assert.equal(systemLinkRoute(root), '/', root);
  }
});

test('session links open their Thread; other app-scheme paths are refused', () => {
  const link = buildSessionLink('https://agent.example', 'th_abc123');
  assert.equal(systemLinkRoute(link), '/threads/th_abc123?server=https%3A%2F%2Fagent.example');
  for (const bad of ['hermesapp:///settings', 'hermesapp://session/th_abc123', 'hermesapp://other/x', 'hermesapp:///?x=1']) {
    assert.equal(systemLinkRoute(bad), '/session-unavailable', bad);
  }
});

test('ordinary routes and Expo Go launch URLs pass through', () => {
  for (const path of ['/', '/threads/th_a', 'exp://agent.tuly.space/--/']) assert.equal(systemLinkRoute(path), path);
});
