import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const long = 'Plain prose that is much longer than the Session column and must wrap onto the next line. '.repeat(3).trim();
const code = 'print("' + 'x'.repeat(240) + '")';
const text = ['```text', long, '```', '', '```', long, '```', '', '```PlainText', long, '```', '', '    ' + long, '', '```python', code, '```'].join('\n');

test('Chromium: plain-text code blocks wrap inside the Session column; language code scrolls', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const bundle = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname, loader: 'tsx', contents: `
    import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
    import {DesktopShellView} from './src/renderer/shell';
    const messages=[{id:'a',role:'assistant',displayKind:'final',text:${JSON.stringify(text)},toolCalls:[],attachments:[]}];
    const snapshot={revision:1,phase:'connected',connectionState:'online',channels:[{id:'p',name:'Project'}],threads:[{id:'t',channelId:'p',title:'Wrap'}],selectedThreadId:'t',messages,interactions:[],canLoadOlder:false};
    export const html=renderToStaticMarkup(<DesktopShellView snapshot={snapshot}/>);
  ` }, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/jsx-runtime', 'react-dom/server'], write: false });
  const mod = { exports: {} }; new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports);
  const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
  const folder = await mkdtemp(join(tmpdir(), 'desktop-code-wrap-'));
  try {
    const file = join(folder, 'page.html');
    await writeFile(file, `<!doctype html><meta charset="utf-8"><style>${css}</style>${mod.exports.html}<pre id="results" hidden></pre><script>
      const results=[];
      for(const width of [520,900]){
        document.querySelector('.session-tab-page').style.width=width+'px';
        const column=document.querySelector('.timeline-content').getBoundingClientRect();
        results.push({width,blocks:[...document.querySelectorAll('pre.code-block')].map(pre=>{const box=pre.getBoundingClientRect();
          return {wrap:pre.classList.contains('code-block-wrap'),overflow:pre.scrollWidth-pre.clientWidth,lines:Math.round(pre.clientHeight/parseFloat(getComputedStyle(pre).lineHeight)),inside:box.right<=column.right+0.5,text:pre.textContent.length};})});
      }
      document.getElementById('results').textContent=JSON.stringify(results);
    </script>`);
    const dom = execFileSync(process.env.HERMES_TEST_CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=1000,900', `--user-data-dir=${join(folder, 'profile')}`, '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 30000, maxBuffer: 2_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const match = /<pre id="results" hidden="">(.*?)<\/pre>/.exec(dom); assert.ok(match, 'browser completed layout checks');
    for (const row of JSON.parse(match[1])) {
      assert.deepEqual(row.blocks.map(block => block.wrap), [true, true, true, true, false], `wrap classes at ${row.width}`);
      for (const block of row.blocks.slice(0, 4)) {
        assert.ok(block.overflow <= 0, `plain-text block has no sideways scroll at ${row.width}: ${JSON.stringify(block)}`);
        assert.ok(block.lines >= 2, `plain-text block wraps at ${row.width}`);
        assert.ok(block.inside, `plain-text block stays inside the column at ${row.width}`);
        assert.ok(block.text >= long.length, 'plain-text block keeps all text');
      }
      assert.ok(row.blocks[4].overflow > 0, `python block keeps its line and scrolls at ${row.width}`);
    }
  } finally { await rm(folder, { recursive: true, force: true }); }
});
