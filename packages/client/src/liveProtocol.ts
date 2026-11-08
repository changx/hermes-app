import type { Channel } from './index';
import { parseLabelMetadata } from './sessionLabels';

/** Directory metadata and shared completed-result marker only. No counts or bodies. */
export interface SessionDirectoryItem {
  id: string;
  project_id: string;
  title: string;
  title_alphabet?: string;
  archived: boolean;
  running: boolean;
  completed_unread?: boolean;
  result_version?: number;
  result_ref?: number;
  last_message_at?: number;
  markers?: string[];
  markers_updated_at?: number;
  /** Who started the Thread. Absent on older servers, which means 'user'. */
  origin?: 'user' | 'automation';
  /** True after the user sent at least one message in the Thread. */
  participated?: boolean;
}
export type CatalogueItem = {kind:'channel';value:Channel}|{kind:'session';value:SessionDirectoryItem};
export interface CataloguePage {items:CatalogueItem[];next_after:string|null}
/** Current rows of named Threads; `missing` Threads left the directory. */
export interface CatalogueThreads {items:SessionDirectoryItem[];missing:string[]}
/** The server's committed completed-result state after a read acknowledgement. */
export interface ResultStatus {completed_unread:boolean;result_version:number;result_ref:number}
export type LiveFrame =
  | {type:'hello';protocol:1;open_session_live:true;multi_session_live?:boolean}
  | {type:'watching';thread_id:string|null;request_id:string}
  /** `thread_ids`: only these Thread rows changed. Absent: read the whole catalogue. */
  | {type:'directory_changed';thread_ids?:string[]}
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
const count=(value:unknown):number=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new LiveProtocolError();return value};
/** 1..100 distinct Thread identities. */
const threadIds=(value:unknown):string[]=>{
  if(!Array.isArray(value)||!value.length||value.length>100)throw new LiveProtocolError();
  const ids=value.map(id=>text(id));if(new Set(ids).size!==ids.length)throw new LiveProtocolError();
  return ids;
};
function parseResult(entry:Record<string,unknown>):ResultStatus{
  const result={completed_unread:bool(entry.completed_unread),result_version:count(entry.result_version),result_ref:count(entry.result_ref)};
  if((result.result_version===0)!==(result.result_ref===0)||result.completed_unread&&result.result_version===0)throw new LiveProtocolError();
  return result;
}
function parseSession(raw:unknown):SessionDirectoryItem{
  const entry=object(raw);
  const result:SessionDirectoryItem={id:text(entry.id),project_id:text(entry.project_id),title:text(entry.title),archived:bool(entry.archived),running:bool(entry.running)};
  if(entry.title_alphabet!==undefined){
    if(typeof entry.title_alphabet!=='string'||entry.title_alphabet.length>800||/[\u0000-\u001f\u007f]/.test(entry.title_alphabet))throw new LiveProtocolError();
    result.title_alphabet=entry.title_alphabet;
  }
  try { Object.assign(result, parseLabelMetadata(entry, true)); } catch { throw new LiveProtocolError(); }
  if(entry.completed_unread!==undefined)Object.assign(result,parseResult(entry));
  if(entry.origin!==undefined){
    if(entry.origin!=='user'&&entry.origin!=='automation')throw new LiveProtocolError();
    result.origin=entry.origin;
  }
  if(entry.participated!==undefined)result.participated=bool(entry.participated);
  if(entry.last_message_at!==undefined){
    if(typeof entry.last_message_at!=='number'||!Number.isFinite(entry.last_message_at)||entry.last_message_at<0)throw new LiveProtocolError();
    result.last_message_at=entry.last_message_at;
  }
  return result;
}
/** Largest `/v1/catalogue` page a client asks for (plugin 0.2.53 publishes 500). */
export const CATALOGUE_PAGE_MAX=500;
/** One catalogue page; `limit` is the page size the client asked for, never more rows. */
export function parseCatalogue(value:unknown,limit=CATALOGUE_PAGE_MAX):CataloguePage {
  const body=object(value);
  if(!Array.isArray(body.items)||body.items.length>Math.min(limit,CATALOGUE_PAGE_MAX))throw new LiveProtocolError();
  const seen=new Set<string>();
  const items:CatalogueItem[]=body.items.map(raw=>{
    const row=object(raw),entry=object(row.value),id=text(entry.id),key=String(row.kind)+':'+id;
    if(seen.has(key))throw new LiveProtocolError();seen.add(key);
    if(row.kind==='channel')return {kind:'channel',value:{id,name:text(entry.name)}};
    if(row.kind!=='session')throw new LiveProtocolError();
    return {kind:'session',value:parseSession(entry)};
  });
  return {items,next_after:body.next_after===null?null:text(body.next_after,400)};
}
/** Every requested Thread is either a returned row or missing, exactly once. */
export function parseCatalogueThreads(value:unknown,requested:readonly string[]):CatalogueThreads {
  const body=object(value),wanted=new Set(requested);
  if(!Array.isArray(body.items)||body.items.length>100||!Array.isArray(body.missing)||body.missing.length>100)throw new LiveProtocolError();
  const items=body.items.map(raw=>{const row=object(raw);if(row.kind!=='session')throw new LiveProtocolError();return parseSession(row.value)});
  const missing=body.missing.map(id=>text(id)),seen=new Set<string>();
  for(const id of [...items.map(item=>item.id),...missing]){if(!wanted.has(id)||seen.has(id))throw new LiveProtocolError();seen.add(id)}
  if(seen.size!==wanted.size)throw new LiveProtocolError();
  return {items,missing};
}
/** The result-read response: the committed state of this Thread's result marker. */
export function parseResultRead(value:unknown,id:string):ResultStatus {
  const body=object(value);
  if(body.thread_id!==id)throw new LiveProtocolError();
  return parseResult(body);
}
export function parseLiveFrame(value:unknown):LiveFrame {
  const row=object(value);
  if(row.type==='hello'){
    if(row.protocol!==1||row.open_session_live!==true)throw new LiveProtocolError();
    return {type:'hello',protocol:1,open_session_live:true,...(row.multi_session_live === true ? {multi_session_live:true} : {})};
  }
  if(row.type==='directory_changed')return row.thread_ids===undefined?{type:'directory_changed'}:{type:'directory_changed',thread_ids:threadIds(row.thread_ids)};
  if(row.type==='session_state')return {type:'session_state',thread_id:text(row.thread_id),running:bool(row.running)};
  if(row.type==='watching')return {type:'watching',thread_id:row.thread_id===null?null:text(row.thread_id),request_id:text(row.request_id,128)};
  if(row.type==='conversation_changed'||row.type==='unavailable')return {type:row.type,thread_id:text(row.thread_id),request_id:text(row.request_id,128)};
  throw new LiveProtocolError();
}
export function watchCommand(threadId:string|null,requestId:string,mode?:'add'|'remove'):string {
  return JSON.stringify({type:'watch',thread_id:threadId===null?null:text(threadId),request_id:text(requestId,128),...(mode ? {mode} : {})});
}
