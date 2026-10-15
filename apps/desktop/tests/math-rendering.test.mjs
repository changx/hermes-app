// Production MessageContent with the locked KaTeX. Guards the 0.16 -> 0.18 upgrade
// (0.18 prefixes CSS classes and reports missing metrics through strict mode).
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const text = [
  'Inline $E = mc^2$ and $\\frac{a}{b}$.',
  '',
  '$$',
  '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}',
  '$$',
  '',
  'Broken $\\frac{a}{$ stays readable.',
  '',
  'Untrusted $\\href{javascript:alert(1)}{click}$ and $\\htmlData{x=1}{y}$.',
  '',
  '注：第三方页面写的价格（$59）和官方价格（$69.99）不一致。',
  '',
  'Costs $5 and $10 per month, and **bold** stays.',
  '',
  'Spaced $ x $ is prose; tight $x_1$ is math.',
].join('\n');

const bundle = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname, loader: 'tsx', contents: `
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageContent } from './src/renderer/message-content';
export const html = renderToStaticMarkup(createElement(MessageContent, { text: ${JSON.stringify(text)} }));
` }, bundle: true, external: ['react', 'react/jsx-runtime', 'react-dom/server'], format: 'cjs', platform: 'node', write: false });
const out = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, out, out.exports);
const html = out.exports.html;

test('Math: production markdown renders inline and display formulas with the locked KaTeX', () => {
  assert.equal(require('katex/package.json').version, '0.18.10');
  assert.match(html, /<math[^>]*>/, 'MathML output present');
  assert.match(html, /<annotation encoding="application\/x-tex">E = mc\^2<\/annotation>/);
  assert.match(html, /\\sum_\{i=1\}\^\{n\} i = \\frac\{n\(n\+1\)\}\{2\}/);
  assert.match(html, /class="[^"]*katex-display/, 'display formula block');
  assert.match(html, /class="[^"]*katex-html/, 'visual HTML layer present');
  assert.match(html, /katex-base|class="base"/, 'layout rows present');
  assert.match(html, /mfrac|frac-line/, 'fraction rendered');
});

test('Math: invalid TeX stays readable and untrusted commands do not create links or data attributes', () => {
  assert.match(html, /stays readable/, 'text after broken formula still renders');
  assert.match(html, /\\frac\{a\}\{/, 'broken source is shown, not dropped');
  assert.doesNotMatch(html.replace(/<annotation[^>]*>[\s\S]*?<\/annotation>/g, ''), /javascript:/i, 'only escaped TeX source may contain the URL');
  assert.match(html, /<mtext>\\href<\/mtext>/, '\\href is rejected as untrusted text');
  assert.doesNotMatch(html, /<a [^>]*href=/i, 'no link generated from \\href without trust');
  assert.doesNotMatch(html, /data-x=/, 'no data attribute from \\htmlData without trust');
});

test('Math: prices with $ stay prose; the delimiter rule matches mobile', () => {
  assert.match(html, /价格（\$59）和官方价格（\$69\.99）不一致。/, 'prices are plain text');
  assert.match(html, /Costs \$5 and \$10 per month, and <strong>bold<\/strong> stays\./);
  assert.match(html, /Spaced \$ x \$ is prose/);
  assert.match(html, /<annotation encoding="application\/x-tex">x_1<\/annotation>/, 'tight inline math still renders');
  assert.doesNotMatch(html, /<annotation[^>]*>(59|5 and)/, 'no formula made from prices');
});

// Real Chromium: KaTeX CSS from the bundled package lays the formula out, and Mermaid's
// $$ label path (dynamic import("katex") -> renderToString) works with the upgraded engine.
test('Chromium: KaTeX layout and Mermaid math labels render with the upgraded engine', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { pathToFileURL } = await import('node:url');
  const folder = await mkdtemp(join(tmpdir(), 'hermes-math-'));
  try {
    const page = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts', contents: `
import mermaid from 'mermaid';
import katex from 'katex';
const out = {};
const host = document.getElementById('formula');
katex.render('\\\\frac{n(n+1)}{2}', host, { displayMode: true });
const frac = host.querySelector('.mfrac');
out.fracHeight = frac ? frac.getBoundingClientRect().height : 0;
out.fracWidth = frac ? frac.getBoundingClientRect().width : 0;
// App uses htmlLabels:false (no math labels); enable here only to exercise Mermaid's KaTeX call.
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: true, flowchart: { htmlLabels: true }, theme: 'neutral' });
mermaid.render('d1', 'flowchart LR\\n  A["$$x^2$$"] --> B[done]').then(({ svg }) => {
  out.svgHasMath = /<math/.test(svg); out.svgUnsupported = /unsupported/i.test(svg); out.svgOk = /<svg/.test(svg);
}).catch(error => { out.mermaidError = String(error && error.message || error); }).finally(() => {
  document.getElementById('results').textContent = JSON.stringify(out);
});
` }, bundle: true, format: 'iife', platform: 'browser', write: false, loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' } });
    const katexCss = await readFile(require.resolve('katex/dist/katex.min.css'), 'utf8');
    await writeFile(join(folder, 'page.js'), page.outputFiles[0].text);
    await writeFile(join(folder, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><style>${katexCss}</style></head><body><div id="formula"></div><pre id="results" hidden></pre><script src="page.js"></script></body></html>`);
    const dom = execFileSync(process.env.HERMES_TEST_CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=10000', `--user-data-dir=${join(folder, 'profile')}`, '--dump-dom', pathToFileURL(join(folder, 'index.html')).href], { encoding: 'utf8', timeout: 60000, maxBuffer: 20_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const match = /<pre id="results" hidden="">(.*?)<\/pre>/s.exec(dom);
    assert.ok(match && match[1], 'browser finished math checks');
    const out = JSON.parse(match[1]);
    assert.equal(out.mermaidError, undefined, `mermaid rendered: ${out.mermaidError}`);
    assert.ok(out.svgOk && out.svgHasMath && !out.svgUnsupported, `mermaid math label: ${JSON.stringify(out)}`);
    assert.ok(out.fracHeight > 15 && out.fracWidth > 10, `fraction laid out with KaTeX CSS: ${JSON.stringify(out)}`);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
