import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

function luminance(hex) {
  const values = hex.match(/\w\w/g).map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}

test('draft text keeps red and no decoration; desktop uses the shared font default', async () => {
  const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
  const mobile = await readFile(new URL('../../mobile/src/ChannelScreens.tsx', import.meta.url), 'utf8');
  assert.ok(mobile.includes("draft: { color: '#dc2626', fontSize: 12, fontWeight: '600' }"));
  assert.equal(/\.thread-draft \{([^}]*)\}/.exec(css)[1].trim(), 'color: #dc2626; font-size: var(--app-font-size); font-weight: 600; flex-shrink: 0;');
  assert.ok(!mobile.includes('draftBadge:'));
  const contrast = (luminance('ffffff') + 0.05) / (luminance('dc2626') + 0.05);
  assert.ok(contrast >= 4.5);
  console.log('Draft red text/white background contrast:', contrast.toFixed(2));
});

test('Chromium: red draft text uses 16px without decoration, clipping or overlap', { skip: !process.env.HERMES_TEST_CHROME }, async () => {
  const bundle = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname, loader: 'tsx', contents: `
    import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server';
    import { NavigationPanel } from './src/renderer/navigation-panel';
    const snapshot = { channels:[{id:'p',name:'Example'}], threads:[
      {id:'a',channelId:'p',title:'A long session title repeated to check that the draft badge is never hidden or clipped by its text',running:true,completedUnread:true,lastMessageAt:Date.now()/1000},
      {id:'b',channelId:'p',title:'Another draft',running:false,lastMessageAt:Date.now()/1000},
      {id:'c',channelId:'p',title:'No draft',running:false,lastMessageAt:Date.now()/1000}], selectedChannelId:'p',selectedThreadId:'a' };
    export const html = renderToStaticMarkup(<NavigationPanel snapshot={snapshot} onNewSession={()=>{}} draftThreads={new Set(['a','b'])}/>);
  ` }, bundle:true, platform:'node', format:'cjs', external:['react','react/jsx-runtime','react-dom/server'], write:false });
  const mod = { exports:{} }; new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
  const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url),'utf8');
  const folder = await mkdtemp(join(tmpdir(),'draft-badge-'));
  try {
    const file=join(folder,'check.html');
    await writeFile(file,`<!doctype html><style>${css}</style><nav id="preview">${mod.exports.html}</nav><pre id="results"></pre><script>
      const results=[];
      for(const width of [240,320,480]) {
        document.getElementById('preview').style.width=width+'px';
        for(const badge of document.querySelectorAll('.thread-draft')) {
          const s=getComputedStyle(badge),b=badge.getBoundingClientRect(),row=badge.closest('button').getBoundingClientRect(),title=badge.previousElementSibling.getBoundingClientRect();
          results.push({width,color:s.color,background:s.backgroundColor,border:s.borderTopWidth,padding:s.padding,weight:s.fontWeight,size:s.fontSize,contained:b.right<=row.right && b.left>=row.left,nonoverlap:title.right<=b.left,visible:b.width>0&&b.height>0});
        }
      }
      document.getElementById('results').textContent=JSON.stringify(results);document.currentScript.remove();
    </script>`);
    const dom=execFileSync(process.env.HERMES_TEST_CHROME,['--headless','--no-sandbox','--disable-gpu','--virtual-time-budget=1000',`--user-data-dir=${join(folder,'profile')}`,'--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:30000,maxBuffer:1_000_000,stdio:['ignore','pipe','pipe']});
    const rows=JSON.parse(/<pre id="results">(.*?)<\/pre>/.exec(dom)?.[1]??'null');
    assert.equal(rows?.length,6);
    for(const row of rows) {
      assert.equal(row.color,'rgb(220, 38, 38)');assert.equal(row.background,'rgba(0, 0, 0, 0)');assert.equal(row.border,'0px');assert.equal(row.padding,'0px');
      assert.equal(row.weight,'600');assert.equal(row.size,'16px');assert.ok(row.visible);assert.ok(row.contained);assert.ok(row.nonoverlap);
    }
  } finally { await rm(folder,{recursive:true,force:true}); }
});
