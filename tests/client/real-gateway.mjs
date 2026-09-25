import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,rm,open,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {HermesClient} from '../../packages/client/dist/index.js';
import {desktopTransport} from './desktop/transport.mjs';
import {mobileTransport} from './mobile/transport.js';
const root=path.resolve('.');
const baseline=process.env.HERMES_BASELINE || '/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline';
const scratch=process.env.TMPDIR || '/home/hermes/.hermes/profiles/jamie/cache/scratch';
const evidence=process.env.P105_EVIDENCE_DIR || '/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/p1-05';
const require=createRequire(path.join(root,'package.json'));
const WS=require('ws');
const token='synthetic-p1-test-token-with-32-characters';
const home=await mkdtemp(path.join(scratch,'hermes-app-p1-05-real-'));
await mkdir(path.join(home,'h'));
await mkdir(evidence,{recursive:true});
const env={PATH:process.env.PATH,HOME:home,HERMES_HOME:path.join(home,'h'),XDG_CONFIG_HOME:path.join(home,'x'),XDG_DATA_HOME:path.join(home,'d'),TMPDIR:scratch,PYTHONPATH:baseline,PYTHONDONTWRITEBYTECODE:'1',PYTHONNOUSERSITE:'1',TIRITH_ENABLED:'false',HERMES_APP_TOKEN:token,HERMES_APP_ALLOWED_USERS:'owner',LANG:'C.UTF-8',HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',NO_PROXY:'localhost,127.0.0.1,::1'};
let proc,log;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function start(phase){
  const logPath=path.join(home,'child-'+phase+'.log'); log=await open(logPath,'w');
  proc=spawn(path.join(baseline,'.venv/bin/python'),[path.join(root,'tests/p1/delivery_child.py')],{cwd:root,env,stdio:['ignore',log.fd,log.fd]});
  for(let i=0;i<700;i++) { if(proc.exitCode!==null) throw Error('Gateway child exited: '+proc.exitCode+'; '+(await readFile(logPath,'utf8')).slice(-3000));
    try {const info=JSON.parse(await readFile(path.join(home,'h','ready.json'),'utf8')); assert.equal(info.hook_order_verified,true);return 'http://127.0.0.1:'+info.port} catch(e){if(e.code!=='ENOENT' && !(e instanceof SyntaxError)) throw e} await delay(50) }
  throw Error('Gateway readiness timeout; '+(await readFile(logPath,'utf8')).slice(-3000));
}
async function stop(){if(proc?.exitCode===null){proc.kill('SIGTERM'); await Promise.race([new Promise(r=>proc.once('exit',r)),delay(5000)]);if(proc.exitCode===null)proc.kill('SIGKILL')} await log?.close();}
async function until(fn,timeout=30000){const end=Date.now()+timeout;let last;while(Date.now()<end){try {const value=await fn();if(value)return value}catch(e){last=e}await delay(100)}throw Error('condition timeout '+String(last||''))}
class RNWebSocketShim {constructor(url,_protocols,options){this.inner=new WS(url,{headers:options.headers});this.inner.on('open',()=>this.onopen?.());this.inner.on('message',d=>this.onmessage?.({data:String(d)}));this.inner.on('close',()=>this.onclose?.());this.inner.on('error',()=>this.onerror?.())}close(){this.inner.close()}}
let desktop,mobile;let result;
try {
  const url=await start('one');
  desktop=new HermesClient({...desktopTransport(url),token:()=>token,onError:e=>{throw e}});
  mobile=new HermesClient({...mobileTransport(url,RNWebSocketShim,fetch),token:()=>token,onError:e=>{throw e}});
  assert.equal((await fetch(url+'/v1/capabilities')).status,401);
  assert.equal((await desktop.capabilities()).protocol,1);
  assert.equal((await mobile.capabilities()).protocol,1);
  const channel=await desktop.createChannel('P105 synthetic channel','Synthetic description');
  assert.ok((await desktop.listChannels()).some(c=>c.id===channel.id));
  assert.ok((await mobile.listChannels()).some(c=>c.id===channel.id));
  const thread=await desktop.createThread(channel.id,'P105 first');
  const other=await mobile.createThread(channel.id,'P105 second');
  await desktop.snapshot(); await mobile.snapshot();
  await desktop.connect(); await mobile.connect();
  await until(()=>desktop.socket && mobile.socket);
  const cid='desktop-001'; const accepted=await desktop.send(thread.id,cid,'P105_SYNTHETIC_DESKTOP');
  assert.equal(accepted.durable,true);
  const duplicate=await mobile.send(thread.id,cid,'P105_SYNTHETIC_DESKTOP'); assert.equal(duplicate.id,accepted.id);
  await assert.rejects(mobile.send(thread.id,cid,'P105_CHANGED_PAYLOAD'),/HTTP 409/);
  await until(async()=>['completed','failed','interrupted','unknown'].includes((await mobile.getReceipt(accepted.id)).state));
  assert.equal((await desktop.getReceipt(accepted.id)).state,'completed');
  await until(async()=>{await mobile.catchUp();await mobile.history(thread.id);return mobile.messages.get(thread.id)?.some(m=>m.role==='assistant' && m.text.includes('SYNTHETIC_P1_FINAL'))});
  const before=mobile.messages.get(thread.id).map(m=>({role:m.role,text:m.text,ref_seq:m.ref_seq}));
  const last=before.at(-1).ref_seq; await mobile.markRead(thread.id,last);
  assert.equal(await desktop.markRead(thread.id,last),last);
  desktop.close();mobile.close();
  await desktop.connect();await mobile.connect();
  await until(()=>desktop.socket && mobile.socket);
  await desktop.catchUp();await mobile.catchUp();
  assert.equal(desktop.threads.get(thread.id).read_ref,last);
  desktop.close();mobile.close();
  await stop();
  await rm(path.join(home,'h','ready.json'));
  const url2=await start('two');
  desktop=new HermesClient({...desktopTransport(url2),token:()=>token});
  mobile=new HermesClient({...mobileTransport(url2,RNWebSocketShim,fetch),token:()=>token});
  await desktop.snapshot();await mobile.snapshot();await desktop.catchUp();await mobile.catchUp();
  await desktop.history(thread.id);await mobile.history(thread.id);
  assert.deepEqual(desktop.messages.get(thread.id),mobile.messages.get(thread.id));
  assert.equal((await mobile.send(thread.id,cid,'P105_SYNTHETIC_DESKTOP')).id,accepted.id);
  const second=await mobile.send(other.id,'mobile-001','P1_BLOCK');
  await until(async()=>{const lines=(await readFile(path.join(home,'h','model-requests.jsonl'),'utf8')).trim().split('\n');return lines.some(line=>JSON.parse(line).blocked===true)});
  desktop.close();mobile.close();
  await writeFile(path.join(home,'h','model-release'),'release\n');
  desktop=new HermesClient({...desktopTransport(url2),token:()=>token});
  mobile=new HermesClient({...mobileTransport(url2,RNWebSocketShim,fetch),token:()=>token});
  await desktop.snapshot();await mobile.snapshot();
  await until(async()=>['completed','failed','interrupted','unknown'].includes((await desktop.getReceipt(second.id)).state));
  assert.equal((await mobile.getReceipt(second.id)).state,'completed');
  await desktop.catchUp();await mobile.catchUp();await desktop.history(other.id);await mobile.history(other.id);
  assert.deepEqual(desktop.messages.get(other.id),mobile.messages.get(other.id));
  assert.equal(desktop.threads.get(thread.id).read_ref,last);
  result={baseline:'2f16a1aa5a35feec496949abdef7ad51aea0e7ef',desktop_client:'Node HTTP + ws',mobile_client:'React Native transport shape with Node ws shim',channel:channel.id,threads:[thread.id,other.id],duplicate_receipt:accepted.id,second_receipt:second.id,states:['completed','completed'],first_history:before,second_history:mobile.messages.get(other.id),read_ref:last,same_instance_reconnect:true,restart_replay:true,offline_execution:true,device_runtime:false};
  await writeFile(path.join(evidence,'real-gateway.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({ok:true,threads:2,receipts:2,same_instance_reconnect:true,restart_replay:true,offline_execution:true,evidence:path.join(evidence,'real-gateway.json')}));
} finally {desktop?.close();mobile?.close();await stop();if(!process.env.P105_KEEP_CHILD)await rm(home,{recursive:true,force:true})}
