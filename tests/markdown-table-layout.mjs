import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

// Runs actual production markup/CSS in Chromium, not a DOM or width mock.
export async function checkTableLayout(html, selector) {
  const dir = await mkdtemp(join(tmpdir(), 'markdown-table-layout-'));
  try {
    const nonce = /script-src 'nonce-([^']+)'/.exec(html)?.[1];
    const probe = `
      const results=[];
      for (const width of [240,320,390,768,1024,320]) {
        document.body.style.cssText='width:'+width+'px;box-sizing:border-box;margin:0;padding:16px;min-width:0;height:auto;overflow:visible';
        const tables=[...document.querySelectorAll(${JSON.stringify(selector)})];
        results.push({width,bodyWidth:document.body.clientWidth,bodyScroll:document.body.scrollWidth,tables:tables.map(view=>{
          const parent=view.parentElement, ps=getComputedStyle(parent);
          const available=parent.clientWidth-parseFloat(ps.paddingLeft)-parseFloat(ps.paddingRight);
          view.scrollLeft=0;
          const grid=view.querySelector('table');
          const result={viewport:view.clientWidth,available,scrollWidth:view.scrollWidth,cells:grid.querySelectorAll('th,td').length};
          view.scrollLeft=view.scrollWidth;
          result.scrollLeft=view.scrollLeft;
          result.lastVisible=grid.querySelector('tr:last-child td:last-child').getBoundingClientRect().right<=view.getBoundingClientRect().right+1;
          return result;
        })});
      }
      document.querySelector('#layout-results').textContent=JSON.stringify(results);
    `;
    html = html.replace('</body>', `<pre id="layout-results"></pre><script${nonce ? ` nonce="${nonce}"` : ''}>${probe}</script></body>`);
    const file = join(dir, 'layout.html');
    await writeFile(file, html);
    const dom = execFileSync(process.env.HERMES_TEST_CHROME, ['--headless', '--no-sandbox', '--disable-gpu', `--user-data-dir=${join(dir,'chrome')}`, '--dump-dom', pathToFileURL(file).href], { encoding:'utf8', timeout:30_000, maxBuffer:4_000_000, stdio:['ignore','pipe','pipe'] });
    const results = JSON.parse(/<pre id="layout-results">(.*?)<\/pre>/.exec(dom)?.[1] ?? 'null');
    assert.ok(results, 'browser executed the geometry probe');
    for (const row of results) {
      assert.ok(row.tables.length >= 3, 'plain, quote and list tables are rendered');
      assert.ok(row.bodyScroll <= row.bodyWidth + 1, `outer body overflow at ${row.width}: ${JSON.stringify(row)}`);
      for (const table of row.tables) {
        assert.ok(table.viewport <= table.available + 1, JSON.stringify(table));
        assert.equal(table.cells, 16, 'all eight columns and both rows survive');
        assert.ok(table.scrollWidth > table.viewport, 'wide grid is not squeezed or clipped');
        assert.ok(table.scrollLeft > 0 && table.lastVisible, 'last cell remains reachable by internal scroll');
      }
    }
    console.log('Table layout:', JSON.stringify(results));
  } finally { await rm(dir, { recursive:true, force:true }); }
}

const table = '| A | B | C | D | E | F | G | H |\n|---|---|---|---|---|---|---|---|\n| '+ 'unbroken'.repeat(80) +' | 中文长内容 | **bold** | `code` | x | y | z | last-column |';
export const wideTables = 'Before\n\n'+table+'\n\n> '+table.replaceAll('\n','\n> ')+'\n\n- Nested\n\n  '+table.replaceAll('\n','\n  ')+'\n\nAfter';
