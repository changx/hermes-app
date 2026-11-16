import { NO_GROUPS, parseConnectionGroups, type ConnectionGroups } from '../../../packages/client/src/connectionGroups.ts';

/**
 * Connection groups of this device (docs/connection-groups.md). One SecureStore
 * item holds group names and slot IDs only; credentials stay in their own items.
 */
export const GROUPS_KEY = 'hermes-app-connection-groups';

interface Storage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
}

/** A missing item is no groups. Damaged data throws, so it is never saved again. */
export async function loadGroups(store: Storage): Promise<ConnectionGroups> {
  const raw = await store.getItemAsync(GROUPS_KEY);
  if (raw === null) return NO_GROUPS;
  const data = JSON.parse(raw) as { version?: unknown; state?: unknown };
  if (data?.version !== 1) throw new Error('Invalid connection groups');
  return parseConnectionGroups(data.state);
}

/** Saves, then reads back before reporting success. */
export async function saveGroups(store: Storage, state: ConnectionGroups): Promise<void> {
  const verified = parseConnectionGroups(state);
  await store.setItemAsync(GROUPS_KEY, JSON.stringify({ version: 1, state: verified }));
  if (JSON.stringify(await loadGroups(store)) !== JSON.stringify(verified)) throw new Error('The groups could not be saved.');
}
