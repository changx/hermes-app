// Shared, Electron-free pieces of the App-side browser control ("your browser").
// See docs/desktop-browser-control.md. No CDP: every action uses native input.

export const BROWSER_PROTOCOL = 1;
export const BROWSER_ACTIONS = ['navigate', 'snapshot', 'click', 'type', 'press', 'scroll', 'back', 'screenshot', 'handoff'] as const;
export type BrowserAction = typeof BROWSER_ACTIONS[number];
/** Native macOS app control through the user's installed Cua Driver. Declared only when the driver is present. */
export const MAC_ACTION = 'mac';
/** MCP servers configured on this computer (docs/desktop-mcp-host.md). */
export const MCP_ACTION = 'mcp';
export type ControlAction = BrowserAction | typeof MAC_ACTION | typeof MCP_ACTION;
export type BrowserControlState = 'agent' | 'user' | 'waiting';
export type BrowserCommand = Readonly<{ id: string; threadId: string; channelId?: string; action: ControlAction; args: Readonly<Record<string, unknown>>; timeoutMs: number; openTab: boolean }>;
export type ServerFrame = Readonly<{ type: 'hello'; protocol: number }> | Readonly<{ type: 'command'; command: BrowserCommand }> | Readonly<{ type: 'cancel'; id: string }>;

/** An error whose `code` the server maps to an explanation for the Agent. */
export class BrowserControlError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

const text = (value: unknown, maximum: number): string => {
  if (typeof value !== 'string' || !value || value.length > maximum) throw new Error('Invalid browser command');
  return value;
};

export function parseServerFrame(raw: string): ServerFrame | undefined {
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return undefined; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const frame = body as Record<string, unknown>;
  if (frame.type === 'hello' && typeof frame.protocol === 'number') return { type: 'hello', protocol: frame.protocol };
  if (frame.type === 'cancel' && typeof frame.id === 'string' && frame.id.length <= 64) return { type: 'cancel', id: frame.id };
  if (frame.type !== 'command') return undefined;
  if (!(BROWSER_ACTIONS as readonly string[]).includes(frame.action as string) && frame.action !== MAC_ACTION && frame.action !== MCP_ACTION) throw new Error('Invalid browser command');
  const args = frame.args && typeof frame.args === 'object' && !Array.isArray(frame.args) ? frame.args as Record<string, unknown> : {};
  const timeoutMs = Number(frame.timeout_ms);
  return { type: 'command', command: {
    id: text(frame.id, 64), threadId: text(frame.thread_id, 200),
    ...(typeof frame.channel_id === 'string' && frame.channel_id ? { channelId: text(frame.channel_id, 200) } : {}),
    action: frame.action as ControlAction, args, openTab: frame.open_tab === true,
    timeoutMs: Number.isFinite(timeoutMs) ? Math.min(Math.max(timeoutMs, 1000), 15 * 60_000) : 30_000,
  } };
}

/** Electron `sendInputEvent` key codes for the keys the Agent may press. */
const KEYS: Record<string, { code: string; char?: string }> = {
  enter: { code: 'Enter', char: '\r' }, return: { code: 'Enter', char: '\r' }, tab: { code: 'Tab' },
  escape: { code: 'Escape' }, esc: { code: 'Escape' }, backspace: { code: 'Backspace' }, delete: { code: 'Delete' },
  arrowup: { code: 'Up' }, up: { code: 'Up' }, arrowdown: { code: 'Down' }, down: { code: 'Down' },
  arrowleft: { code: 'Left' }, left: { code: 'Left' }, arrowright: { code: 'Right' }, right: { code: 'Right' },
  pageup: { code: 'PageUp' }, pagedown: { code: 'PageDown' }, home: { code: 'Home' }, end: { code: 'End' },
  space: { code: 'Space', char: ' ' }, ' ': { code: 'Space', char: ' ' },
};
export function keyFor(name: string): { code: string; char?: string } | undefined { return KEYS[name.trim().toLowerCase()]; }

/**
 * Remembers the mouse-down and key-down events the app itself injected. Electron also reports
 * injected events through before-mouse-event / before-input-event (verified on macOS), so an
 * event that is not in this ledger came from the user.
 */
export class InputLedger {
  private items: { kind: 'mouse' | 'key'; x?: number; y?: number; at: number }[] = [];
  constructor(private readonly now: () => number = Date.now, private readonly ttl = 2000) {}
  note(kind: 'mouse' | 'key', x?: number, y?: number): void { this.items.push({ kind, x, y, at: this.now() }); }
  consume(kind: 'mouse' | 'key', x?: number, y?: number): boolean {
    const limit = this.now() - this.ttl;
    this.items = this.items.filter(item => item.at >= limit);
    const index = this.items.findIndex(item => item.kind === kind && (kind === 'key' || (Math.abs((item.x ?? 0) - (x ?? 0)) <= 4 && Math.abs((item.y ?? 0) - (y ?? 0)) <= 4)));
    if (index < 0) return false;
    this.items.splice(index, 1); return true;
  }
}

export type UserAgentData = Readonly<{ brands: readonly Readonly<{ brand: string; version: string }>[]; mobile: boolean; platform: string }>;
export function validUserAgentData(value: unknown): UserAgentData | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.brands) || data.brands.length > 8 || typeof data.mobile !== 'boolean' || typeof data.platform !== 'string' || data.platform.length > 40) return undefined;
  const brands = data.brands.map(item => item && typeof item === 'object' ? item as Record<string, unknown> : {});
  if (!brands.every(b => typeof b.brand === 'string' && b.brand.length <= 64 && !/["\\\r\n]/.test(b.brand) && typeof b.version === 'string' && /^[\d.]{1,24}$/.test(b.version))) return undefined;
  if (/["\\\r\n]/.test(data.platform)) return undefined;
  return { brands: brands.map(b => ({ brand: b.brand as string, version: b.version as string })), mobile: data.mobile, platform: data.platform };
}
/** The three default Client Hints request headers, mirrored from the page's own navigator.userAgentData. */
export function clientHints(data: UserAgentData): Record<string, string> {
  return { 'sec-ch-ua': data.brands.map(b => `"${b.brand}";v="${b.version}"`).join(', '), 'sec-ch-ua-mobile': data.mobile ? '?1' : '?0', 'sec-ch-ua-platform': `"${data.platform}"` };
}
export function withClientHints(headers: Record<string, string>, hints: Record<string, string> | undefined, url: string): Record<string, string> {
  if (!hints || !url.startsWith('https:')) return headers;
  const present = new Set(Object.keys(headers).map(key => key.toLowerCase()));
  const next = { ...headers };
  for (const [key, value] of Object.entries(hints)) if (!present.has(key)) next[key] = value;
  return next;
}

/** Top-level navigations the browser accepts. Everything else (file:, chrome:, javascript:) is refused. */
export function navigable(url: string): boolean {
  if (url === 'about:blank') return true;
  try { const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password; } catch { return false; }
}
/** Subresources are allowed like a normal browser, except local files and browser-internal pages. */
export function blockedSubresource(url: string): boolean { return /^(file|chrome|devtools|chrome-untrusted):/i.test(url); }

export const CONTROL_TEXT = {
  agent: 'Hermes is using this page',
  user: 'You took over. Hermes is paused.',
  waitingDefault: 'Hermes needs you to finish something on this page.',
} as const;
