import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Execute the production HTML generator with small bundled-engine sentinels.
const module = { exports: {} };
runInNewContext(ts.transpileModule(readFileSync(new URL('../src/markdownWeb.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { module, exports: module.exports, require: name => {
  if (name === 'expo-crypto') return { getRandomBytes: count => new Uint8Array(count).fill(7) };
  if (name === './markdownRenderer.generated') return { KATEX_CSS: '.katex{}', KATEX_SCRIPT: '/* local katex */', MERMAID_SCRIPT: '/* local mermaid */' };
  throw Error(`unexpected import ${name}`);
} });
const { renderMarkdownHtml } = module.exports;

test('production HTML keeps UTF-8, safe JSON, nonce CSP and strict local engines', () => {
  const payload = '</script><script>alert(1)</script>\u2028$&\\"甲';
  for (const kind of ['math', 'diagram']) {
    const html = renderMarkdownHtml(kind, payload);
    assert.ok(html.startsWith('<!doctype html><html><head><meta charset="utf-8">'));
    assert.ok(html.includes('default-src \'none\''));
    assert.ok(html.includes('connect-src \'none\''));
    assert.ok(html.includes('img-src \'none\''));
    assert.ok(html.includes('form-action \'none\''));
    assert.ok(html.includes('font-src data:'));
    assert.ok(html.includes('script-src \'nonce-'));
    assert.equal(html.includes(payload), false);
    assert.ok(html.includes('\\u003c/script\\u003e'));
    assert.equal((html.match(/<script nonce=/g) || []).length, 2);
    assert.ok(html.includes(JSON.stringify(payload).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')));
    assert.equal(html.includes('http://'), false);
    assert.equal(html.includes('https://'), false);
    if (kind === 'math') {
      assert.ok(html.includes('trust:false,maxExpand:1000'));
      assert.ok(html.includes('/* local katex */'));
    } else {
      assert.ok(html.includes("securityLevel:'strict'"));
      assert.ok(html.includes('maxEdges:100'));
      assert.ok(html.includes('/* local mermaid */'));
    }
  }
});

test('oversized source returns inert text without engines or executable tags', () => {
  const html = renderMarkdownHtml('diagram', '<script>bad</script>' + 'x'.repeat(6200));
  assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;'));
  assert.equal(html.includes('<script nonce='), false);
  assert.equal(html.includes('/* local mermaid */'), false);
  assert.ok(html.includes("default-src 'none'"));
});

test('production Mermaid draw script rejects an empty diagram and reports only failure status', async () => {
  async function render(svg) {
    const html = renderMarkdownHtml('diagram', 'flowchart LR\nA-->B');
    const script = [...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)].at(-1)[1];
    const events = [];
    const element = { innerHTML: '', textContent: '', querySelector: selector => selector === 'svg' && element.innerHTML.includes('<svg') ? {} : null };
    const context = { document: { getElementById: () => element },
      mermaid: { initialize: () => {}, render: async () => ({ svg }) },
      window: { ReactNativeWebView: { postMessage: data => events.push(data) } } };
    runInNewContext(script, context);
    await new Promise(setImmediate);
    return { element, events };
  }
  const good = await render('<svg></svg>');
  assert.equal(good.element.innerHTML, '<svg></svg>');
  assert.deepEqual(good.events, ['render-ready']);
  const blank = await render('');
  assert.equal(blank.element.textContent, '暂时无法显示：flowchart LR\nA-->B');
  assert.deepEqual(blank.events, ['render-failed']);
});
