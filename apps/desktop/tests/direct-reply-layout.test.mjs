// Single newlines in chat messages and line-per-paragraph direct (native command)
// replies. See docs/direct-reply-layout.md.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Shape of the real Hermes `/commands` reply: single `\n` between entries.
const commands = [
  '📚 **Commands** (204 total, page 1/11)',
  '',
  '`/start` -- Acknowledge platform start pings without a reply',
  '`/new [name]` -- Start a new session (fresh session ID + history) (alias: `/reset`)',
  '`/pause [reason | off]` -- Pause new work globally (emergency stop); \'/pause off\' resumes',
  '',
  'next → `/commands 2`',
].join('\n');
const prose = 'First line\nsecond line\n\n```\ncode one\ncode two\n```';

const bundle = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname, loader: 'tsx', contents: `
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageContent } from './src/renderer/message-content';
export const render = (props) => renderToStaticMarkup(createElement(MessageContent, props));
` }, bundle: true, external: ['react', 'react/jsx-runtime', 'react-dom/server'], format: 'cjs', platform: 'node', write: false });
const out = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, out, out.exports);
const { render } = out.exports;
// Inline code carries click-to-copy attributes; compare only the element.
const paragraphs = html => [...html.matchAll(/<p>([\s\S]*?)<\/p>/g)].map(match => match[1].replace(/<code[^>]*>/g, '<code>'));

test('a chat message shows a single newline as a line break; code keeps its own lines', () => {
  const html = render({ text: prose });
  assert.deepEqual(paragraphs(html), ['First line<br/>\nsecond line']);
  assert.match(html, /<code[^>]*>code one\ncode two\n<\/code>/);
});

test('a Markdown file preview keeps the standard soft break', () => {
  assert.deepEqual(paragraphs(render({ text: prose, document: true })), ['First line\nsecond line']);
});

test('a direct reply renders each line as its own paragraph', () => {
  const lines = paragraphs(render({ text: commands, lines: true }));
  assert.equal(lines.length, 5);
  assert.equal(lines[0], '📚 <strong>Commands</strong> (204 total, page 1/11)');
  assert.equal(lines[1], '<code>/start</code> -- Acknowledge platform start pings without a reply');
  assert.match(lines[2], /^<code>\/new \[name\]<\/code> -- Start a new session .*<code>\/reset<\/code>\)$/);
  assert.match(lines[3], /^<code>\/pause \[reason \| off\]<\/code> -- Pause new work/);
  assert.equal(lines[4], 'next → <code>/commands 2</code>');
  assert.doesNotMatch(render({ text: commands, lines: true }), /<br\/>/);
});

test('direct replies keep code blocks and lists intact', () => {
  const html = render({ text: `${prose}\n\n- one\n- two`, lines: true });
  assert.deepEqual(paragraphs(html), ['First line', 'second line']);
  assert.match(html, /<code[^>]*>code one\ncode two\n<\/code>/);
  assert.match(html, /<ul>\n<li>one<\/li>\n<li>two<\/li>\n<\/ul>/);
});
