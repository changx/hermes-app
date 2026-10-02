import {parentPort,workerData} from 'node:worker_threads';
import {mkdirSync,openSync,closeSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {SQLiteProjectionCache} from './sqlite-cache';
import type {ClientCheckpoint} from '@hermes-app/client';

const {path,identity}=workerData as {path:string;identity:string};
mkdirSync(dirname(path),{recursive:true,mode:0o700});
closeSync(openSync(path,'a',0o600));chmodSync(path,0o600);
const cache=new SQLiteProjectionCache(path,identity);
parentPort!.on('message',(request:{id:number;operation:'load'|'save'|'history'|'clear'|'close';value?:ClientCheckpoint;threadId?:string;before?:number;limit?:number})=>{
  try {
    let result:unknown;
    if(request.operation==='load')result=cache.load();
    else if(request.operation==='save')result=cache.save(request.value!);
    else if(request.operation==='history')result=cache.history(request.threadId!,request.before,request.limit);
    else if(request.operation==='clear')cache.clear();
    else if(request.operation==='close')cache.close();
    else throw new Error('Invalid cache operation');
    parentPort!.postMessage({id:request.id,result});
    if(request.operation==='close')parentPort!.close();
  } catch {parentPort!.postMessage({id:request.id,error:true})}
});
