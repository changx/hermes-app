import { connection, normalizeBase, type Connection } from './send.ts';

export const CONFIG_KEY = 'hermes-app-connection-v1';
export const PAIRING_KEY = 'hermes-app-pairing-v1';
interface Storage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}
export interface PendingPairing { version: 1; config: Connection; code: string; deviceName: string }
export class PairingError extends Error {}
class TemporaryError extends Error { retryAfterMs = 0; }
const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
const assertActive = (signal: AbortSignal) => { if (signal.aborted) throw abortError(); };
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function base64url(data: Uint8Array): string {
  let bits = 0, value = 0, output = '';
  for (const byte of data) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 6) { bits -= 6; output += alphabet[(value >>> bits) & 63]; }
  }
  if (bits) output += alphabet[(value << (6 - bits)) & 63];
  return output;
}
export function normalizePairingCode(code: string): string {
  const raw = code.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z2-7]{16}$/.test(raw)) throw new PairingError('Enter the complete one-time pairing code.');
  return raw.match(/.{4}/g)!.join('-');
}
export function newPairing(base: string, code: string, deviceName: string, id: string, random: Uint8Array): PendingPairing {
  if (random.length !== 44) throw new PairingError('Unable to create a secure device connection.');
  const deviceId = Array.from(random.slice(0, 12), n => n.toString(16).padStart(2, '0')).join('');
  return { version: 1, config: connection(normalizeBase(base), 'ha_dev_' + deviceId + '_' + base64url(random.slice(12)), id), code: normalizePairingCode(code), deviceName };
}
export function restorePairing(raw: string | null): PendingPairing | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as PendingPairing;
    if (value.version !== 1 || typeof value.deviceName !== 'string' || !value.deviceName || value.deviceName.length > 64 ||
        !/^ha_dev_[0-9a-f]{24}_[A-Za-z0-9_-]{43}$/.test(value.config?.token)) throw new Error();
    return { ...value, config: connection(value.config.baseUrl, value.config.token, value.config.id), code: normalizePairingCode(value.code) };
  } catch { throw new PairingError('Saved pairing details could not be read. Your existing connection has not changed.'); }
}
function wait(ms: number, signal: AbortSignal): Promise<void> {
  assertActive(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(abortError()); };
    signal.addEventListener('abort', abort, { once: true });
  });
}
interface Options {
  store: Storage;
  signal: AbortSignal;
  fetcher?: typeof fetch;
  onStatus?(value: string): void;
  timeoutMs?: number;
  delayMs?: number;
}
/** The candidate secret is saved before exchange; ACK loss never needs another grant. */
export async function completePairing(pending: PendingPairing, options: Options): Promise<Connection> {
  const { store, signal, onStatus } = options, fetcher = options.fetcher || fetch;
  assertActive(signal);
  try { await store.setItemAsync(PAIRING_KEY, JSON.stringify(pending)); }
  catch { throw new PairingError('This device could not save the connection. Pairing has not started. Please try again later.'); }
  assertActive(signal);
  const request = async (path: string, init: RequestInit) => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: () => void = () => {};
    try {
      return await Promise.race([
        (async () => {
          const response = await fetcher(pending.config.baseUrl + path, { ...init, signal: controller.signal, redirect: 'error' });
          const raw = await response.text();
          assertActive(signal);
          if (response.status === 429 || response.status === 408 || response.status >= 500) {
            const error = new TemporaryError();
            const value = response.headers.get('Retry-After');
            if (value) error.retryAfterMs = /^\d+$/.test(value) ? Number(value) * 1000 : Math.max(0, Date.parse(value) - Date.now()) || 0;
            throw error;
          }
          let body: unknown = null;
          if (response.ok) { try { body = JSON.parse(raw); } catch { throw new PairingError('The pairing response could not be read. Your existing connection has not changed.'); } }
          return { status: response.status, body: body as Record<string, unknown> | null };
        })(),
        new Promise<never>((_, reject) => {
          cancel = () => { reject(abortError()); controller.abort(); };
          signal.addEventListener('abort', cancel, { once: true });
          timer = setTimeout(() => { reject(new TemporaryError()); controller.abort(); }, options.timeoutMs ?? 12000);
          if (signal.aborted) cancel();
        })
      ]);
    } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
  };
  let attempt = 0, exchanged = false;
  while (true) {
    assertActive(signal);
    onStatus?.(attempt ? 'Waiting for a connection. Pairing will continue automatically…' : 'Connecting securely…');
    try {
      // Covers exchange response loss, app termination and retry after grant expiry.
      const check = await request('/v1/capabilities', { headers: { Authorization: 'Bearer ' + pending.config.token } });
      if (check.status === 200) {
        if (check.body?.protocol !== 1) throw new PairingError('This server version does not support the app yet.');
      } else if (check.status === 401) {
        if (exchanged) throw new PairingError('This device has not been authorized yet. Contact your administrator.');
        const reply = await request('/v1/pairing/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: pending.code, device_name: pending.deviceName, device_token: pending.config.token }) });
        if (reply.status === 400) throw new PairingError('This pairing code is invalid or expired. Ask your administrator for a new one.');
        if (reply.status === 404) throw new PairingError('Device pairing is not available yet. Ask your administrator to update the server.');
        if (reply.status !== 201 || reply.body?.device_id !== pending.config.token.slice(7, 31)) throw new PairingError('This device is not authorized to connect. Contact your administrator.');
        exchanged = true;
        // Verify the newly provisioned credential before making it the active connection.
        continue;
      } else throw new PairingError('This device is not authorized to connect. Contact your administrator.');
      assertActive(signal);
      try { await store.setItemAsync(CONFIG_KEY, JSON.stringify(pending.config)); }
      catch { throw new PairingError('Your pairing details are saved, but the connection could not be saved yet. Recovery will continue automatically.'); }
      assertActive(signal);
      // CONFIG is authoritative. A failed cleanup is safe: restore checks this identity.
      await store.deleteItemAsync(PAIRING_KEY).catch(() => {});
      assertActive(signal);
      return pending.config;
    } catch (error) {
      assertActive(signal);
      if (!(error instanceof TemporaryError) && !(error instanceof TypeError)) throw error;
      const delay = Math.max(error instanceof TemporaryError ? error.retryAfterMs : 0,
        options.delayMs ?? Math.min(10000, 500 * 2 ** Math.min(attempt++, 5)) * (0.75 + Math.random() * 0.5));
      onStatus?.('Waiting for a connection. Pairing will continue automatically…');
      await wait(delay, signal);
    }
  }
}
