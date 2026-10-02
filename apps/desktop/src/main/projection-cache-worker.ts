import {Worker} from 'node:worker_threads';
import {join} from 'node:path';
import type {ClientCheckpoint,Message} from '@hermes-app/client';

export class CacheStorageError extends Error {
  constructor() { super('Local conversation cache is unavailable.'); this.name='CacheStorageError'; }
}

/** SQLite work never runs on the renderer or Electron main event loop. */
export class ProjectionCacheWorker {
  private readonly worker:Worker;
  private sequence=0;
  private closed=false;
  private readonly pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void}>();
  constructor(path:string,identity:string,workerPath=join(__dirname,'cache-worker.cjs')) {
    this.worker=new Worker(workerPath,{workerData:{path,identity}});
    const fail=()=>{
      this.closed=true;
      for(const job of this.pending.values())job.reject(new CacheStorageError());
      this.pending.clear();
    };
    this.worker.on('error',fail);this.worker.on('exit',fail);
    this.worker.on('message',(reply:{id:number;result?:unknown;error?:boolean})=>{
      const job=this.pending.get(reply.id);if(!job)return;
      this.pending.delete(reply.id);
      if(reply.error)job.reject(new CacheStorageError());else job.resolve(reply.result);
    });
  }
  private request<T>(operation:string,fields:Record<string,unknown>={}):Promise<T> {
    if(this.closed)return Promise.reject(new Error('Local conversation cache is closed.'));
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{resolve:value=>resolve(value as T),reject});
      try {this.worker.postMessage({id,operation,...fields})}
      catch {this.pending.delete(id);reject(new CacheStorageError())}
    });
  }
  load():Promise<ClientCheckpoint|null>{return this.request('load')}
  save(value:ClientCheckpoint):Promise<{changed:number;removed:number}>{return this.request('save',{value})}
  history(threadId:string,before?:number,limit=50):Promise<Message[]>{return this.request('history',{threadId,before,limit})}
  clear():Promise<void>{return this.request('clear')}
  async close():Promise<void>{
    if(this.closed)return;
    try{await this.request('close')}
    finally{this.closed=true;await this.worker.terminate()}
  }
}
