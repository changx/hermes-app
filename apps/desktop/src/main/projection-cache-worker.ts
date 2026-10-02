import {Worker} from 'node:worker_threads';
import {join} from 'node:path';
import type {ClientCheckpoint,Message} from '@hermes-app/client';

export class CacheStorageError extends Error {
  constructor(message='Local conversation cache is unavailable.') { super(message); this.name='CacheStorageError'; }
}

/** SQLite work never runs on the renderer or Electron main event loop. */
export class ProjectionCacheWorker {
  private readonly worker:Worker;
  private sequence=0;
  private closed=false;
  get isClosed():boolean{return this.closed}
  private closing:Promise<void>|undefined;
  private readonly pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  constructor(path:string,identity:string,workerPath=join(__dirname,'cache-worker.cjs'),private readonly requestTimeoutMs=15_000) {
    this.worker=new Worker(workerPath,{workerData:{path,identity}});
    const fail=()=>{
      this.closed=true;
      for(const job of this.pending.values()){clearTimeout(job.timer);job.reject(new CacheStorageError())}
      this.pending.clear();
    };
    this.worker.on('error',fail);this.worker.on('exit',fail);
    this.worker.on('message',(reply:{id:number;result?:unknown;error?:boolean})=>{
      const job=this.pending.get(reply.id);if(!job)return;
      clearTimeout(job.timer);
      this.pending.delete(reply.id);
      if(reply.error)job.reject(new CacheStorageError());else job.resolve(reply.result);
    });
  }
  private request<T>(operation:string,fields:Record<string,unknown>={}):Promise<T> {
    if(this.closed || this.closing && operation!=='close')return Promise.reject(new CacheStorageError('Local conversation cache is closed.'));
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        this.closed=true;
        for(const job of this.pending.values()){clearTimeout(job.timer);job.reject(new CacheStorageError())}
        this.pending.clear();void this.worker.terminate();
      },this.requestTimeoutMs);
      this.pending.set(id,{resolve:value=>resolve(value as T),reject,timer});
      try {this.worker.postMessage({id,operation,...fields})}
      catch {clearTimeout(timer);this.pending.delete(id);reject(new CacheStorageError())}
    });
  }
  load():Promise<ClientCheckpoint|null>{return this.request('load')}
  save(value:ClientCheckpoint):Promise<{changed:number;removed:number}>{return this.request('save',{value})}
  history(threadId:string,before?:number,limit=50):Promise<Message[]>{return this.request('history',{threadId,before,limit})}
  clear():Promise<void>{return this.request('clear')}
  close():Promise<void>{
    if(this.closing)return this.closing;
    if(this.closed)return Promise.resolve();
    this.closing=this.request<void>('close').finally(async()=>{this.closed=true;await this.worker.terminate()});
    return this.closing;
  }
}
