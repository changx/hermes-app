import WebSocket from 'ws';
import { trackSocket } from './socket-registry';
import { failureForStatus, parseToScreen, type RemoteScreenFailure, type RemoteScreenToPage } from '../shared/remote-screen';

/** The main-process end of the page's MessagePort (Electron MessagePortMain). */
export type RemoteScreenPort = {
  postMessage(message: RemoteScreenToPage): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  start(): void;
  close(): void;
};
export type RemoteScreenEndpoint = Readonly<{ baseUrl: string; token: string }>;
export type RemoteScreenConnect = (url: string, token: string) => WebSocket;

const connectWebSocket: RemoteScreenConnect = (url, token) => trackSocket(new WebSocket(url, {
  headers: { Authorization: `Bearer ${token}` }, followRedirects: false, handshakeTimeout: 15_000,
  // The plugin cuts screen updates into 256 KiB frames.
  maxPayload: 2 * 1024 * 1024, perMessageDeflate: false }));

/**
 * Relays one page's RFB stream between its MessagePort and `/v1/remote-screen`. The
 * credential never reaches the page. Returns a function that ends the relay.
 */
export function relayRemoteScreen(port: RemoteScreenPort, endpoint: RemoteScreenEndpoint, connect: RemoteScreenConnect = connectWebSocket): () => void {
  let ended = false, failure: RemoteScreenFailure | undefined;
  const url = endpoint.baseUrl.replace(/^http/, 'ws') + '/v1/remote-screen';
  let ws: WebSocket | undefined;
  const end = (reason?: RemoteScreenFailure): void => {
    if (ended) return;
    ended = true;
    try { port.postMessage({ type: 'close', ...(reason ? { failure: reason } : {}) }); } catch { /* The page is gone. */ }
    try { port.close(); } catch { /* Already closed. */ }
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close(1000);
  };
  port.on('message', event => {
    const message = parseToScreen(event.data);
    if (!message || ended) return;
    if (message.type === 'close') end();
    else if (ws?.readyState === WebSocket.OPEN) ws.send(message.data);
  });
  port.on('close', () => end());
  port.start();
  try { ws = connect(url, endpoint.token); }
  catch { end('failed'); return () => end(); }
  ws.on('open', () => { if (!ended) port.postMessage({ type: 'open' }); });
  ws.on('message', (data, binary) => {
    if (ended || !binary) return;
    const chunks = Array.isArray(data) ? data : [data instanceof ArrayBuffer ? Buffer.from(data) : data];
    for (const chunk of chunks) port.postMessage({ type: 'data', data: new Uint8Array(chunk) });
  });
  ws.on('unexpected-response', (_request, response) => { failure = failureForStatus(response.statusCode ?? 0); response.resume(); end(failure); });
  ws.on('error', () => { failure ??= 'failed'; });
  ws.on('close', code => end(code === 1000 && !failure ? undefined : code === 1008 ? 'unauthorized' : failure ?? 'failed'));
  return () => end();
}
