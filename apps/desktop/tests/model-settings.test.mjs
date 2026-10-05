import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const bundle = await build({entryPoints:[new URL('../src/main/connection-service.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',external:['electron'],write:false});
const module = {exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const {DesktopConnectionService} = module.exports;
const original = {scope:'connected-default',provider:'codex',model:'old',providers:[{id:'codex',name:'Codex',models:['old','new']}]};
const saved = {...original,model:'new'};
function fixture() {
  const calls = [];
  const service = new DesktopConnectionService(()=>{});
  service.connection = {id:'device-a'};
  service.client = {getModelSettings:async()=>{calls.push('read');return saved;},setModelSettings:async(...args)=>{calls.push(args);return saved;}};
  return {service,calls};
}
test('model default saves through SDK then reads exact target back',async()=>{
  const {service,calls}=fixture();
  assert.deepEqual(await service.setModelSettings('device-a','codex','new',false),saved);
  assert.deepEqual(calls,[['codex','new',undefined,false],'read']);
});
test('model warning is not accepted or persisted implicitly',async()=>{
  const {service,calls}=fixture();const warning={confirmation_required:true,warning:'Cost warning',provider:'codex',model:'new'};
  service.client.setModelSettings=async(...args)=>{calls.push(args);return warning;};
  assert.deepEqual(await service.setModelSettings('device-a','codex','new',false),warning);
  assert.deepEqual(calls,[['codex','new',undefined,false]]);
});
test('model confirmation flag reaches native SDK',async()=>{
  const {service,calls}=fixture();await service.setModelSettings('device-a','codex','new',true);assert.equal(calls[0][3],true);
});
test('stale identity rejected before read or write',async()=>{
  const {service,calls}=fixture();await assert.rejects(service.getModelSettings('device-b'),/Connection changed/);await assert.rejects(service.setModelSettings('device-b','codex','new',false),/Connection changed/);assert.deepEqual(calls,[]);
});
test('connection replacement during read rejects late response',async()=>{
  const {service}=fixture();service.client.getModelSettings=async()=>{service.connection={id:'device-b'};return saved;};await assert.rejects(service.getModelSettings('device-a'),/Could not load/);
});
test('connection replacement after write never reads new profile',async()=>{
  const {service,calls}=fixture();service.client.setModelSettings=async()=>{service.connection={id:'device-b'};return saved;};await assert.rejects(service.setModelSettings('device-a','codex','new',false),/Reload/);assert.deepEqual(calls,[]);
});
test('readback failure or mismatch does not report a successful save',async()=>{
  for(const read of [async()=>{throw Error('secret diagnostic');},async()=>original]){
    const {service}=fixture();service.client.getModelSettings=read;await assert.rejects(service.setModelSettings('device-a','codex','new',false),error=>/Reload/.test(error.message)&&!error.message.includes('secret'));
  }
});
test('invalid model inputs rejected before mutation',async()=>{
  const {service,calls}=fixture();for(const model of ['', ' ', 'x'.repeat(257), 'bad\nmodel'])await assert.rejects(service.setModelSettings('device-a','codex',model,false));assert.deepEqual(calls,[]);
});
