import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionLink, isSessionLinkHref, parseSessionLink, relativeSessionThread, resolveSessionLink, sessionLinksInText } from '../../../packages/client/src/sessionLinks.ts';
import { safeLinkUrl } from '../src/messageMarkdown.ts';

const server = 'https://agent.example';

test('short session links name a Thread only; the full form keeps its strict rules', () => {
  assert.equal(relativeSessionThread('hermesapp://session/th_abc123'), 'th_abc123');
  for (const bad of ['hermesapp://session/th_abc123?x=1', 'hermesapp://session/abc', 'hermesapp://session/th_a/b',
    'hermesapp://session/th_a#x', 'hermesapp://other/th_abc', 'hermesapp://session/th_a c']) {
    assert.equal(relativeSessionThread(bad), null, bad);
  }
  // External entries still need the server: the strict parser rejects the short form.
  assert.equal(parseSessionLink('hermesapp://session/th_abc123'), null);
  assert.ok(isSessionLinkHref('hermesapp://session/th_abc123'));
  assert.ok(isSessionLinkHref(buildSessionLink(server, 'th_abc123')));
});

test('a short link resolves against the content connection only', () => {
  assert.equal(resolveSessionLink('hermesapp://session/th_abc123', server), buildSessionLink(server, 'th_abc123'));
  assert.equal(resolveSessionLink('hermesapp://session/th_abc123', null), null);
  assert.equal(resolveSessionLink('hermesapp://session/th_abc123', 'http://evil.example'), null, 'no plain-HTTP server');
  const full = buildSessionLink('https://other.example', 'th_z');
  assert.equal(resolveSessionLink(full, server), full, 'a full link keeps its own server');
});

test('message prose linkifies and allows short session links', () => {
  const text = 'Open hermesapp://session/th_abc123. Or the full one ' + buildSessionLink(server, 'th_def') + ' now';
  assert.deepEqual(sessionLinksInText(text).map(x => x.url), ['hermesapp://session/th_abc123', buildSessionLink(server, 'th_def')]);
  assert.equal(safeLinkUrl('hermesapp://session/th_abc123'), 'hermesapp://session/th_abc123');
  assert.equal(safeLinkUrl('hermesapp://session/evil'), null);
});
