import type { HttpTransport, SocketFactory, ConditionalHeaders } from '../../../packages/client/src/index';


// RN's WebSocket constructor accepts a third `options` argument with headers.
// Browser WebSocket does not: this app deliberately targets native Expo Go.
type NativeSocket = WebSocket & { onmessage: ((event: { data: unknown }) => void) | null };
type NativeSocketCtor = new (url: string, protocols?: string[], options?: { headers: Record<string, string> }) => NativeSocket;
const retryAfterMs = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const text=value.trim();
  if (/^\d+$/.test(text)) return Number.isSafeInteger(Number(text)*1000) ? Number(text)*1000 : undefined;
  const date=Date.parse(text);
  return Number.isFinite(date) ? Math.max(0,date-Date.now()) : undefined;
};

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_REPLY_BYTES = 65536;
const authorization = (token: string) => ({ Authorization: 'Bearer ' + token });
const binaryBody = (bytes: Uint8Array): ArrayBuffer => {
  if (!bytes.byteLength || bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('Attachments must be between 1 byte and 10 MiB.');
  // React Native's fetch bridge supports ArrayBuffer, not every Uint8Array view.
  return bytes.slice().buffer as ArrayBuffer;
};

export function nativeTransport(base: string): { http: HttpTransport; socket: SocketFactory } {
  const jsonRequest = async (method: string, path: string, token: string, body?: unknown, signal?: AbortSignal, conditional?: ConditionalHeaders) => {
    const precondition: Record<string,string> = {};
    if (conditional) {
      const match=conditional['If-Match'], create=conditional['If-None-Match'];
      if (typeof match === 'string' && create === undefined && /^"[0-9a-f]{64}"$/.test(match)) precondition['If-Match']=match;
      else if (create === '*' && match === undefined) precondition['If-None-Match']='*';
      else throw new Error('Invalid file version');
    }
    const response = await fetch(base + path, {
      method, headers: { ...precondition, Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal
    });
    const workspaceReply = /^\/v1\/channels\/[^/]+\/(workspace|files|agents|attachments|directories)(\?|$)/.test(path);
    // AGENTS uses the normal 10 MiB file guard; escaped JSON needs up to 6x
    // that wire size. Other workspace metadata retains its smaller bound.
    const replyBytes = /^\/v1\/channels\/[^/]+\/agents(\?|$)/.test(path) ? 6 * MAX_ATTACHMENT_BYTES + 4096 : 1024 * 1024;
    const length = response.headers.get('content-length');
    if (workspaceReply && length !== null && (!/^\d+$/.test(length) || Number(length) > replyBytes)) throw new Error('The file response is too large.');
    const raw = await response.text();
    if (workspaceReply && (raw.length > replyBytes || encodeURIComponent(raw).replace(/%[0-9A-F]{2}/g, 'x').length > replyBytes)) throw new Error('The file response is too large.');
    const delay=retryAfterMs(response.headers.get('retry-after'));
    return { status: response.status, body: raw ? (response.headers.get('content-type')?.includes('json') ? JSON.parse(raw) : raw) : null, ...(delay === undefined ? {} : {retryAfterMs:delay}) };
  };
  const request: HttpTransport['request'] = (method,path,token,body,signal) => jsonRequest(method,path,token,body,signal);
  return {
    http: { request, conditionalRequest: (method,path,token,headers,body,signal) => jsonRequest(method,path,token,body,signal,headers),
      async upload(path, token, name, bytes, signal) {
        if (!name || name.length > 180 || name === '.' || name === '..' || /[/\\\x00\r\n]/.test(name)) throw new Error('Invalid attachment name.');
        const response = await fetch(base + path, { method: 'POST', headers: {
          ...authorization(token), 'X-File-Name': encodeURIComponent(name), 'X-File-Name-Encoding': 'percent-utf8', 'Content-Type': 'application/octet-stream'
        }, body: binaryBody(bytes), signal });
        const length = response.headers.get('content-length');
        if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_REPLY_BYTES)) throw new Error('The attachment response is too large.');
        const raw = await response.text();
        if (raw.length > MAX_REPLY_BYTES / 4) throw new Error('The attachment response is too large.');
        const delay = retryAfterMs(response.headers.get('retry-after'));
        return { status: response.status, body: raw && response.headers.get('content-type')?.includes('json') ? JSON.parse(raw) : raw || null,
          ...(delay === undefined ? {} : { retryAfterMs: delay }) };
      },
      async download(path, token, signal) {
        const response = await fetch(base + path, { method: 'GET', headers: authorization(token), signal });
        if (response.status < 200 || response.status >= 300) return { status: response.status, body: new Uint8Array() };
        const length = response.headers.get('content-length');
        // The adapter always supplies Content-Length. Refuse an unbounded response
        // before RN's arrayBuffer() allocates it, then enforce the actual size.
        if (length === null || !/^\d+$/.test(length) || Number(length) > MAX_ATTACHMENT_BYTES) throw new Error('The attachment is too large to download.');
        const data = new Uint8Array(await response.arrayBuffer());
        if (data.byteLength > MAX_ATTACHMENT_BYTES || data.byteLength !== Number(length)) throw new Error('The attachment download is incomplete or too large.');
        return { status: response.status, body: data };
      }
    },
    socket: { connect(path, token, signal) {
      if (signal.aborted) return Promise.reject(new Error('aborted'));
      return new Promise((resolve, reject) => {
        const ws = new (WebSocket as NativeSocketCtor)(base.replace(/^http/, 'ws') + path, undefined, { headers: { Authorization: 'Bearer ' + token } });
        let settled = false, listener: ((data: string) => void) | null = null, closeListener: (() => void) | null = null, closed = false;
        const pending: string[] = [];
        const fail = () => { if (!settled) { settled = true; signal.removeEventListener('abort', abort); ws.close(); reject(new Error('WebSocket connection failed')); } };
        const abort = () => { fail(); };
        signal.addEventListener('abort', abort, { once: true });
        ws.onmessage = event => { if (closed) return; if (listener) listener(String(event.data)); else if (pending.length<32) pending.push(String(event.data)); else ws.close(); };
        ws.onclose = () => { closed = true; if (!settled) fail(); closeListener?.(); };
        ws.onerror = () => { if (settled) {ws.close();closeListener?.()} else fail(); };
        ws.onopen = () => {
          if (settled || signal.aborted) { ws.close(); return; }
          settled = true; signal.removeEventListener('abort', abort);
          resolve({ onMessage(fn) { listener = fn; for (const data of pending.splice(0)) fn(data); }, onClose(fn) { closeListener = fn; if (closed) fn(); }, send(data) { ws.send(data); }, close() { closed=true;listener=null;closeListener=null;pending.length=0;ws.onmessage=null;ws.onopen=null;ws.onerror=null;ws.onclose=null;ws.close(); } });
        };
        if (signal.aborted) abort();
      });
    } }
  };
}
