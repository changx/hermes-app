import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
const message = (id, role, text, extra = {}) => ({ id, role, text, createdAt: 1700000000, toolCalls: [], attachments: [], ...extra });
const longList = 'A longer user message\n\n'+Array.from({length:14}, (_,i)=>`- Item ${i+1}: ${'Long wrapped prose stays inside its own message. '.repeat(3)}\n  - A nested list item.`).join('\n');
const table = '| First | Second | Third | Fourth |\n| --- | --- | --- | --- |\n| '+Array(4).fill('a-long-readable-table-column'.repeat(8)).join(' | ')+' |';
const messages = [
  message('u1','user','Hi'),
  message('a1','assistant','I will align the message content and keep the desktop navigation unchanged.'),
  message('tool','assistant','',{toolCalls:[{id:'read',name:'read_file',label:'Read file',caption:'Reading styles.css L1-40',icon:'📖'},{id:'cmd',name:'terminal',label:'Run command',detail:'npm run desktop:check'}]}),
  message('final','assistant','Updated display:\n\n- Right-aligned gray user bubbles\n- Hidden sender names\n- A distinct final reply',{displayKind:'final'}),
  message('u2','user',longList),
  message('u3','user',table),
  message('u4','user','Attached reference.',{attachments:[{id:'image',name:'reference.png',mime:'image/png',state:'available',size:1024}]}),
  message('u5','user','```js\n'+ 'console.log("keep code locally scrollable"); '.repeat(40)+'\n```'),
  message('u6','user','A very long message. '.repeat(120)),
  message('a2','assistant','The next response starts after the complete user message.',{displayKind:'direct'}),
  message('notice','system','Context compressed'),
  message('current-year','user','Current year date',{createdAt:new Date(new Date().getFullYear(),9,3,18,4).getTime()/1000}),
  message('previous-year','user','Previous year date',{createdAt:new Date(new Date().getFullYear()-1,9,3,18,4).getTime()/1000}),
];
const snapshot = {revision:1,phase:'connected',connectionState:'online',channels:[{id:'c',name:'Project'}],threads:[{id:'t',channelId:'c',title:'Session display',lastMessageAt:Date.now()/1000,running:true}],selectedChannelId:'c',selectedThreadId:'t',messages,interactions:[],canLoadOlder:false};
const bundle = await build({stdin:{resolveDir:new URL('..',import.meta.url).pathname,loader:'tsx',contents:`
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DesktopShellView } from './src/renderer/shell';
export const html=renderToStaticMarkup(createElement(DesktopShellView,{snapshot:${JSON.stringify(snapshot)}}));
export const preview=renderToStaticMarkup(createElement(DesktopShellView,{snapshot:${JSON.stringify({...snapshot,messages:messages.slice(0,4)})}}));
`},bundle:true,platform:'node',format:'cjs',external:['react','react/jsx-runtime','react-dom/server'],write:false});
const mod={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);

test('Chromium: gray bubbles shrink-wrap, align right and contain rich content across resize', {skip:!process.env.HERMES_TEST_CHROME},async()=>{
  const folder=await mkdtemp(join(tmpdir(),'desktop-session-content-'));
  try {
    const file=join(folder,'layout.html');
    await writeFile(file,`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="root">${mod.exports.html}</div><pre id="results" hidden></pre><script>
      const results=[];
      for(const width of [720,900,1280,1800,720]) {
        document.documentElement.style.width=width+'px';document.body.style.width=width+'px';document.querySelector('.session-tab-page').style.width=width+'px';
        const list=document.querySelector('.message-list'),bounds=list.getBoundingClientRect(),rows=[...document.querySelectorAll('.message:not([hidden])')];
        const rect=x=>{const b=x.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width}};
        results.push({width,left:bounds.left,right:bounds.left+list.clientWidth,clientWidth:list.clientWidth,scrollWidth:list.scrollWidth,rows:rows.map((row,i)=>({box:rect(row),byline:row.querySelector('.message-role')?rect(row.querySelector('.message-role')):null,prose:rect(row.querySelector('.message-markdown')),last:rect(row.lastElementChild),next:rows[i+1]?rect(rows[i+1]):null,user:row.classList.contains('message-user'),final:row.classList.contains('message-final'),style:{textAlign:getComputedStyle(row.querySelector('.message-markdown')).textAlign,background:getComputedStyle(row).backgroundColor,radius:getComputedStyle(row).borderRadius,border:getComputedStyle(row).borderLeftWidth,marginTop:getComputedStyle(row).marginTop}})),tables:[...document.querySelectorAll('.markdown-table')].map(x=>({clientWidth:x.clientWidth,scrollWidth:x.scrollWidth}))});
      }
      document.getElementById('results').textContent=JSON.stringify(results);
    </script></body></html>`);
    const dom=execFileSync(process.env.HERMES_TEST_CHROME,['--headless','--no-sandbox','--disable-gpu',`--user-data-dir=${join(folder,'profile')}`,'--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:30000,maxBuffer:2_000_000,stdio:['ignore','pipe','pipe']});
    const results=JSON.parse(/<pre id="results" hidden="">(.*?)<\/pre>/.exec(dom)[1]);
    const near=(actual,expected,label)=>assert.ok(Math.abs(actual-expected)<1,`${label}: ${actual} != ${expected}`);
    for(const result of results){
      assert.ok(result.scrollWidth<=result.clientWidth,'wide contents scroll locally, not across timeline');
      for(const row of result.rows){
        if(row.user){
          near(row.box.right,result.right-14,'user right gutter');
          assert.ok(row.box.width<=(result.clientWidth-28)*.8+1,'80 percent available-width cap');
          near(row.prose.left,row.box.left+14,'bubble prose inset');
          assert.equal(row.style.textAlign,'left','bubble content remains left aligned');
        } else {
          near(row.box.left,result.left,'assistant left edge');near(row.box.right,result.right,'assistant right edge');
          near(row.prose.left,result.left+14,'assistant prose gutter');
        }
        if(row.byline)near(row.byline.left,row.prose.left,'byline and prose');
        assert.ok(row.last.bottom<=row.box.bottom+1,'last child stays inside message height');
        if(row.next)assert.ok(row.next.top>=row.box.bottom,'next row cannot overlap');
        if(row.user){assert.equal(row.style.background,'rgb(243, 243, 243)');assert.equal(row.style.radius,'22px');assert.equal(row.style.border,'0px');}
        if(row.final){assert.equal(row.style.background,'rgb(247, 245, 239)');assert.equal(row.style.border,'0px');assert.equal(row.style.marginTop,'32px');}
      }
      assert.ok(result.tables.every(x=>x.scrollWidth<=x.clientWidth+1),'tables wrap within their local width');
      assert.ok(result.rows[0].box.width<(result.clientWidth-28)*.8-10,'short message stays narrower than the cap');
    }
    if(process.env.HERMES_SESSION_EVIDENCE){
      const path=process.env.HERMES_SESSION_EVIDENCE;await mkdir(path,{recursive:true});
      await writeFile(join(path,'layout-results.json'),JSON.stringify(results,null,2)+'\n');
      const preview=join(path,'preview.html');await writeFile(preview,`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="root">${mod.exports.preview}</div></body></html>`);
      execFileSync(process.env.HERMES_TEST_CHROME,['--headless','--no-sandbox','--disable-gpu',`--user-data-dir=${join(folder,'screenshot')}`,'--window-size=1280,900',`--screenshot=${join(path,'preview.png')}`,pathToFileURL(preview).href],{timeout:30000,stdio:'pipe'});
    }
  }finally{await rm(folder,{recursive:true,force:true});}
});
