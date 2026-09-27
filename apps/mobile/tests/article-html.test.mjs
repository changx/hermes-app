import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { parseMessageMarkdown, safeLinkUrl } from '../src/messageMarkdown.ts';

// Execute the real article serializer against the real Markdown AST, with small
// stand-ins only for the separately bundled offline engine payloads.
const output = { exports: {} };
const sampleEngines = { KATEX_CSS: '.katex{font-family:KaTeX}', KATEX_SCRIPT: 'window.katex={renderToString(){return "math"}};', MERMAID_SCRIPT: 'window.mermaid={initialize(){},render(){return {svg:"<svg/>"}}};' };
runInNewContext(ts.transpileModule(readFileSync(new URL('../src/articleHtml.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { module: output, exports: output.exports, URL, require: name => {
  if (name === 'expo-crypto') return { getRandomBytes: count => Uint8Array.from({ length: count }, (_, i) => i + 1) };
  if (name === './markdownRenderer.generated') return sampleEngines;
  if (name === './messageMarkdown') return { safeLinkUrl };
  if (name === './fontScale') return { safeFontScale: value => [0.9, 1, 1.15, 1.3].includes(value) ? value : 1 };
  throw Error(name);
} });
const render = (text, calls) => output.exports.renderArticleHtml(parseMessageMarkdown(text), calls);

test('article CSS scales body, headings, code inheritance, controls and captions with bounded input', () => {
  const blocks = parseMessageMarkdown('# Heading\n\nSome `code`.\n\n```sh\nprintf ok\n```\n\n![image](https://example.com/i.png)');
  const large = output.exports.renderArticleHtml(blocks, [], 1.3).html;
  assert.match(large, /:root\{--interface-scale:1\.3\}/);
  assert.match(large, /html,body\{[^}]*font:19\.5px\/1\.55/);
  assert.match(large, /h1\{font-size:29\.9[\d]*px\}/);
  assert.equal((large.match(/h1\{font-size:/g) || []).length, 1);
  assert.match(large, /code,pre\{font-family:ui-monospace,monospace\}/);
  assert.match(large, /button\{[^}]*font:16\.9\d*px system-ui/);
  assert.match(large, /figcaption\{font-size:15\.6\d*px/);
  assert.match(large, /themeVariables:\{fontSize:'20\.8px'\}/);
  assert.match(output.exports.renderArticleHtml(blocks, [], 0.9).html, /--interface-scale:0\.9/);
  assert.match(output.exports.renderArticleHtml(blocks, [], Infinity).html, /--interface-scale:1\}/);
});

test('article serializes complete semantic blocks, selectable adjacent inline prose, local math and diagram', () => {
  const page = render('# 标题\n\n前文 **重点**、*斜体*、~~删~~、`代码` 和 $x^2$ 后文。\n\n> 引用\n\n3. 第一\n   - [x] 完成\n\n|左|右|\n|:---|---:|\n|一|**二**|\n\n```js\nconst a = 2;\n```\n\n$$y^2$$\n\n```mermaid\nflowchart LR\n甲-->乙\n```\n\n结尾');
  const html = page.html;
  for (const value of ['<h1>标题</h1>', '<strong>重点</strong>', '<em>斜体</em>', '<del>删</del>', '<code>代码</code>', '后文。', '<blockquote>', '<ol start="3">', '<ul>', '☑', 'text-align:right', '<th', '<td', 'const a = 2;', '甲--&gt;乙', '结尾']) assert.ok(html.includes(value), value);
  assert.match(html, /前文 [\s\S]*<span class="formula"[\s\S]*后文。/);
  assert.match(html, /window\.katex/);
  assert.match(html, /window\.mermaid/);
  assert.match(html, /data-render="diagram"/);
  assert.equal(page.expansions.length, 2);
  assert.equal(page.expansions[0].kind, 'table');
  assert.equal(page.expansions[1].kind, 'diagram');
  assert.match(html, /aria-label="View table fullscreen">⤢ View table fullscreen/);
  assert.match(html, /aria-label="View diagram fullscreen">⤢ View diagram fullscreen/);
  assert.match(html, /aria-label="Completed"/);
  assert.equal(page.expansions[0].block.rows[0][1].children[0].kind, 'strong');
  assert.match(html, /\.table-scroll\{overflow-x:auto/);
  assert.match(html, /Could not render: /);
});

test('HTML injection is escaped; URLs gated; tools serialize only safe labels/detail', () => {
  const page = render('## <script>alert(1)</script>\n\n[安全](https://example.com/a?x=1&y=2) [危险](javascript:alert(1)) ![坏](https://u@example.com/p.png) ![图](https://example.com/i.png) ![视频](https://example.com/v.mp4)\n\n```html\n<img src=x onerror=alert(1)>\n```', [
    { id: 't', name: 'terminal', label: '<strong>命令</strong>', detail: '[x](https://evil.example) && <img onerror=1>', arguments: { password: 'do-not-serialize-arguments' }, result: 'do-not-serialize-result' },
    { id: 'w', name: 'web_search', label: '查询', detail: '<b>搜索</b>', raw: 'do-not-serialize-raw' },
  ]);
  const html = page.html;
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;strong&gt;命令&lt;\/strong&gt;/);
  assert.match(html, /&lt;img onerror=1&gt;/);
  assert.doesNotMatch(html, /do-not-serialize-(arguments|result|raw)|<script>alert\(1\)<\/script>|href="javascript:|src="https:\/\/u@/);
  assert.match(html, /href="https:\/\/example\.com\/a\?x=1&amp;y=2" data-link="0"/);
  assert.match(html, /<img src="https:\/\/example\.com\/i\.png"/);
  assert.match(html, /<video src="https:\/\/example\.com\/v\.mp4" controls preload="none"/);
  assert.equal(page.links.length, 1);
  assert.equal(page.links[0], 'https://example.com/a?x=1&y=2');
});

test('nonce CSP isolates local engines and preserves browser default text selection/menu', () => {
  const html = render('普通段落。\n\n下一段。\n\n$$x$$\n\n```mermaid\nflowchart LR\nA-->B\n```').html;
  const nonce = /script-src 'nonce-([0-9a-f]+)'/.exec(html)?.[1];
  assert.equal(nonce.length, 48);
  assert.equal((html.match(new RegExp(`<script nonce="${nonce}"`, 'g')) || []).length, 3);
  for (const policy of ["default-src 'none'", "connect-src 'none'", "frame-src 'none'", "object-src 'none'", "form-action 'none'", "base-uri 'none'"]) assert.ok(html.includes(policy), policy);
  assert.doesNotMatch(html, /user-select:\s*none|contextmenu|selectionchange|execCommand|clipboard\.write|menuItems|suppressMenuItems/i);
  assert.match(html, /<p>普通段落。<\/p><p>下一段。<\/p>/);
  assert.match(html, /securityLevel:'strict'/);
  assert.match(html, /trust:false/);
});

test('one WebView bounds engine initialization and retains original source on overflow', () => {
  const html = render(`$a$ $b$ $c$ $d$\n\n\`\`\`mermaid\n${'X'.repeat(6001)}\n\`\`\``).html;
  assert.equal((html.match(/data-render="math"/g) || []).length, 3);
  assert.match(html, /<span class="fallback">\$d\$<\/span>/);
  assert.match(html, /Content too long; showing the original/);
  assert.equal(html.includes('window.mermaid'), false);
  assert.equal(html.includes('window.katex'), true);
});

test('media CSP permits explicit Markdown sources without granting graph image network access', () => {
  const empty = render('```mermaid\nflowchart LR\nA@{ img: "https://unexpected.example/track.png" }\n```').html;
  const policy = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(empty)[1];
  assert.match(policy, /img-src data: ;/);
  assert.doesNotMatch(policy, /unexpected\.example|img-src http:|img-src https:/);
  const media = render('![图](https://example.com/p.png?x=1) ![视频](https://example.com/v.mp4)').html;
  const allowed = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(media)[1];
  assert.match(allowed, /img-src data: https:\/\/example\.com\/p\.png;/);
  assert.match(allowed, /media-src https:\/\/example\.com\/v\.mp4;/);
});
