import type { HttpTransport, SocketFactory } from "@hermes-app/client";
import WebSocket from "ws";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_REPLY_BYTES = 64 * 1024;

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

const responseBody = async (response: Response): Promise<unknown> => {
  const raw = await response.text();
  if (raw.length > MAX_REPLY_BYTES) throw new Error("Server response is too large.");
  if (!raw) return null;
  return response.headers.get("content-type")?.includes("json") ? JSON.parse(raw) : raw;
};

export const mainTransport = (baseUrl: string, allowLoopback = false): { http: HttpTransport; socket: SocketFactory } => {
  const base = normalizeBaseUrl(baseUrl, allowLoopback);
  const authorization = (token: string) => ({ Authorization: `Bearer ${token}` });
  const http: HttpTransport = {
    async request(method, path, token, body, signal) {
      const response = await fetch(base + path, {
        method,
        headers: { ...authorization(token), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
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
      const response = await fetch(base + path, { headers: authorization(token), redirect: "error", signal });
      if (!response.ok) return { status: response.status, body: new Uint8Array() };
      const length = response.headers.get("content-length");
      if (!length || !/^\d+$/.test(length) || Number(length) > MAX_ATTACHMENT_BYTES) throw new Error("Attachment size is unsupported.");
      const body = new Uint8Array(await response.arrayBuffer());
      if (body.byteLength !== Number(length)) throw new Error("Attachment download is incomplete.");
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
