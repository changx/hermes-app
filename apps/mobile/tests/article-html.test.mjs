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
