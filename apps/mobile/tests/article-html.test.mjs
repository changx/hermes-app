import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { loadMarkdownEngines } from './render-resource-fixture.mjs';
import { safeFontScale } from '../src/fontScale.ts';
import * as toolPresentation from '../../../packages/client/src/toolPresentation.ts';
import { parseMessageMarkdown, safeLinkUrl } from '../src/messageMarkdown.ts';

// Execute the real article serializer against the real Markdown AST, with small
// stand-ins only for the separately bundled offline engine payloads.
const output = { exports: {} };
const sampleEngines = { KATEX_CSS: '.katex{font-family:KaTeX}', KATEX_SCRIPT: 'window.katex={renderToString(){return "math"}};', MERMAID_SCRIPT: 'window.mermaid={initialize(){},render(){return {svg:"<svg/>"}}};' };
runInNewContext(ts.transpileModule(readFileSync(new URL('../src/articleHtml.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { module: output, exports: output.exports, URL, require: name => {
  if (name === 'expo-crypto') return { getRandomBytes: count => Uint8Array.from({ length: count }, (_, i) => i + 1) };
  if (name === '../../../packages/client/src/toolPresentation') return toolPresentation;
  if (name === './markdownEngines') return loadMarkdownEngines(sampleEngines);
  if (name === './messageMarkdown') return { safeLinkUrl };
  if (name === './fontScale') return { safeFontScale };
  throw Error(name);
} });
const render = (text, calls) => output.exports.renderArticleHtml(parseMessageMarkdown(text), calls);

const { checkTableLayout, wideTables } = await import('../../../tests/markdown-table-layout.mjs');
test('Chromium: full article tables fit containers and wrap across resizes', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  await checkTableLayout(render(wideTables).html, '.table-grid');
});

test('article code blocks carry an indexed copy target with the exact original text', () => {
  const source = 'const a = "<b>&</b>";\nconsole.log(a);';
  const page = render('Intro\n\n```js\n' + source + '\n```\n\n```\nsecond\n```');
  assert.deepEqual([...page.copies], [source, 'second']);
  assert.match(page.html, /<section class="code" data-copy="0" role="button"/);
  assert.match(page.html, /data-copy="1"/);
  assert.match(page.html, /<small class="copy">Copy<\/small>/);
  // Only a bounded index crosses the bridge; code text never goes through postMessage.
  assert.match(page.html, /'copy:'/);
  assert.doesNotMatch(page.html, /<b>&<\/b>/);
});

test('article inline code copies by index; inline code inside a link stays a link', () => {
  const page = render('Run `npm test` or [`docs`](https://example.com).\n\n```\nblock\n```');
  assert.deepEqual([...page.copies], ['npm test', 'block']);
  assert.match(page.html, /<code class="copyable" data-copy="0" role="button">npm test<\/code>/);
  assert.match(page.html, /<a href="https:\/\/example.com\/" data-link="0"><code>docs<\/code><\/a>/);
  assert.match(page.html, /closest\('\[data-copy\]'\)/);
});
