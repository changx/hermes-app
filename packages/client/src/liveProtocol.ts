import type { Channel } from './index';
import { parseLabelMetadata } from './sessionLabels';

/** Directory metadata and shared completed-result marker only. No counts or bodies. */
export interface SessionDirectoryItem {
  id: string;
  project_id: string;
  title: string;
  archived: boolean;
  running: boolean;
  completed_unread?: boolean;
  result_version?: number;
  result_ref?: number;
  last_message_at?: number;
  markers?: string[];
  markers_updated_at?: number;
}
export type CatalogueItem = {kind:'channel';value:Channel}|{kind:'session';value:SessionDirectoryItem};
export interface CataloguePage {items:CatalogueItem[];next_after:string|null}
export type LiveFrame =
  | {type:'hello';protocol:1;open_session_live:true;multi_session_live?:boolean}
  | {type:'watching';thread_id:string|null;request_id:string}
  | {type:'directory_changed'}
  | {type:'session_state';thread_id:string;running:boolean}
  | {type:'conversation_changed'|'unavailable';thread_id:string;request_id:string};

export class LiveProtocolError extends Error {
  constructor(){super('Invalid live-session response');this.name='LiveProtocolError'}
}
const object=(value:unknown):Record<string,unknown>=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new LiveProtocolError();
  return value as Record<string,unknown>;
};
const text=(value:unknown,max=200):string=>{
  if(typeof value!=='string'||!value.length||value.length>max)throw new LiveProtocolError();
  return value;
};
const bool=(value:unknown):boolean=>{if(typeof value!=='boolean')throw new LiveProtocolError();return value};
export function parseCatalogue(value:unknown):CataloguePage {
  const body=object(value);
  if(!Array.isArray(body.items)||body.items.length>100)throw new LiveProtocolError();
  const seen=new Set<string>();
  const items:CatalogueItem[]=body.items.map(raw=>{
    const row=object(raw),entry=object(row.value),id=text(entry.id),key=String(row.kind)+':'+id;
    if(seen.has(key))throw new LiveProtocolError();seen.add(key);
    if(row.kind==='channel')return {kind:'channel',value:{id,name:text(entry.name)}};
    if(row.kind!=='session')throw new LiveProtocolError();
    const result:SessionDirectoryItem={id,project_id:text(entry.project_id),title:text(entry.title),archived:bool(entry.archived),running:bool(entry.running)};
    try { Object.assign(result, parseLabelMetadata(entry, true)); } catch { throw new LiveProtocolError(); }
    if(entry.completed_unread!==undefined){
      result.completed_unread=bool(entry.completed_unread);
      for(const key of ['result_version','result_ref'] as const){
        const number=entry[key];if(typeof number!=='number'||!Number.isSafeInteger(number)||number<0)throw new LiveProtocolError();
        result[key]=number;
      }
      if((result.result_version===0)!==(result.result_ref===0)||result.completed_unread&&result.result_version===0)throw new LiveProtocolError();
    }
    if(entry.last_message_at!==undefined){
      if(typeof entry.last_message_at!=='number'||!Number.isFinite(entry.last_message_at)||entry.last_message_at<0)throw new LiveProtocolError();
      result.last_message_at=entry.last_message_at;
    }
    return {kind:'session',value:result};
  });
  return {items,next_after:body.next_after===null?null:text(body.next_after,400)};
}
export function parseLiveFrame(value:unknown):LiveFrame {
  const row=object(value);
  if(row.type==='hello'){
    if(row.protocol!==1||row.open_session_live!==true)throw new LiveProtocolError();
    return {type:'hello',protocol:1,open_session_live:true,...(row.multi_session_live === true ? {multi_session_live:true} : {})};
  }
  if(row.type==='directory_changed')return {type:'directory_changed'};
  if(row.type==='session_state')return {type:'session_state',thread_id:text(row.thread_id),running:bool(row.running)};
  if(row.type==='watching')return {type:'watching',thread_id:row.thread_id===null?null:text(row.thread_id),request_id:text(row.request_id,128)};
  if(row.type==='conversation_changed'||row.type==='unavailable')return {type:row.type,thread_id:text(row.thread_id),request_id:text(row.request_id,128)};
  throw new LiveProtocolError();
}
export function watchCommand(threadId:string|null,requestId:string,mode?:'add'|'remove'):string {
  return JSON.stringify({type:'watch',thread_id:threadId===null?null:text(threadId),request_id:text(requestId,128),...(mode ? {mode} : {})});
}
