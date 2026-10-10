import { CONFIG_KEY, PAIRING_KEY, restorePairing, type PendingPairing } from './pairing.ts';
import { connection, type Connection } from './send.ts';
import { normalizeConnectionName, serverHostName } from '../../../packages/client/src/connectionName.ts';

/**
 * Saved Hermes connections on this device.
 *
 * The primary slot keeps the original single-connection keys, so an existing
 * pairing, its drafts and its outbox stay valid without pairing again. Other
 * slots use suffixed keys. The index lists only slot IDs; credentials remain
 * in their own SecureStore items.
 */
export const INDEX_KEY = 'hermes-app-connections-v1';
export const PRIMARY = 'primary';
export const MAX_CONNECTIONS = 8;

interface Storage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}
export type SlotKeys = { config: string; pairing: string };
/** `name` is present only when the user chose one on this device. */
export type SavedSlot = Readonly<{ slot: string; config: Connection | null; pending: PendingPairing | null; damaged?: boolean; name?: string }>;
export class ConnectionListError extends Error {}

const slotPattern = /^[0-9a-f]{24}$/;
const NAME_KEY = 'hermes-app-connection-name';
export function slotKeys(slot: string): SlotKeys {
  if (slot === PRIMARY) return { config: CONFIG_KEY, pairing: PAIRING_KEY };
  if (!slotPattern.test(slot)) throw new ConnectionListError('Invalid connection slot');
  return { config: `${CONFIG_KEY}.${slot}`, pairing: `${PAIRING_KEY}.${slot}` };
}
/** Local name of a slot; separate from its credential. */
export function slotNameKey(slot: string): string {
  if (slot === PRIMARY) return NAME_KEY;
  if (!slotPattern.test(slot)) throw new ConnectionListError('Invalid connection slot');
  return `${NAME_KEY}.${slot}`;
}
/** Stable identity of a slot: the paired device credential, also while pairing. */
export const slotIdentity = (slot: SavedSlot): string | null => slot.config?.id ?? slot.pending?.config.id ?? null;
export const slotServer = (slot: SavedSlot): string | null => slot.config?.baseUrl ?? slot.pending?.config.baseUrl ?? null;
export function serverName(server: string | null): string {
  return serverHostName(server) ?? 'Saved connection';
}

/**
 * Saves this device's name for a slot. An empty name deletes it, so the host
 * name is used again. Reads back before reporting success.
 */
export async function saveSlotName(store: Storage, slot: string, value: string): Promise<string | null> {
  const name = normalizeConnectionName(value), key = slotNameKey(slot);
  if (name) await store.setItemAsync(key, name); else await store.deleteItemAsync(key);
  if ((await store.getItemAsync(key)) !== (name || null)) throw new Error('The name could not be saved.');
  return name || null;
}
async function readSlotName(store: Storage, slot: string): Promise<string | null> {
  try {
    const raw = await store.getItemAsync(slotNameKey(slot));
    // An unreadable or invalid name falls back to the host name; it never hides the connection.
    return raw && normalizeConnectionName(raw) === raw ? raw : null;
  } catch { return null; }
}

async function readIndex(store: Storage): Promise<string[]> {
  const raw = await store.getItemAsync(INDEX_KEY);
  if (raw === null) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new ConnectionListError('The saved connection list could not be read.'); }
  const slots = (value as { version?: unknown; slots?: unknown })?.slots;
  if ((value as { version?: unknown })?.version !== 1 || !Array.isArray(slots) || slots.length >= MAX_CONNECTIONS ||
      slots.some(slot => typeof slot !== 'string' || !slotPattern.test(slot)) || new Set(slots).size !== slots.length)
    throw new ConnectionListError('The saved connection list could not be read.');
  return slots as string[];
}
async function writeIndex(store: Storage, slots: readonly string[]): Promise<void> {
  if (slots.length >= MAX_CONNECTIONS || slots.some(slot => !slotPattern.test(slot))) throw new ConnectionListError('Invalid connection list');
  if (slots.length) await store.setItemAsync(INDEX_KEY, JSON.stringify({ version: 1, slots }));
  else await store.deleteItemAsync(INDEX_KEY);
  // A write that reads back differently must not be reported as saved.
  if (JSON.stringify(await readIndex(store)) !== JSON.stringify(slots)) throw new ConnectionListError('The connection list could not be saved.');
}

async function readSlot(store: Storage, slot: string): Promise<SavedSlot | null> {
  const keys = slotKeys(slot);
  const [rawConfig, rawPending] = await Promise.all([store.getItemAsync(keys.config), store.getItemAsync(keys.pairing)]);
  let config: Connection | null = null, pending: PendingPairing | null = null, damaged = false;
  if (rawConfig) {
    try {
      const value = JSON.parse(rawConfig) as Connection;
      config = connection(value.baseUrl, value.token, value.id);
    } catch { damaged = true; }
  }
  if (rawPending) {
    try { pending = restorePairing(rawPending); } catch { damaged = true; }
  }
  // A completed pairing may leave its candidate behind when cleanup failed.
  // A different candidate belongs to the retired in-place re-pair flow; the
  // saved connection stays authoritative and the candidate is discarded.
  if (config && pending) { await store.deleteItemAsync(keys.pairing).catch(() => {}); pending = null; }
  if (!config && !pending && !damaged) return null;
  const name = await readSlotName(store, slot);
  return { slot, config, pending, ...(damaged ? { damaged } : {}), ...(name ? { name } : {}) };
}

/** Reads every slot. A damaged slot is reported, never silently dropped. */
export async function loadSlots(store: Storage): Promise<SavedSlot[]> {
  const indexed = await readIndex(store);
  const slots: SavedSlot[] = [];
  const primary = await readSlot(store, PRIMARY);
  if (primary) slots.push(primary);
  const live: string[] = [];
  for (const slot of indexed) {
    const saved = await readSlot(store, slot);
    // An empty slot is an interrupted add; it holds no credential.
    if (saved) { slots.push(saved); live.push(slot); }
  }
  if (live.length !== indexed.length) await writeIndex(store, live).catch(() => {});
  return slots;
}

/**
 * Chooses a slot for a new pairing. The primary slot is reused only when it
 * is empty. A new slot is listed in the index before its credential is saved,
 * so an interruption never leaves an unreachable credential.
 */
export async function reserveSlot(store: Storage, current: readonly SavedSlot[], random: () => string): Promise<string> {
  if (current.length >= MAX_CONNECTIONS) throw new ConnectionListError('This version supports eight connections. Remove one before adding another.');
  if (!current.some(slot => slot.slot === PRIMARY)) return PRIMARY;
  const indexed = await readIndex(store);
  let slot = random();
  while (indexed.includes(slot)) slot = random();
  if (!slotPattern.test(slot)) throw new ConnectionListError('Invalid connection slot');
  await writeIndex(store, [...indexed, slot]);
  return slot;
}

/** Deletes credentials first, then the local name, then the index entry. */
export async function removeSlot(store: Storage, slot: string): Promise<void> {
  const keys = slotKeys(slot);
  await store.deleteItemAsync(keys.pairing);
  await store.deleteItemAsync(keys.config);
  // A later pairing in this slot must start with the host name again.
  await store.deleteItemAsync(slotNameKey(slot));
  if (slot === PRIMARY) return;
  const indexed = await readIndex(store);
  if (indexed.includes(slot)) await writeIndex(store, indexed.filter(item => item !== slot));
}
