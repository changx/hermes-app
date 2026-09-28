import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { safeFontScale } from '../src/fontScale.ts';

// Execute the production HTML generator with small bundled-engine sentinels.
const module = { exports: {} };
runInNewContext(ts.transpileModule(readFileSync(new URL('../src/markdownWeb.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { module, exports: module.exports, require: name => {
  if (name === 'expo-crypto') return { getRandomBytes: count => new Uint8Array(count).fill(7) };
  if (name === './markdownRenderer.generated') return { KATEX_CSS: '.katex{}', KATEX_SCRIPT: '/* local katex */', MERMAID_SCRIPT: '/* local mermaid */' };
  if (name === './fontScale') return { safeFontScale };
  throw Error(`unexpected import ${name}`);
} });
const { renderMarkdownHtml } = module.exports;

test('local math/diagram HTML and too-long fallback scale text without changing source or CSP', () => {
  for (const kind of ['math', 'diagram']) {
    const large = renderMarkdownHtml(kind, 'x+y', true, 1.3);
    assert.match(large, /:root\{--interface-scale:1\.3\}/);
    assert.match(large, /font:19\.5px system-ui/);
    assert.match(large, /default-src 'none'/);
    assert.match(renderMarkdownHtml(kind, 'x+y', true, 1), /font:15px system-ui/);
    assert.match(renderMarkdownHtml(kind, 'x+y', true, 1.1), /font:16\.5px system-ui/);
    assert.match(renderMarkdownHtml(kind, 'x+y', true, 100), /--interface-scale:1\}/);
  }
  const oversized = renderMarkdownHtml('math', 'x'.repeat(4100), true, 1.15);
  assert.match(oversized, /--interface-scale:1\.15/);
  assert.match(oversized, /font-size:17\.25px/);
});

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

async function renderDiagram(svg = '<svg></svg>', width = 400, height = 200) {
  const html = renderMarkdownHtml('diagram', 'flowchart LR\nA-->B');
  const script = [...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)].at(-1)[1];
  const events = [], listeners = {}, touch = {}, windowEvents = {};
  const diagram = { style: {}, viewBox: { baseVal: { width, height } }, getBoundingClientRect: () => ({ width, height }) };
  const element = { innerHTML: '', textContent: '', querySelector: selector => selector === 'svg' && element.innerHTML.includes('<svg') ? diagram : null };
  const stage = { clientWidth: 336, clientHeight: 176, scrollLeft: 0, scrollTop: 0,
    getBoundingClientRect: () => ({ left: 0, top: 46 }),
    addEventListener: (type, callback, options) => { touch[type] = { callback, options }; } };
  const context = { document: { getElementById: id => id === 'content' ? element : id === 'diagram-stage' ? stage : { addEventListener: (type, callback) => { listeners[id] = callback; } } },
    mermaid: { initialize: () => {}, render: async () => ({ svg }) },
    window: { ReactNativeWebView: { postMessage: data => events.push(data) }, addEventListener: (type, callback) => { windowEvents[type] = callback; } } };
  runInNewContext(script, context);
  await new Promise(setImmediate);
  const dispatch = (type, touches = []) => {
    let prevented = false;
    touch[type].callback({ touches, preventDefault: () => { prevented = true; } });
    return prevented;
  };
  return { element, events, diagram, listeners, html, stage, dispatch, touch, windowEvents };
}

test('production Mermaid draw script fits the viewport and rejects an empty diagram with only failure status', async () => {
  const good = await renderDiagram();
  assert.equal(good.element.innerHTML, '<svg></svg>');
  assert.deepEqual(good.events, ['render-ready']);
  assert.match(good.html, /maximum-scale=1,user-scalable=no/);
  for (const label of ['Zoom in', 'Zoom out', 'Reset zoom']) assert.ok(good.html.includes(`aria-label="${label}"`));
  assert.equal(good.diagram.style.width, '320px');
  assert.equal(good.diagram.style.height, '160px');
  good.listeners['zoom-in']();
  assert.equal(good.diagram.style.width, '400px');
  good.listeners['zoom-out']();
  assert.equal(good.diagram.style.width, '320px');
  good.listeners['zoom-out']();
  assert.equal(good.diagram.style.width, '256px');
  good.listeners['zoom-reset']();
  assert.equal(good.diagram.style.width, '320px');
  assert.deepEqual(good.events, ['render-ready'], 'zoom never uses the native message bridge');
  const blank = await renderDiagram('');
  assert.equal(blank.element.textContent, 'Could not render: flowchart LR\nA-->B');
  assert.deepEqual(blank.events, ['render-failed']);
});

test('wide and tall Mermaid diagrams initially fit both axes; small diagrams are not enlarged', async () => {
  for (const [width, height] of [[1600, 200], [200, 1600], [100, 80]]) {
    const { diagram } = await renderDiagram('<svg></svg>', width, height);
    const scale = Math.min(1, 320 / width, 160 / height);
    assert.equal(parseFloat(diagram.style.width), width * scale);
    assert.equal(parseFloat(diagram.style.height), height * scale);
  }
});

test('pinch scale survives release, cancellation, resize and subsequent gestures; single-touch remains native', async () => {
  const g = await renderDiagram();
  const fingers = distance => [{ clientX: 160 - distance / 2, clientY: 126 }, { clientX: 160 + distance / 2, clientY: 126 }];
  assert.equal(g.touch.touchmove.options.passive, false);
  assert.equal(g.dispatch('touchstart', fingers(80)), true);
  assert.equal(g.dispatch('touchmove', fingers(160)), true);
  assert.equal(g.diagram.style.width, '640px');
  // Same diagram point stays under the centre of the two fingers.
  assert.equal(g.stage.scrollLeft, 152);
  assert.equal(g.stage.scrollTop, 72);
  g.dispatch('touchend');
  assert.equal(g.diagram.style.width, '640px', 'release must not restore the fit scale');
  g.stage.clientWidth = 216; g.stage.clientHeight = 116;
  g.windowEvents.resize();
  assert.equal(g.diagram.style.width, '640px', 'layout changes preserve manual zoom');
  g.dispatch('touchstart', fingers(80));
  g.dispatch('touchmove', fingers(120));
  g.dispatch('touchcancel');
  assert.equal(parseFloat(g.diagram.style.width), 960, 'new pinch continues from retained scale');
  g.dispatch('touchmove', fingers(200));
  assert.equal(parseFloat(g.diagram.style.width), 960, 'cancel clears stale gesture');
  assert.equal(g.dispatch('touchstart', fingers(80).slice(0, 1)), false);
  assert.equal(g.dispatch('touchmove', fingers(120).slice(0, 1)), false);
  for (const event of ['gesturestart', 'gesturechange', 'gestureend']) assert.equal(g.dispatch(event), true);
  g.listeners['zoom-reset']();
  assert.equal(g.diagram.style.width, '200px');
  assert.equal(g.stage.scrollLeft, 0);
  assert.equal(g.stage.scrollTop, 0);
  g.stage.clientWidth = 416; g.stage.clientHeight = 216; g.windowEvents.resize();
  assert.equal(g.diagram.style.width, '400px', 'automatic fitting resumes after reset');
  for (let i = 0; i < 50; i++) g.listeners['zoom-in']();
  assert.equal(g.diagram.style.width, '1600px');
  for (let i = 0; i < 80; i++) g.listeners['zoom-out']();
  assert.equal(g.diagram.style.width, '100px');
  assert.deepEqual(g.events, ['render-ready']);
});
