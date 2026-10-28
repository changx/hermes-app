import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({entryPoints:[new URL('../src/index.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',write:false});
const module={exports:{}}; new Function('module','exports',bundle.outputFiles[0].text)(module,module.exports);
const {HermesClient,attachmentPageUrl,validSitePath}=module.exports;

const ID='att_'+'a'.repeat(32), SITE='/media/'+ID+'/site/report.html';
const client=body=>new HermesClient({token:()=>'synthetic',requestTimeoutMs:200,http:{request:async()=>({status:200,body})},socket:{connect:async()=>{throw new Error('offline');}}});

test('an HTML attachment page link is built from the connection server, not from server config',()=>{
  const page={id:ID,state:'available',site_path:SITE};
  assert.equal(attachmentPageUrl('https://agent.tuly.space',page),'https://agent.tuly.space'+SITE);
  assert.equal(attachmentPageUrl('https://hermes-jamie.tuly.space/',page),'https://hermes-jamie.tuly.space'+SITE);
  assert.equal(attachmentPageUrl('http://127.0.0.1:9790',page),'http://127.0.0.1:9790'+SITE);
  // No server, a plain-http remote server, an unavailable file or an ordinary file: no page link.
  for (const server of [undefined,null,'','http://example.com','https://u:p@example.com','javascript:alert(1)']) assert.equal(attachmentPageUrl(server,page),undefined,String(server));
  assert.equal(attachmentPageUrl('https://agent.tuly.space',{...page,state:'missing'}),undefined);
  assert.equal(attachmentPageUrl('https://agent.tuly.space',{id:ID,state:'available'}),undefined);
});

test('a site path must name this attachment and one HTML page inside its own folder',()=>{
  assert.equal(validSitePath(ID,SITE),SITE);
  assert.equal(validSitePath(ID,'/media/'+ID+'/site/AI%20%E5%A5%B3%E5%8F%8B.htm'),'/media/'+ID+'/site/AI%20%E5%A5%B3%E5%8F%8B.htm');
  const other='att_'+'b'.repeat(32);
  for (const bad of ['/media/'+other+'/site/report.html','/media/'+ID+'/report.html','/media/'+ID+'/site/','/media/'+ID+'/site/a/b.html',
    '/media/'+ID+'/site/..','/media/'+ID+'/site/%2E%2E','/media/'+ID+'/site/a%2Fb.html','/media/'+ID+'/site/a%5Cb.html',
    '/media/'+ID+'/site/report.pdf','/media/'+ID+'/site/%E0%A4%A.html','https://evil.example/media/'+ID+'/site/x.html',
    '/media/'+ID+'/site/x.html?x=1','/media/'+ID+'/site/x.html#t',42,undefined]) assert.equal(validSitePath(ID,bad),undefined,String(bad));
  assert.equal(validSitePath('att_bad',SITE),undefined);
});

test('history attachments keep a valid site path and drop an invalid one',async()=>{
  const sdk=client({attachment:{id:ID,thread_id:'T',name:'report.html',mime:'application/octet-stream',size:59259,state:'available',receipt_id:null,site_path:SITE}});
  assert.equal((await sdk.getAttachment('T',ID)).site_path,SITE);
  const bad=client({attachment:{id:ID,thread_id:'T',name:'report.html',mime:'application/octet-stream',size:1,state:'available',receipt_id:null,site_path:'/media/'+ID+'/site/../x.html'}});
  const parsed=await bad.getAttachment('T',ID);
  assert.equal(parsed.site_path,undefined); assert.equal(parsed.name,'report.html');
});
