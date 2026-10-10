import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({entryPoints:[new URL('../src/liveClient.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',write:false});
const module={exports:{}}; new Function('module','exports',bundle.outputFiles[0].text)(module,module.exports);
const {LiveSessionClient}=module.exports;

const client=channel=>new LiveSessionClient({token:()=> 'synthetic',onChange:()=>{},
  socket:{connect:async()=>{throw Error('no socket expected');}},
  http:{request:async(method,path)=>{assert.equal(method,'GET');assert.equal(path,'/v1/channels/p_one');return {status:200,body:{channel}};}}});

test('channel info keeps the bound primary folder for save readback', async () => {
  const info=await client({id:'p_one',name:'One',description:'d',bound_primary_path:'/opt/projects/one',primary_path:'/opt/projects/one'}).getChannelInfo('p_one');
  assert.deepEqual(info,{id:'p_one',name:'One',description:'d',bound_primary_path:'/opt/projects/one'});
});

test('channel info reports an unbound folder as null and omits it on older servers', async () => {
  assert.equal((await client({id:'p_one',name:'One',bound_primary_path:null}).getChannelInfo('p_one')).bound_primary_path,null);
  assert.equal('bound_primary_path' in await client({id:'p_one',name:'One'}).getChannelInfo('p_one'),false);
});

test('channel info rejects a malformed primary folder', async () => {
  await assert.rejects(client({id:'p_one',name:'One',bound_primary_path:7}).getChannelInfo('p_one'),/primary path/);
});
