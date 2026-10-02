import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const source = `读完了，**记录确实抓到了异常**。\n\n- 键盘还显示时，表单持续重复布局。\n- 键盘关闭后，页面高度恢复正常。\n- 第一版采集器丢掉了早期事件；这是一段较长的说明，用于检查正常换行后行距不被压缩。\n\n已发布改进后的诊断版。\n\n麻烦再录一次：\n\n1. Reload，打开 Report。\n2. 选择 Start → Close。\n3. 再切回页面。\n\n## 验证\n\n- 外层\n  - 内层一\n  - 内层二\n\n- 含段落的列表\n\n  后续段落。\n\n\`\`\`js\nfunction check() {\n  return 1;\n}\n\`\`\`\n\n| 项目 | 结果 |\n| --- | --- |\n| 间距 | 正常 |`;
const bundle = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname, loader: 'tsx', contents: `
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageContent } from './src/renderer/message-content';
export const html = renderToStaticMarkup(createElement(MessageContent, {text: ${JSON.stringify(source)}}));
` }, bundle: true, external: ['react', 'react/jsx-runtime', 'react-dom/server'], format: 'cjs', platform: 'node', write: false });
const out = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), out, out.exports);
const html = out.exports.html;
const styles = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');

test('Markdown owns its whitespace without changing content or code indentation', () => {
  assert.match(html, /^<div class="message-markdown">/);
  assert.match(styles, /\.message-markdown\s*\{\s*white-space: normal;\s*\}/);
  assert.match(html, /<\/p>\n<ul>/, 'renderer separators remain in markup, not altered message text');
  assert.match(html, /function check\(\) \{\n  return 1;\n\}/);
  assert.match(html, /<ol>/);
  assert.match(html, /<h2>/);
  assert.match(html, /<table>/);
  assert.match(styles, /\.code-block \{[^}]*white-space: pre;/);
  assert.match(styles, /\.message \.tool-command \{[^}]*white-space: pre-wrap;/);
});

test('Chromium layout removes separator lines while preserving wrapped text and code', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'desktop-markdown-spacing-'));
  try {
    const file = join(dir, 'layout.html');
    await writeFile(file, `<!doctype html><meta charset="utf-8"><style>${styles}
body { display:block; margin:0; padding:20px; font-size:16px; }
article { width:600px; }
#before .message-markdown { white-space:pre-wrap; }
</style><article id="before" class="message message-final">${html}</article><article id="after" class="message message-final">${html}</article>
<pre id="metrics"></pre><script>
const measure = id => {
  const root = document.querySelector('#'+id+' .message-markdown');
  const list = root.querySelector('ul');
  const ordered = root.querySelector('ol');
  const gap = (a,b) => b.getBoundingClientRect().top-a.getBoundingClientRect().bottom;
  return {height:root.getBoundingClientRect().height, paragraphToList:gap(root.firstElementChild,list), listItemGap:gap(list.children[0],list.children[1]), orderedItemGap:gap(ordered.children[0],ordered.children[1]), codeWhitespace:getComputedStyle(root.querySelector('pre')).whiteSpace, codeText:root.querySelector('pre').textContent, lineHeight:getComputedStyle(list).lineHeight, nestedWhitespace:getComputedStyle(root.querySelector('ul ul')).whiteSpace, finalBackground:getComputedStyle(root.parentElement).backgroundColor};
};
document.querySelector('#metrics').textContent=JSON.stringify({before:measure('before'),after:measure('after')});
</script>`);
    const dom = execFileSync(process.env.HERMES_TEST_CHROME, ['--headless', '--no-sandbox', '--disable-gpu', `--user-data-dir=${join(dir, 'chrome')}`, '--dump-dom', pathToFileURL(file).href], { encoding:'utf8', stdio:['ignore','pipe','pipe'], timeout:30_000, maxBuffer:4_000_000 });
    const metrics = JSON.parse(/<pre id="metrics">(.*?)<\/pre>/.exec(dom)[1]);
    console.log('Markdown layout metrics:', JSON.stringify(metrics));
    assert.ok(metrics.before.paragraphToList > metrics.after.paragraphToList + 20);
    assert.ok(metrics.before.listItemGap > metrics.after.listItemGap + 20);
    assert.ok(metrics.before.orderedItemGap > metrics.after.orderedItemGap + 20);
    assert.ok(metrics.after.paragraphToList < 12);
    assert.ok(metrics.after.listItemGap < 1);
    assert.ok(metrics.after.orderedItemGap < 1);
    assert.equal(metrics.after.codeWhitespace, 'pre');
    assert.equal(metrics.after.codeText, metrics.before.codeText);
    assert.equal(metrics.after.lineHeight, metrics.before.lineHeight);
    assert.equal(metrics.after.nestedWhitespace, 'normal');
    assert.equal(metrics.after.finalBackground, metrics.before.finalBackground);
  } finally { await rm(dir, { recursive:true, force:true }); }
});
