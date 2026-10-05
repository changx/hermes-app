import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const text = 'Inline `inline code`.\n\n```sh\necho single\n```\n\n```text\nfirst line\nsecond line\n```\n\n    indented code\n\n| Code | Value |\n| --- | --- |\n| `table code` | Example |';
test('Chromium: Session inline, single-line and multiline code share the requested background in every message role', {skip: !process.env.HERMES_TEST_CHROME}, async () => {
  const bundle = await build({stdin:{resolveDir:new URL('..',import.meta.url).pathname,loader:'tsx',contents:`
    import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
    import {DesktopShellView} from './src/renderer/shell';
    const messages = ['user','direct','final'].map((kind,index)=>({id:kind,role:kind==='user'?'user':'assistant',...(kind==='user'?{}:{displayKind:kind}),text:${JSON.stringify(text)},toolCalls:kind==='direct'?[{id:'command',name:'terminal',label:'Run command',detail:'git status --short'}]:[],attachments:[]}));
    const snapshot={revision:1,phase:'connected',connectionState:'online',channels:[{id:'p',name:'Project'}],threads:[{id:'t',channelId:'p',title:'Code backgrounds'}],selectedThreadId:'t',messages,interactions:[],canLoadOlder:false};
    export const html=renderToStaticMarkup(<DesktopShellView snapshot={snapshot}/>);
  `},bundle:true,platform:'node',format:'cjs',external:['react','react/jsx-runtime','react-dom/server'],write:false});
  const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
  const css=await readFile(new URL('../src/renderer/styles.css',import.meta.url),'utf8');
  const folder=await mkdtemp(join(tmpdir(),'desktop-code-background-'));
  try {
    const file=join(folder,'preview.html');
    await writeFile(file,`<!doctype html><meta charset="utf-8"><style>${css}</style>${mod.exports.html}<pre id="results" hidden></pre><script>
      const results=[];
      for(const width of [720,1280,1800]){
        document.documentElement.style.width=width+'px';document.body.style.width=width+'px';
        document.querySelector('.session-tab-page').style.width=width+'px';
        for(const selector of ['.message-user','.message-assistant:not(.message-final)','.message-final']){
          const message=document.querySelector(selector);
          const codes=[...message.querySelectorAll('.message-markdown code')].map(code=>{
            const block=code.closest('pre');return {text:code.textContent,block:!!block,background:getComputedStyle(block||code).backgroundColor,inner:getComputedStyle(code).backgroundColor,color:getComputedStyle(code).color};
          });
          results.push({width,selector,codes});
        }
        const command=document.querySelector('.tool-command');results.push({width,command:getComputedStyle(command).backgroundColor});
      }
      document.getElementById('results').textContent=JSON.stringify(results);
    </script>`);
    const dom=execFileSync(process.env.HERMES_TEST_CHROME,['--headless','--no-sandbox','--disable-gpu','--force-dark-mode',`--user-data-dir=${join(folder,'profile')}`,'--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:30000,maxBuffer:2_000_000,stdio:['ignore','pipe','pipe']});
    const match=/<pre id="results" hidden="">(.*?)<\/pre>/.exec(dom);assert.ok(match,'browser completed computed-color checks');
    const results=JSON.parse(match[1]);
    for(const row of results){
      if(row.command){assert.equal(row.command,'rgb(245, 245, 250)',`tool command at ${row.width}`);continue;}
      assert.equal(row.codes.length,5,`${row.selector} contains inline, two fences, indented and table code`);
      assert.equal(row.codes.filter(code=>code.block).length,3);
      assert.ok(row.codes.some(code=>code.text==='echo single\n'));
      assert.ok(row.codes.some(code=>code.text==='first line\nsecond line\n'));
      for(const code of row.codes){assert.equal(code.background,'rgb(245, 245, 250)',`${row.width} ${row.selector} ${code.text}`);assert.equal(code.color,'rgb(32, 49, 74)');if(code.block)assert.equal(code.inner,'rgba(0, 0, 0, 0)','nested code must not create a second surface');}
    }
    if(process.env.HERMES_CODE_BACKGROUND_EVIDENCE){const out=process.env.HERMES_CODE_BACKGROUND_EVIDENCE;await mkdir(out,{recursive:true});await writeFile(join(out,'computed-backgrounds.json'),JSON.stringify(results,null,2)+'\n');}
  }finally{await rm(folder,{recursive:true,force:true});}
});
