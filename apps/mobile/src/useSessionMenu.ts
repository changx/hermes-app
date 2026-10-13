import { useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { labelsRoute } from './App';
import { threadPatch } from './channel-edits';
import { setThreadTodo } from './todoToggle';
import { confirmSessionArchive, sessionMenuActions, sessionRowProps } from './sessionMenu';
import { hasTodo } from '../../../packages/client/src/todo';

type MenuClient = {
  supportsSessionLabels?: boolean;
  threads: ReadonlyMap<string, { markers?: readonly string[] }>;
  saveThreadLabels(id: string, markers: string[], timestamp: number): Promise<{ markers: readonly string[] }>;
  updateThread(id: string, patch: { title: string }): Promise<unknown>;
  archiveThread(id: string): Promise<unknown>;
};
/** One Session row. `disabled` turns the long press off for that row. */
export type SessionMenuTarget = Readonly<{ slot: string; client: MenuClient | null; id: string; title: string; disabled?: boolean }>;

/**
 * The Session menu for a list outside a Channel page (Recents, Automations).
 * Rename uses the system text prompt, which exists only on iOS.
 * `onChanged` runs after a confirmed change, for lists that do not follow the directory.
 */
export function useSessionMenu(onChanged?: () => void) {
  const router = useRouter();
  const [error, setError] = useState('');
  const working = useRef(false);
  const run = async (work: () => Promise<string | void>) => {
    if (working.current) return;
    working.current = true; setError('');
    try { const failure = await work(); if (failure) setError(failure); else onChanged?.(); }
    catch { setError('Could not complete that action. Try again later.'); }
    finally { working.current = false; }
  };
  const rowProps = (target: SessionMenuTarget) => {
    const client = target.client;
    if (target.disabled || !client) return {};
    const todo = hasTodo(client.threads.get(target.id)?.markers);
    const actions = sessionMenuActions({
      labels: client.supportsSessionLabels === true, todo,
      toggleTodo: () => void run(() => setThreadTodo(client, target.id, !todo)),
      editLabels: () => router.push(labelsRoute(target.slot, target.id)),
      archive: () => confirmSessionArchive(Alert.alert, () => void run(async () => { await client.archiveThread(target.id); })),
      ...(Platform.OS === 'ios' ? { rename: () => Alert.prompt('Rename session', undefined, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save', onPress: (title?: string) => { const next = title?.trim();
          if (next && next !== target.title) void run(async () => { await client.updateThread(target.id, threadPatch(next)); }); } },
      ], 'plain-text', target.title) } : {}),
    });
    return sessionRowProps(target.title, actions, Alert.alert, () => working.current);
  };
  return { error, rowProps };
}
