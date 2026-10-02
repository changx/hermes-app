import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

// Execute production markup/CSS: full outer viewport, inner grid at least full.
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
          const grid=view.querySelector('table'), cells=[...grid.querySelectorAll('th,td')];
          view.scrollLeft=0;
          const bounds=grid.getBoundingClientRect();
          const result={viewport:view.clientWidth,available,gridWidth:bounds.width,scrollWidth:view.scrollWidth,cells:cells.length,
            cellOverflow:Math.max(...cells.map(c=>c.scrollWidth-c.clientWidth)),
            tableLayout:getComputedStyle(grid).tableLayout,wrap:getComputedStyle(cells[0]).overflowWrap,
            firstRowCellsWidth:[...grid.querySelector('tr').children].reduce((sum,c)=>sum+c.getBoundingClientRect().width,0)};
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
      assert.equal(row.tables.length, 9, 'wide, screenshot and short tables in prose, quote and list');
      assert.ok(row.bodyScroll <= row.bodyWidth + 1, `outer body overflow at ${row.width}: ${JSON.stringify(row)}`);
      for (const table of row.tables) {
        assert.ok(Math.abs(table.viewport-table.available) <= 1, JSON.stringify(table));
        assert.ok(table.gridWidth >= table.viewport-1, 'inner grid cannot leave an unused strip: '+JSON.stringify(table));
        assert.ok([4,8,12].includes(table.cells), 'all original header/body cells survive');
        assert.ok(Math.abs(table.firstRowCellsWidth-table.gridWidth) <= 2, 'columns fill the entire grid');
        assert.equal(table.tableLayout, 'auto', 'no fixed-layout squeezing');
        assert.equal(table.wrap, 'normal', 'no forced anywhere wrapping');
        assert.ok(table.lastVisible, 'last column reachable by internal scroll');
        if (table.gridWidth > table.viewport+1) assert.ok(table.scrollLeft > 0, 'wide content scrolls inside table');
      }
    }
    assert.ok(results[0].tables[0].gridWidth > results[0].tables[0].viewport, 'long content may exceed the bounded outer viewport');
    for (const table of results[4].tables.slice(6)) assert.ok(Math.abs(table.gridWidth-table.viewport) <= 1, 'short two-column grid expands to full viewport');
    console.log('Table layout:', JSON.stringify(results));
  } finally { await rm(dir, { recursive:true, force:true }); }
}

const table = '| A | B | C | D |\n|---|---|---|---|\n| '+ 'unbroken'.repeat(20) +' | 中文长内容 | **bold** `'+ 'code'.repeat(12) +'` | [last-column '+ 'link'.repeat(12) +'](https://example.com) |';
const screenshotTable = '| session 状态 | 客户端需要什么 |\n|---|---|\n| 当前打开 | 当前消息窗口、执行状态、审批等 |\n| 正在执行但没打开 | 摘要；如果希望切过去更快，可以预取最近消息 |\n| 未打开且未执行 | 列表信息，不需要正文 |\n| 从执行中变为结果 | 若之前在预取正文，再核对一次收尾结果 |\n| 用户打开任意 session | 读取服务器最新消息，不把旧缓存当成最新结果 |';
const contexts = table => table+'\n\n> '+table.replaceAll('\n','\n> ')+'\n\n- Nested\n\n  '+table.replaceAll('\n','\n  ');
const shortTable = '| A | B |\n|---|---|\n| x | y |';
export const wideTables = 'Before\n\n'+contexts(table)+'\n\n'+contexts(screenshotTable)+'\n\n'+contexts(shortTable)+'\n\nAfter';
