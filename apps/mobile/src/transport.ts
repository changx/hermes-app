import type { HttpTransport, SocketFactory } from '../../../packages/client/src/index';

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
  if (!bytes.byteLength || bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('附件大小必须在 1 字节至 10 MiB 之间');
  // React Native's fetch bridge supports ArrayBuffer, not every Uint8Array view.
  return bytes.slice().buffer as ArrayBuffer;
};

export function nativeTransport(base: string): { http: HttpTransport; socket: SocketFactory } {
  const request: HttpTransport['request'] = async (method, path, token, body, signal) => {
    const response = await fetch(base + path, {
      method, headers: { Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal
    });
    const raw = await response.text();
    const delay=retryAfterMs(response.headers.get('retry-after'));
    return { status: response.status, body: raw ? (response.headers.get('content-type')?.includes('json') ? JSON.parse(raw) : raw) : null, ...(delay === undefined ? {} : {retryAfterMs:delay}) };
  };
  return {
    http: { request,
      async upload(path, token, name, bytes, signal) {
        if (!name || name.length > 180 || name === '.' || name === '..' || /[/\\\x00\r\n]/.test(name)) throw new Error('附件名称无效');
        const response = await fetch(base + path, { method: 'POST', headers: {
          ...authorization(token), 'X-File-Name': encodeURIComponent(name), 'X-File-Name-Encoding': 'percent-utf8', 'Content-Type': 'application/octet-stream'
        }, body: binaryBody(bytes), signal });
        const length = response.headers.get('content-length');
        if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_REPLY_BYTES)) throw new Error('附件响应超过安全上限');
        const raw = await response.text();
        if (raw.length > MAX_REPLY_BYTES / 4) throw new Error('附件响应超过安全上限');
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
        if (length === null || !/^\d+$/.test(length) || Number(length) > MAX_ATTACHMENT_BYTES) throw new Error('附件下载超过安全上限');
        const data = new Uint8Array(await response.arrayBuffer());
        if (data.byteLength > MAX_ATTACHMENT_BYTES || data.byteLength !== Number(length)) throw new Error('附件下载不完整或超过安全上限');
        return { status: response.status, body: data };
      }
    },
    socket: { connect(path, token, signal) {
      if (signal.aborted) return Promise.reject(new Error('aborted'));
      return new Promise((resolve, reject) => {
        const ws = new (WebSocket as NativeSocketCtor)(base.replace(/^http/, 'ws') + path, undefined, { headers: { Authorization: 'Bearer ' + token } });
        let settled = false, listener: ((data: string) => void) | null = null, closeListener: (() => void) | null = null, closed = false;
        const pending: string[] = [];
        const fail = () => { if (!settled) { settled = true; signal.removeEventListener('abort', abort); ws.close(); reject(new Error('WebSocket 连接失败')); } };
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
