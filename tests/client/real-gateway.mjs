import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,rm,open,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {HermesClient} from '../../packages/client/dist/index.js';
import {desktopTransport} from './desktop/transport.mjs';
import {mobileTransport} from './mobile/transport.js';
import {randomBytes, randomUUID} from 'node:crypto';
import {MobileOutbox, OutboxStore} from '../../apps/mobile/src/outbox.ts';
import {newSend} from '../../apps/mobile/src/send.ts';
import {newPairing, completePairing, PAIRING_KEY} from '../../apps/mobile/src/pairing.ts';
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
const env={PATH:process.env.PATH,HOME:home,HERMES_HOME:path.join(home,'h'),XDG_CONFIG_HOME:path.join(home,'x'),XDG_DATA_HOME:path.join(home,'d'),TMPDIR:scratch,PYTHONPATH:baseline,PYTHONDONTWRITEBYTECODE:'1',PYTHONNOUSERSITE:'1',TIRITH_ENABLED:'false',HERMES_APP_TOKEN:token,HERMES_APP_ALLOWED_USERS:'owner',P1_04:'1',P1_PACKAGED_PLUGIN_DIR:process.env.P1_PACKAGED_PLUGIN_DIR||'',LANG:'C.UTF-8',HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',NO_PROXY:'localhost,127.0.0.1,::1'};
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
// Real local Gateway/plugin and real SDK/outbox. Storage is an explicit SecureStore
// contract double; network faults are injected. This is not an iPhone runtime test.
async function verifyMobileRecovery(url, channelId) {
  const store={data:new Map(),async getItemAsync(k){return this.data.get(k)??null},async setItemAsync(k,v){assert.match(k,/^[\w.-]+$/);this.data.set(k,v)},async deleteItemAsync(k){this.data.delete(k)}};
  const grant=JSON.parse(execFileSync(path.join(baseline,'.venv/bin/python'),['scripts/device-pairing.py','--base',url,'grant'],{cwd:root,env:{...process.env,HERMES_APP_TOKEN:token},encoding:'utf8'}));
  const pending=newPairing('https://synthetic-device.test',grant.code,'Synthetic mobile',randomUUID(),randomBytes(44));
  let droppedPairAck=false;
  const config=await completePairing(pending,{store,signal:new AbortController().signal,delayMs:1,fetcher:async(target,init)=>{
    assert.ok(store.data.has(PAIRING_KEY));
    const reply=await fetch(url+new URL(target).pathname,init);
    if(target.endsWith('/exchange')&&reply.status===201&&!droppedPairAck){droppedPairAck=true;await reply.text();throw new TypeError('synthetic lost pairing ACK')}
    return reply;
  }});
  assert.ok(droppedPairAck);
  const thread=await desktop.createThread(channelId,'Synthetic network recovery');
  let offline=true,droppedSendAck=false,posts=0;
  const wire=desktopTransport(url);
  const http={request:async(...args)=>{
    if(offline)throw new TypeError('synthetic offline');
    if(args[0]==='POST'&&args[1].endsWith('/messages'))posts++;
    const reply=await wire.http.request(...args);
    if(args[0]==='POST'&&args[1].endsWith('/messages')&&!droppedSendAck){droppedSendAck=true;throw new TypeError('synthetic lost send ACK')}
    return reply;
  }};
  let box;const sdk=new HermesClient({...wire,http,token:()=>config.token,backoffMs:[5,10],livenessMs:100,
    onChange:()=>box?.reconcile(),onConnectionState:s=>box?.setConnection(s)});
  const original=newSend(config,thread.id,'SYNTHETIC_RELIABLE_SEND','mob_'+randomUUID());
  box=new MobileOutbox(new OutboxStore(store,config),sdk,()=>{});
  let poll;
  try {
    await box.start();await sdk.connect();await box.enqueue(original);
    assert.equal(posts,0);assert.equal(box.records.length,1);
    offline=false;
    poll=setInterval(()=>box.reconcile(),20);
    await until(()=>sdk.connectionState==='online');
    await until(()=>[...sdk.receipts.values()].some(r=>r.client_message_id===original.clientMessageId&&r.state==='completed'));
    await until(()=>box.records.length===0);
    await sdk.historyAll(thread.id);
    assert.equal(sdk.messages.get(thread.id).filter(m=>m.client_message_id===original.clientMessageId).length,1);
    assert.equal(sdk.messages.get(thread.id).filter(m=>m.role==='assistant').length,1);
    assert.ok(posts>=2&&droppedSendAck);
    const rid=[...sdk.receipts.values()].find(r=>r.client_message_id===original.clientMessageId).id;
    sdk.close();await box.stop();clearInterval(poll);
    const coldSdk=new HermesClient({...wire,token:()=>config.token});
    const coldBox=new MobileOutbox(new OutboxStore(store,config),coldSdk,()=>{});
    try {await coldBox.start();assert.equal(coldBox.records.length,0);assert.equal((await coldSdk.getReceipt(rid)).state,'completed');}
    finally {await coldBox.stop();coldSdk.close()}
    return {thread_id:thread.id,pairing_ack_loss:true,offline_enqueue:true,send_ack_loss:true,single_user_message:true,single_assistant_reply:true,cold_store_recovery:true,device_runtime:false};
  } finally {clearInterval(poll);sdk.close();await box.stop()}
}
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
  await desktop.updateChannel(channel.id,{name:'M1 channel edited',description:'Updated new-thread context'});
  assert.equal((await mobile.listChannels()).find(c=>c.id===channel.id).description,'Updated new-thread context');
  const thread=await desktop.createThread(channel.id,'P105 first');
  const other=await mobile.createThread(channel.id,'P105 second');
  await desktop.updateThread(thread.id,{title:'M1 topic edited'});
  assert.equal((await mobile.getThread(thread.id)).title,'M1 topic edited');
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
  const latest=await mobile.historyWindow(thread.id,undefined,1);
  assert.equal(latest.messages.length,1);
  assert.equal(latest.messages[0].role,'assistant');
  assert.ok(latest.older_cursor);
  const older=await mobile.historyWindow(thread.id,latest.older_cursor,1);
  assert.equal(older.messages[0].receipt_id,accepted.id);
  assert.equal(older.messages[0].client_message_id,cid);
  assert.equal(older.messages[0].role,'user');
  const approval=await desktop.send(thread.id,'approval-cold-1','P1_APPROVAL');
  await until(async()=>{await desktop.catchUp();return [...desktop.interactions.values()].find(i=>i.receipt_id===approval.id&&i.state==='pending')});
  const lateMobile=new HermesClient({...mobileTransport(url,RNWebSocketShim,fetch),token:()=>token});
  await lateMobile.snapshot();await lateMobile.catchUp();
  const pending=[...lateMobile.interactions.values()].find(i=>i.receipt_id===approval.id);
  assert.ok(pending?.id&&pending.generation&&pending.prompt);
  const competing=await Promise.allSettled([desktop.answerInteraction(desktop.interactions.get(pending.id),'deny'),lateMobile.answerInteraction(pending,'deny')]);
  assert.equal(competing.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(competing.filter(x=>x.status==='rejected').length,1);
  await until(async()=>{await desktop.catchUp();return !desktop.interactions.has(pending.id)});
  await lateMobile.catchUp();assert.equal(lateMobile.interactions.has(pending.id),false);
  await until(async()=>(await desktop.getReceipt(approval.id)).state==='completed');
  const bytes=new TextEncoder().encode('P1 attachment from desktop');
  const uploaded=await desktop.upload(thread.id,'from-desktop.txt',bytes);
  const attached=await desktop.send(thread.id,'attachment-cold-1','Read attached file',[uploaded.id]);
  assert.equal((await mobile.send(thread.id,'attachment-cold-1','Read attached file',[uploaded.id])).id,attached.id);
  await until(async()=>(await desktop.getReceipt(attached.id)).state==='completed');
  const coldMobile=new HermesClient({...mobileTransport(url,RNWebSocketShim,fetch),token:()=>token});
  await coldMobile.snapshot();await coldMobile.catchUp();await coldMobile.historyAll(thread.id);
  assert.ok(coldMobile.messages.get(thread.id).some(m=>m.role==='user'&&m.attachments?.some(a=>a.id===uploaded.id)),JSON.stringify(coldMobile.messages.get(thread.id)));
  assert.deepEqual(await coldMobile.download(thread.id,uploaded.id),bytes);
  assert.ok((await coldMobile.search(thread.id,'Read attached file')).messages.some(m=>m.role==='user'));
  const unused=await mobile.upload(thread.id,'unused.txt',new TextEncoder().encode('unused'));
  await mobile.deleteUnattached(thread.id,unused.id);
  assert.equal((await desktop.getAttachment(thread.id,unused.id)).state,'deleted');
  const held=await desktop.send(other.id,'stop-held-1','P1_HOLD_TOOL');
  await until(async()=>{try{await readFile(path.join(home,'h','hold-entered'));return true}catch{return false}});
  const queued=await mobile.send(other.id,'cancel-queued-1','queued after hold');
  assert.equal((await mobile.cancelQueued(other.id,queued.id)).state,'interrupted');
  assert.equal(await mobile.stop(other.id),true);
  await until(async()=>['interrupted','unknown'].includes((await desktop.getReceipt(held.id)).state));
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
  const mobileRecovery=await verifyMobileRecovery(url2,channel.id);
  result={mobile_recovery:mobileRecovery,baseline:'2f16a1aa5a35feec496949abdef7ad51aea0e7ef',desktop_client:'Node HTTP + ws',mobile_client:'React Native transport shape with Node ws shim',packaged_plugin_loader:Boolean(process.env.P1_PACKAGED_PLUGIN_DIR),channel:channel.id,threads:[thread.id,other.id,mobileRecovery.thread_id],duplicate_receipt:accepted.id,second_receipt:second.id,states:['completed','completed'],first_history:before,second_history:mobile.messages.get(other.id),read_ref:last,same_instance_reconnect:true,restart_replay:true,offline_execution:true,delayed_approval_bootstrap:true,competing_answers_one_winner:true,attachment_cold_download:true,cancel_stop_search:true,latest_older_and_send_identity:true,channel_topic_edit:true,device_runtime:false};
  await writeFile(path.join(evidence,'real-gateway.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({ok:true,threads:result.threads.length,mobile_recovery:mobileRecovery,packaged_plugin_loader:result.packaged_plugin_loader,competing_answers_one_winner:true,same_instance_reconnect:true,restart_replay:true,offline_execution:true,evidence:path.join(evidence,'real-gateway.json')}));
} finally {desktop?.close();mobile?.close();await stop();if(!process.env.P105_KEEP_CHILD)await rm(home,{recursive:true,force:true})}
