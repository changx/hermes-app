import { HermesClient, HttpError, ProtocolError, TimeoutError, isRetryableError, type Options, type Socket, type Receipt, type Interaction, type Channel } from './index';
import { parseCatalogue, parseLiveFrame, watchCommand, LiveProtocolError } from './liveProtocol';

const wait=(ms:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
  if(signal.aborted){reject(new Error('aborted'));return}
  const finish=()=>{signal.removeEventListener('abort',abort);resolve()};
  const timer=setTimeout(finish,ms),abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new Error('aborted'))};
  signal.addEventListener('abort',abort,{once:true});
});
const combine=(scope:AbortSignal|undefined,parent:AbortSignal|undefined)=>{
  const controller=new AbortController(),abort=()=>controller.abort();
  for(const signal of [scope,parent]){signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort()}
  return {signal:controller.signal,done:()=>{scope?.removeEventListener('abort',abort);parent?.removeEventListener('abort',abort)}};
};

/** Lightweight account directory + one opened conversation. No history database,
 * event replay, unread reporting, background body cache or business polling. */
export class LiveSessionClient extends HermesClient {
  private readonly liveOptions:Options;
  private liveController:AbortController|null=null;
  private liveSocket:Socket|null=null;
  private attempt:AbortController|null=null;
  private scope=new AbortController();
  private wanted:string|null=null;
  private watchId='0';
  private watchNumber=0;
  private watchReady=false;
  private hello=false;
  private directoryDirty=false;
  private directoryJob:Promise<void>|null=null;
  private contentDirty=false;
  private contentJob:Promise<void>|null=null;
  private opened:{id:string;resolve:()=>void;reject:(error:Error)=>void;promise:Promise<void>}|null=null;
  private directoryReady=false;
  private older:string|null=null;
  private conversationKey:object={};
  get currentOlderCursor():string|null{return this.older}
  get currentThreadId():string|null{return this.wanted}
  get currentConversationKey():object{return this.conversationKey}
  get isCatalogueReady():boolean{return this.directoryReady}
  isThreadAvailable(id:string):boolean{const t=this.threads.get(id);return Boolean(t&&!t.archived&&this.channels.has(t.project_id))}

  constructor(options:Options){
    let self:LiveSessionClient|undefined;
    super({...options,onCheckpoint:undefined,onChange:()=>{self?.prune();options.onChange?.()}});
    this.liveOptions=options;self=this;
  }
  private prune():void{
    this.retainContent(this.wanted);
    // Direct CRUD responses must not leave descriptions/core session metadata
    // resident in the outer directory. Editors read their own temporary detail.
    for(const [id,c]of this.channels)this.channels.set(id,{id,name:c.name});
    for(const [id,t]of this.threads)this.threads.set(id,{id,project_id:t.project_id,title:t.title,archived:t.archived,last_ref:0,read_ref:0,unread_count:0,...(t.last_message_at===undefined?{}:{last_message_at:t.last_message_at}),running:Boolean((t as typeof t&{running?:boolean}).running)});
  }
  private sendWatch():void{
    if(!this.hello||!this.liveSocket?.send)return;
    this.watchReady=false;this.liveSocket.send(watchCommand(this.wanted,this.watchId));
  }
  openConversation(id:string):Promise<void>{
    if(this.wanted===id&&this.opened)return this.opened.promise;
    this.closeConversation();this.wanted=id;this.watchId=String(++this.watchNumber);
    let resolve!:()=>void,reject!:(error:Error)=>void;
    const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no});
    // A cancelled view may have no remaining observer; keep cancellation from
    // becoming an unhandled rejection, while returning the original promise.
    void promise.catch(()=>{});
    this.opened={id,resolve,reject,promise};this.sendWatch();
    if(!this.liveController)void this.connect();
    this.changed();return promise;
  }
  closeConversation():void{
    this.conversationKey={};
    this.scope.abort();this.scope=new AbortController();this.wanted=null;
    this.watchId=String(++this.watchNumber);this.watchReady=false;this.contentDirty=false;this.contentJob=null;
    this.opened?.reject(new Error('aborted'));this.opened=null;this.older=null;this.releaseContent();this.sendWatch();this.changed();
  }
  override async connect():Promise<void>{
    if(this.liveController)return;
    const controller=new AbortController();this.liveController=controller;
    this.state('connecting');void this.runLive(controller);
  }
  override close():void{
    this.liveController?.abort();this.liveController=null;this.attempt?.abort();this.attempt=null;
    this.scope.abort();this.scope=new AbortController();this.liveSocket?.close();this.liveSocket=null;this.hello=false;this.watchReady=false;
    this.directoryJob=null;this.contentJob=null;this.opened?.reject(new Error('aborted'));this.opened=null;this.releaseContent();super.close();this.changed();
  }
  override async retryNow():Promise<void>{this.close();await this.connect()}
  override async snapshot(signal?:AbortSignal):Promise<void>{await this.refreshDirectory(signal)}
  override async catchUp(signal?:AbortSignal):Promise<void>{await this.refreshDirectory(signal);await this.refreshContent()}
  override async resync(signal?:AbortSignal):Promise<void>{await this.catchUp(signal)}
  override async markRead(_id:string,_ref:number):Promise<number>{return 0} // no network/read accounting
  override checkpoint():never{throw new ProtocolError('Live conversations are not persisted')}
  override restoreCheckpoint(_value:unknown):never{throw new ProtocolError('Live conversations are read from the server')}

  /** A matching durable ACK is sufficient to retire the local sending queue.
   * Keep an accepted echo only while this exact conversation is open. */
  rememberAcceptedInput(threadId:string,clientId:string,text:string,attachments:import('./index').Attachment[],createdAt:number|undefined,receipt:Receipt):void{
    if(receipt.thread_id!==threadId||receipt.client_message_id!==clientId||receipt.durable!==true||!Number.isSafeInteger(receipt.ref_seq)||receipt.ref_seq!<=0)throw new ProtocolError('accepted input identity mismatch');
    if(this.wanted!==threadId||!this.watchReady)return;
    const rows=this.messages.get(threadId)||[];
    if(!rows.some(row=>row.client_message_id===clientId)){
      this.messages.set(threadId,[...rows,{id:'receipt:'+receipt.id,ref_seq:receipt.ref_seq!,role:'user',text,client_message_id:clientId,receipt_id:receipt.id,attachments,...(createdAt===undefined?{}:{created_at:createdAt})}].sort((a,b)=>a.ref_seq-b.ref_seq));
    }
    this.storeReceipt(receipt,false);this.changed();
  }
  override async createChannel(name:string,description=''){const result=await super.createChannel(name,description);await this.refreshDirectory(this.attempt?.signal);return result}
  override async updateChannel(id:string,patch:{name?:string;description?:string}){const result=await super.updateChannel(id,patch);await this.refreshDirectory(this.attempt?.signal);return result}
  override async deleteChannel(id:string){await super.deleteChannel(id);await this.refreshDirectory(this.attempt?.signal)}
  override async createThread(id:string,title:string,clientId?:string){const result=await super.createThread(id,title,clientId);await this.refreshDirectory(this.attempt?.signal);return result}
  override async updateThread(id:string,patch:{title?:string;archived?:boolean}){const result=await super.updateThread(id,patch);await this.refreshDirectory(this.attempt?.signal);return result}
  override async archiveThread(id:string){const result=await super.archiveThread(id);await this.refreshDirectory(this.attempt?.signal);return result}

  async getChannelInfo(id:string,signal?:AbortSignal):Promise<Channel>{
    const body=await this.call('GET','/v1/channels/'+encodeURIComponent(id),undefined,signal),raw=body.channel as Record<string,unknown>;
    if(!raw||raw.id!==id||typeof raw.name!=='string'||raw.description!==undefined&&typeof raw.description!=='string')throw new ProtocolError('channel identity mismatch');
    return {id,name:raw.name,...(typeof raw.description==='string'?{description:raw.description}:{})};
  }
  private async refreshDirectory(signal?:AbortSignal):Promise<void>{
    this.directoryDirty=true;
    if(this.directoryJob)return this.directoryJob;
    const owner=this.liveController;
    const job=(async()=>{
      while(this.directoryDirty&&!signal?.aborted){
        this.directoryDirty=false;
        const channels:Channel[]=[],threads:Array<ReturnType<typeof parseCatalogue>['items'][number]>=[];
        const seen=new Set<string>();let after:string|null=null;
        do{
          const page=parseCatalogue(await this.call('GET','/v1/catalogue?limit=30'+(after?'&after='+encodeURIComponent(after):''),undefined,signal));
          for(const item of page.items){const key=item.kind+':'+item.value.id;if(seen.has(key))throw new ProtocolError('duplicate directory identity');seen.add(key);if(item.kind==='channel')channels.push(item.value);else threads.push(item)}
          after=page.next_after;if(after&&seen.has('page:'+after))throw new ProtocolError('directory pagination did not finish');if(after)seen.add('page:'+after);
        }while(after);
        if(signal?.aborted||owner!==this.liveController)throw new Error('aborted');
        this.batchChanges(()=>{
          this.channels.clear();for(const c of channels)this.channels.set(c.id,c);
          this.threads.clear();for(const item of threads)if(item.kind==='session'&&this.channels.has(item.value.project_id)){
            const t=item.value;this.threads.set(t.id,{...t,last_ref:0,read_ref:0,unread_count:0});
          }
          this.directoryReady=true;
          if(this.wanted&&!this.isThreadAvailable(this.wanted))this.closeConversation();
          this.changed();
        });
      }
    })();this.directoryJob=job;
    try{await job}finally{if(this.directoryJob===job)this.directoryJob=null}
  }
  private async refreshContent():Promise<void>{
    const id=this.wanted,watchId=this.watchId;
    if(!id||!this.watchReady||!this.attempt)return;
    this.contentDirty=true;if(this.contentJob)return this.contentJob;
    const scope=this.scope,attempt=this.attempt,linked=combine(scope.signal,attempt.signal);
    const job=(async()=>{
      while(this.contentDirty&&!linked.signal.aborted&&this.wanted===id&&this.watchId===watchId){
        this.contentDirty=false;
        const start=this.messages.get(id)?.[0]?.ref_seq;
        if(start===undefined){const page=await super.historyWindow(id,undefined,30,linked.signal);if(this.wanted===id&&this.watchId===watchId)this.older=page.older_cursor}
        else{
          // References are sparse and owned. Refresh the first exact row,
          // then read forward from that real anchor; never invent start-1.
          await super.history(id,undefined,1,linked.signal,undefined,start);
          let after:string|undefined;const pages=new Set<string>();
          do{const page=await super.history(id,after,100,linked.signal,after?undefined:start);after=page.next_cursor??undefined;if(after&&pages.has(after))throw new ProtocolError('conversation history did not advance');if(after)pages.add(after)}while(after);
        }
        const state=this.decodeScopedState(await this.call('GET','/v1/threads/'+encodeURIComponent(id)+'/live-state',undefined,linked.signal),id);
        if(linked.signal.aborted||this.wanted!==id||this.watchId!==watchId)return;
        this.batchChanges(()=>{
          for(const r of state.receipts)this.storeReceipt(r,false);
          this.interactions.clear();for(const i of state.interactions)if(i.state==='pending')this.interactions.set(i.id,i);
          this.changed();
        });
        this.opened?.resolve();
      }
    })();this.contentJob=job;
    try{await job}finally{linked.done();if(this.contentJob===job)this.contentJob=null}
  }
  private scoped(signal:AbortSignal|undefined,id:string){return combine(id===this.wanted?this.scope.signal:undefined,signal)}
  override async history(id:string,after?:string,limit=50,signal?:AbortSignal,afterRef?:number,ref?:number){if((id!==this.wanted&&(ref===undefined||limit!==1))||(id===this.wanted&&!this.watchReady&&ref===undefined))throw new ProtocolError('Conversation is not open');const s=this.scoped(signal,id);try{const page=await super.history(id,after,limit,s.signal,afterRef,ref);if(id!==this.wanted&&page.messages.some(m=>m.role!=='user'||!m.client_message_id||!m.receipt_id))throw new ProtocolError('Expected accepted input proof');return page}finally{s.done();this.prune()}}
  override async historyWindow(id:string,before?:string,limit=30,signal?:AbortSignal){if(id!==this.wanted||!this.watchReady)throw new ProtocolError('Conversation is not open');const s=this.scoped(signal,id);try{return await super.historyWindow(id,before,limit,s.signal)}finally{s.done();this.prune()}}
  override async historyTail(id:string,signal?:AbortSignal){if(id!==this.wanted||!this.watchReady)throw new ProtocolError('Conversation is not open');return super.historyTail(id,signal)}
  override async search(id:string,text:string,after?:string,limit=20,signal?:AbortSignal){if(id!==this.wanted||!this.watchReady)throw new ProtocolError('Conversation is not open');const s=this.scoped(signal,id);try{return await super.search(id,text,after,limit,s.signal)}finally{s.done()}}
  override async getInteraction(id:string,key:string,signal?:AbortSignal){if(id!==this.wanted)throw new ProtocolError('Conversation is not open');const s=this.scoped(signal,id);try{return await super.getInteraction(id,key,s.signal)}finally{s.done()}}
  override async answerInteraction(item:Interaction,choice:string){if(item.thread_id!==this.wanted||!this.watchReady)throw new ProtocolError('Conversation is not open');return super.answerInteraction(item,choice)}
  override async getAttachment(id:string,key:string,signal?:AbortSignal){if(id!==this.wanted||!this.watchReady)throw new ProtocolError('Conversation is not open');const s=this.scoped(signal,id);try{return await super.getAttachment(id,key,s.signal)}finally{s.done()}}
  override async download(id:string,key:string,signal?:AbortSignal){if(id!==this.wanted||!this.watchReady)throw new ProtocolError('Conversation is not open');const s=this.scoped(signal,id);try{return await super.download(id,key,s.signal)}finally{s.done()}}
  override async upload(id:string,name:string,bytes:Uint8Array,signal?:AbortSignal){const s=this.scoped(signal,id);try{return await super.upload(id,name,bytes,s.signal)}finally{s.done();this.prune()}}

  private async runLive(controller:AbortController):Promise<void>{
    let retries=0;
    try{
      while(!controller.signal.aborted&&this.liveController===controller){
        const attempt=new AbortController(),abort=()=>attempt.abort();controller.signal.addEventListener('abort',abort,{once:true});this.attempt=attempt;
        let openedSocket:Socket|undefined;
        try{
          this.state(retries?'retrying':'connecting');const caps=await this.capabilities(attempt.signal);
          if(caps.open_session_live!==true)throw new ProtocolError('Server does not support scoped live conversations');
          let deadline:ReturnType<typeof setTimeout>|undefined;
          const opening=this.liveOptions.socket.connect('/v1/live',this.token(),attempt.signal);
          void opening.then(s=>{if(attempt.signal.aborted)s.close()},()=>{});
          const socket=await Promise.race([opening,new Promise<Socket>((_,reject)=>{deadline=setTimeout(()=>reject(new TimeoutError('WebSocket connection timed out')),this.liveOptions.connectTimeoutMs??10_000)})]).finally(()=>clearTimeout(deadline));
          openedSocket=socket;
          if(attempt.signal.aborted){socket.close();break}
          if(!socket.send)throw new ProtocolError('Live transport requires send support');
          this.liveSocket=socket;this.hello=false;this.watchId=String(++this.watchNumber);
          await this.watchSocket(socket,attempt,()=>retries=0);
        }catch(error){
          if(controller.signal.aborted)break;
          const value=error instanceof LiveProtocolError?new ProtocolError(error.message):error instanceof Error?error:new Error('Live connection failed');this.liveOptions.onError?.(value);
          if(!isRetryableError(value)){this.state(value instanceof HttpError&&(value.status===401||value.status===403)?'blocked':'suspended');this.opened?.reject(value);break}
        }finally{attempt.abort();controller.signal.removeEventListener('abort',abort);openedSocket?.close();if(this.attempt===attempt){this.liveSocket=null;this.attempt=null;this.hello=false;this.watchReady=false}}
        if(controller.signal.aborted)break;
        this.state('retrying');const delays=this.liveOptions.backoffMs?.length?this.liveOptions.backoffMs:[200,500,1000,2000,5000];
        try{await wait(delays[Math.min(retries++,delays.length-1)],controller.signal)}catch{break}
      }
    }finally{if(this.liveController===controller)this.liveController=null}
  }
  private watchSocket(socket:Socket,attempt:AbortController,stable:()=>void):Promise<void>{
    return new Promise((resolve,reject)=>{
      let finished=false,awaitingPong=false;
      const interval=this.liveOptions.livenessMs??10_000;
      let ping:ReturnType<typeof setInterval>|undefined,pong:ReturnType<typeof setTimeout>|undefined;
      const handshake=setTimeout(()=>finish(new TimeoutError('hello timed out')),this.liveOptions.connectTimeoutMs??10_000);
      const finish=(error?:unknown)=>{if(finished)return;finished=true;clearTimeout(handshake);clearTimeout(pong);clearInterval(ping);attempt.signal.removeEventListener('abort',abort);attempt.abort();socket.close();if(error)reject(error);else resolve()};
      const abort=()=>finish();attempt.signal.addEventListener('abort',abort,{once:true});
      const failure=(error:unknown)=>{if(!attempt.signal.aborted&&!(error instanceof Error&&error.message==='aborted'))finish(error)};
      socket.onClose(()=>finish());
      socket.onMessage(data=>{
        if(finished)return;
        try{
          if(data==='pong'){if(!this.hello)throw new ProtocolError('pong before hello');awaitingPong=false;clearTimeout(pong);stable();return}
          const frame=parseLiveFrame(JSON.parse(data));
          if(frame.type==='hello'){
            if(this.hello)throw new ProtocolError('duplicate live hello');this.hello=true;clearTimeout(handshake);this.state('syncing');this.sendWatch();
            void this.refreshDirectory(attempt.signal).then(()=>{if(!attempt.signal.aborted)this.state('online')},failure);
            ping=setInterval(()=>{if(awaitingPong||finished)return;awaitingPong=true;pong=setTimeout(()=>finish(new TimeoutError('WebSocket liveness timed out')),interval);try{socket.send!('ping')}catch(error){finish(error)}},interval);
          }else if(!this.hello)throw new ProtocolError('live notification before hello');
          else if(frame.type==='directory_changed')void this.refreshDirectory(attempt.signal).catch(failure);
          else if(frame.type==='session_state'){
            const t=this.threads.get(frame.thread_id);
            if(t){this.threads.set(t.id,{...t,running:frame.running});this.changed()}
            else void this.refreshDirectory(attempt.signal).catch(failure);
          }else if(frame.request_id===this.watchId&&frame.thread_id===this.wanted){
            if(frame.type==='unavailable'){this.opened?.reject(new HttpError(404));this.closeConversation();void this.refreshDirectory(attempt.signal).catch(failure)}
            else{if(frame.type==='watching')this.watchReady=true;void this.refreshContent().catch(failure)}
          }
        }catch(error){finish(error)}
      });
      if(attempt.signal.aborted)finish();
    });
  }
}
