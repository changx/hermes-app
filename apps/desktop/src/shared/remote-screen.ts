/**
 * Remote screen (docs/remote-screen.md): the page's noVNC talks RFB to the host's screen
 * through the main process. The main process holds the credential and the WebSocket; the
 * page gets a MessagePort. These are the port messages and the page-side channel.
 */

export const REMOTE_SCREEN_PROTOCOL = 1;

/** Why the screen is not shown. The page turns each into plain words. */
export type RemoteScreenFailure = 'unavailable' | 'not_running' | 'busy' | 'unauthorized' | 'offline' | 'failed';

/** Main process → page. */
export type RemoteScreenToPage = Readonly<{ type: 'open' } | { type: 'data'; data: Uint8Array } | { type: 'close'; failure?: RemoteScreenFailure }>;
/** Page → main process. */
export type PageToRemoteScreen = Readonly<{ type: 'data'; data: Uint8Array } | { type: 'close' }>;

/** The plugin's answer to a refused WebSocket upgrade. */
export function failureForStatus(status: number): RemoteScreenFailure {
  if (status === 404) return 'unavailable';
  if (status === 503) return 'not_running';
  if (status === 429) return 'busy';
  if (status === 401 || status === 403) return 'unauthorized';
  return 'failed';
}

export function failureText(failure: RemoteScreenFailure | undefined, name: string): string {
  switch (failure) {
    case 'unavailable': return `${name} is not set up on this Hermes.`;
    case 'not_running': return `${name} is not running on the server right now.`;
    case 'busy': return `${name} is open in too many windows. Close one and try again.`;
    case 'unauthorized': return 'This computer is no longer allowed to connect. Pair it again in Settings.';
    case 'offline': return 'Hermes is offline. The screen comes back when the connection returns.';
    default: return `Lost the connection to ${name}.`;
  }
}

export function parseToPage(value: unknown): RemoteScreenToPage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const message = value as { type?: unknown; data?: unknown; failure?: unknown };
  if (message.type === 'open') return { type: 'open' };
  if (message.type === 'data' && message.data instanceof Uint8Array) return { type: 'data', data: message.data };
  if (message.type === 'close') {
    const failures: readonly RemoteScreenFailure[] = ['unavailable', 'not_running', 'busy', 'unauthorized', 'offline', 'failed'];
    return { type: 'close', ...(failures.includes(message.failure as RemoteScreenFailure) ? { failure: message.failure as RemoteScreenFailure } : {}) };
  }
  return undefined;
}

export function parseToScreen(value: unknown): PageToRemoteScreen | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const message = value as { type?: unknown; data?: unknown };
  if (message.type === 'close') return { type: 'close' };
  if (message.type === 'data' && message.data instanceof Uint8Array && message.data.byteLength <= 1024 * 1024) return { type: 'data', data: message.data };
  return undefined;
}

type PortLike = { postMessage(message: unknown): void; close(): void; start?(): void };
type PortHandler = { onmessage: ((event: { data: unknown }) => void) | null };
type ChannelEvent = { code?: number; reason?: string; wasClean?: boolean };

/**
 * A WebSocket-like object over the page's MessagePort, in the shape noVNC accepts as a raw
 * channel (RTCDataChannel-style string ready states). `failure` says why it closed.
 */
export class PortChannel {
  binaryType = 'arraybuffer';
  readonly protocol = '';
  readyState: 'connecting' | 'open' | 'closing' | 'closed' = 'connecting';
  failure?: RemoteScreenFailure;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  onclose: ((event: ChannelEvent) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor(private readonly port: PortLike) {
    (port as unknown as PortHandler).onmessage = event => this.receive(event.data);
    port.start?.();
  }
  send(data: ArrayBuffer | ArrayBufferView): void {
    if (this.readyState !== 'open') return;
    // noVNC reuses its send buffer: copy before the message leaves.
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data.slice(0)) : new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    this.port.postMessage({ type: 'data', data: bytes });
  }
  close(): void {
    if (this.readyState === 'closed' || this.readyState === 'closing') return;
    this.readyState = 'closing';
    try { this.port.postMessage({ type: 'close' }); } catch { /* The port is already gone. */ }
    this.finish({ code: 1000, reason: '', wasClean: true });
  }
  private receive(value: unknown): void {
    const message = parseToPage(value);
    if (!message || this.readyState === 'closed') return;
    if (message.type === 'open') {
      if (this.readyState !== 'connecting') return;
      this.readyState = 'open';
      this.onopen?.({});
    } else if (message.type === 'data') {
      if (this.readyState !== 'open') return;
      const { data } = message;
      this.onmessage?.({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer });
    } else {
      this.failure = message.failure;
      this.finish({ code: message.failure ? 1006 : 1000, reason: '', wasClean: !message.failure });
    }
  }
  private finish(event: ChannelEvent): void {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    (this.port as unknown as PortHandler).onmessage = null;
    try { this.port.close(); } catch { /* Already closed. */ }
    this.onclose?.(event);
  }
}
