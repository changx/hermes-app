import type { ConditionalHeaders, HttpTransport, SocketFactory } from "@hermes-app/client";
import WebSocket from "ws";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_REPLY_BYTES = 64 * 1024;
const MAX_AGENTS_REPLY_BYTES = 6 * MAX_ATTACHMENT_BYTES + 4096;
const MAX_WORKSPACE_REPLY_BYTES = 1024 * 1024;
const ETAG = /^"[0-9a-f]{64}"$/;

export const normalizeBaseUrl = (value: string, allowLoopback = false): string => {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid HTTPS server address.");
  }
  const loopback = allowLoopback && url.protocol === "http:" && ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
  if ((!loopback && url.protocol !== "https:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Enter an HTTPS server address without a path, account details, or query parameters.");
  }
  return `${url.protocol}//${url.host}`;
};

const retryAfterMs = (value: string | null): number | undefined => {
  if (!value) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
};

const MAX_HISTORY_BYTES = 64 * 1024 * 1024;
const responseBody = async (response: Response, maxBytes = MAX_REPLY_BYTES): Promise<unknown> => {
  // Bound decompressed UTF-8 bytes while reading, not UTF-16 characters after allocation.
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error("Server response is too large.");
      }
      chunks.push(decoder.decode(chunk.value, { stream: true }));
    }
    chunks.push(decoder.decode());
  } finally { reader.releaseLock(); }
  const raw = chunks.join("");
  if (!raw) return null;
  return response.headers.get("content-type")?.includes("json") ? JSON.parse(raw) : raw;
};

export const mainTransport = (baseUrl: string, allowLoopback = false): { http: HttpTransport; socket: SocketFactory } => {
  const base = normalizeBaseUrl(baseUrl, allowLoopback);
  const authorization = (token: string) => ({ Authorization: `Bearer ${token}` });
  // Only the two exact HTTP preconditions used by the workspace API are forwarded.
  const precondition = (headers: ConditionalHeaders): Record<string, string> => {
    const match = headers['If-Match'], create = headers['If-None-Match'];
    if (typeof match === 'string' && create === undefined && ETAG.test(match)) return { 'If-Match': match };
    if (create === '*' && match === undefined) return { 'If-None-Match': '*' };
    throw new Error('Invalid file version.');
  };
  const json = async (method: string, path: string, token: string, body?: unknown, signal?: AbortSignal, conditions?: ConditionalHeaders) => {
    const response = await fetch(base + path, {
      method,
      headers: { ...authorization(token), ...(conditions ? precondition(conditions) : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal,
    });
    const retry = retryAfterMs(response.headers.get("retry-after"));
    const historyRead = method === "GET" && /^\/v1\/threads\/[A-Za-z0-9_-]+\/messages(?:\?|$)/.test(path);
    // AGENTS.md keeps the 10 MiB text guard; escaped JSON can need six bytes per text byte.
    const agentsRead = method === "GET" && /^\/v1\/channels\/[A-Za-z0-9_-]+\/agents$/.test(path);
    const workspaceRead = method === "GET" && /^\/v1\/channels\/[A-Za-z0-9_-]+\/(?:files|attachments)(?:\?|$)/.test(path);
    const maxBytes = !response.ok ? MAX_REPLY_BYTES : historyRead ? MAX_HISTORY_BYTES : agentsRead ? MAX_AGENTS_REPLY_BYTES : workspaceRead ? MAX_WORKSPACE_REPLY_BYTES : MAX_REPLY_BYTES;
    return { status: response.status, body: await responseBody(response, maxBytes), ...(retry === undefined ? {} : { retryAfterMs: retry }) };
  };
  const http: HttpTransport = {
    request: (method, path, token, body, signal) => json(method, path, token, body, signal),
    conditionalRequest: (method, path, token, headers, body, signal) => json(method, path, token, body, signal, headers),
    async putBytes(path, token, headers, bytes, signal) {
      if (!/^\/v1\/channels\/[A-Za-z0-9_-]+\/file\?path=[^&#]+$/.test(path)) throw new Error("Invalid workspace file path.");
      if (!bytes.byteLength || bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error("File size is unsupported.");
      const response = await fetch(base + path, {
        method: "PUT",
        headers: { ...authorization(token), ...precondition(headers), "Content-Type": "application/octet-stream" },
        body: bytes as unknown as BodyInit,
        redirect: "error",
        signal,
      });
      const retry = retryAfterMs(response.headers.get("retry-after"));
      return { status: response.status, body: await responseBody(response), ...(retry === undefined ? {} : { retryAfterMs: retry }) };
    },
    async upload(path, token, name, bytes, signal) {
      if (!name || name.length > 180 || name === "." || name === ".." || /[/\\\x00\r\n]/.test(name)) throw new Error("Invalid attachment name.");
      if (!bytes.byteLength || bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error("Attachment size is unsupported.");
      const response = await fetch(base + path, {
        method: "POST",
        headers: { ...authorization(token), "X-File-Name": encodeURIComponent(name), "X-File-Name-Encoding": "percent-utf8", "Content-Type": "application/octet-stream" },
        body: bytes as unknown as BodyInit,
        redirect: "error",
        signal,
      });
      const retry = retryAfterMs(response.headers.get("retry-after"));
      return { status: response.status, body: await responseBody(response), ...(retry === undefined ? {} : { retryAfterMs: retry }) };
    },
    async download(path, token, signal) {
      // Ask for the original bytes. A proxy (Cloudflare) can still compress text files and then
      // drops Content-Length; fetch decodes the body, so bound the decoded bytes while reading.
      // Callers compare the result with the attachment's authoritative size.
      const response = await fetch(base + path, { headers: { ...authorization(token), "Accept-Encoding": "identity" }, redirect: "error", signal });
      if (!response.ok) return { status: response.status, body: new Uint8Array() };
      const encoding = (response.headers.get("content-encoding") ?? "identity").trim().toLowerCase();
      const length = encoding === "identity" ? response.headers.get("content-length") : null;
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_ATTACHMENT_BYTES)) throw new Error("Attachment size is unsupported.");
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > MAX_ATTACHMENT_BYTES) { await reader.cancel(); throw new Error("Attachment size is unsupported."); }
            chunks.push(chunk.value);
          }
        } finally { reader.releaseLock(); }
      }
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      if (length !== null && size !== Number(length)) throw new Error("Attachment download is incomplete.");
      return { status: response.status, body };
    },
  };

  const socket: SocketFactory = {
    connect(path, token, signal) {
      if (signal.aborted) return Promise.reject(new Error("aborted"));
      return new Promise((resolve, reject) => {
        const url = base.replace(/^http/, "ws") + path;
        const ws = new WebSocket(url, { headers: authorization(token), followRedirects: false, maxPayload: MAX_REPLY_BYTES });
        let settled = false;
        let closed = false;
        let messageListener: ((data: string) => void) | null = null;
        let closeListener: (() => void) | null = null;
        const pending: string[] = [];
        const abort = () => {
          ws.close();
          if (!settled) { settled = true; reject(new Error("aborted")); }
        };
        signal.addEventListener("abort", abort, { once: true });
        ws.once("open", () => {
          if (settled || signal.aborted) return abort();
          settled = true;
          signal.removeEventListener("abort", abort);
          resolve({
            onMessage(listener) { messageListener = listener; for (const item of pending.splice(0)) listener(item); },
            onClose(listener) { closeListener = listener; if (closed) listener(); },
            send(data) { if (ws.readyState === WebSocket.OPEN) ws.send(data); },
            close() { messageListener = null; closeListener = null; pending.length = 0; ws.close(); },
          });
        });
        ws.on("message", (data, binary) => {
          if (binary) return ws.close(1003);
          const text = data.toString();
          if (messageListener) messageListener(text);
          else if (pending.length < 32) pending.push(text);
          else ws.close(1009);
        });
        ws.once("close", () => { closed = true; if (!settled) { settled = true; reject(new Error("WebSocket connection failed")); } closeListener?.(); });
        ws.once("error", () => { if (!settled) { settled = true; reject(new Error("WebSocket connection failed")); } else ws.close(); });
      });
    },
  };
  return { http, socket };
};
