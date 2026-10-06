import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Keyboard, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { LocalDraftMap } from '../../../packages/client/src/localDraftMap';
import { connectionFailure, isRetryableError } from '../../../packages/client/src/index';
import { LivePageClient } from '../../../packages/client/src/livePages';
import { sessionServer } from '../../../packages/client/src/sessionLinks';
import { bindLocalDraftStorage } from './localDraftStorage';
import { nativeTransport } from './transport';
import { completePairing, newPairing, normalizePairingCode, type PendingPairing } from './pairing';
import { normalizeBase, type Connection, type SendRecord } from './send';
import { MobileOutbox, OutboxStore, type NetworkState } from './outbox';
import { reconciledSendNotice } from './sendNotice';
import { releaseComposerDraft, type ComposerDraft } from './Attachments';
import { useAgentName } from './AgentSettings';
import { ConnectionListError, MAX_CONNECTIONS, loadSlots, removeSlot, reserveSlot, serverName, slotKeys, slotServer, type SavedSlot } from './connectionSlots';
import { ConnectionScope as NavigationScope, SessionNavigationProvider } from './sessionNavigation';

/**
 * One saved Hermes connection at run time. Each connection owns its SDK
 * client, outbox, retry state and errors; one failure never stops another.
 */
export type ConnectionRuntime = Readonly<{
  slot: string; name: string; server: string | null;
  config: Connection | null; client: LivePageClient | null; outbox: MobileOutbox | null;
  status: NetworkState | 'pairing'; retryAt: number | null; failed: boolean;
  records: SendRecord[]; error: string; loading: boolean; connectionEpoch: number;
  pairing: PendingPairing | null; pairingStatus: string; damaged: boolean;
}>;

type Shared = {
  ready: boolean; listError: string; revision: number;
  connections: readonly ConnectionRuntime[];
  textDrafts: React.RefObject<LocalDraftMap<string>>;
  composerDrafts: React.RefObject<LocalDraftMap<ComposerDraft>>;
  forgottenConnections: React.RefObject<Set<string>>;
  draftError: string;
  addConnection(server: string, code: string): Promise<string>;
  removeConnection(slot: string): Promise<void>;
  cancelPairing(slot: string): Promise<void>;
};
const SharedContext = createContext<Shared | null>(null);
export function useConnections(): Shared {
  const value = useContext(SharedContext);
  if (!value) throw new Error('AppProvider is required');
  return value;
}

/** Fields that the existing connection pages read through `useApp()`. */
export type AppContextValue = {
  ready: boolean; slot: string; name: string; config: Connection | null; client: LivePageClient | null;
  agentName: ReturnType<typeof useAgentName>; revision: number;
  records: SendRecord[]; connectionEpoch: number; loading: boolean; status: NetworkState; error: string;
  multiple: boolean;
  textDrafts: React.RefObject<LocalDraftMap<string>>; outboxRef: React.RefObject<MobileOutbox | null>;
  composerDrafts: React.RefObject<LocalDraftMap<ComposerDraft>>;
  forgottenConnections: React.RefObject<Set<string>>;
};
const AppContext = createContext<AppContextValue | null>(null);
export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('A connection scope is required');
  return context;
}
export function useOptionalApp(): AppContextValue | null { return useContext(AppContext); }

type Mutable = { -readonly [K in keyof ConnectionRuntime]: ConnectionRuntime[K] };
const emptyRuntime = (saved: SavedSlot): Mutable => {
  const server = slotServer(saved);
  return { slot: saved.slot, name: serverName(server), server, config: saved.config, client: null, outbox: null,
    status: saved.pending ? 'pairing' : 'suspended', retryAt: null, failed: false, records: [], error: saved.damaged ? 'This saved connection could not be read. Remove it and pair again.' : '',
    loading: !!saved.config, connectionEpoch: 0, pairing: saved.pending, pairingStatus: '', damaged: !!saved.damaged };
};
const PAIR_ERROR = 'Could not pair. Check the pairing code or contact your admin.';
const randomSlot = () => Array.from(Crypto.getRandomBytes(12), n => n.toString(16).padStart(2, '0')).join('');

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false), [listError, setListError] = useState(''), [draftError, setDraftError] = useState('');
  const [revision, setRevision] = useState(0);
  const runtimes = useRef(new Map<string, Mutable>());
  const [, publish] = useState(0);
  const changed = useCallback(() => publish(n => n + 1), []);
  const textDrafts = useRef(new LocalDraftMap<string>(value => !!value.trim()));
  const composerDrafts = useRef(new LocalDraftMap<ComposerDraft>(value => value.items.length > 0));
  const forgottenConnections = useRef(new Set<string>());
  const appActive = useRef(AppState.currentState === 'active');
  const pairings = useRef(new Map<string, { controller: AbortController; promise: Promise<unknown> }>());
  const stops = useRef(new Map<string, () => void>());
  const mutation = useRef<Promise<unknown>>(Promise.resolve());
  const serialize = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const result = mutation.current.then(work); mutation.current = result.catch(() => {}); return result;
  }, []);
  const update = useCallback((slot: string, patch: Partial<Mutable>) => {
    const current = runtimes.current.get(slot);
    if (!current) return;
    runtimes.current.set(slot, { ...current, ...patch }); changed();
  }, [changed]);

  // One client and outbox per paired connection. Closing one never touches peers.
  const start = useCallback((slot: string, config: Connection) => {
    stops.current.get(slot)?.();
    let active = true;
    const transport = nativeTransport(config.baseUrl);
    let box: MobileOutbox | null = null;
    const live = () => active && runtimes.current.get(slot)?.config === config;
    const sdk = new LivePageClient({ ...transport, token: () => config.token,
      onChange: () => { if (live()) { setRevision(n => n + 1); box?.reconcile(); } },
      onConnectionState: (state: NetworkState) => {
        if (!live()) return;
        box?.setConnection(state);
        const runtime = runtimes.current.get(slot)!;
        const patch: Partial<Mutable> = { status: state };
        if (state === 'connecting' || state === 'syncing' || state === 'online') patch.failed = false;
        if (state === 'online') { patch.loading = false; patch.connectionEpoch = runtime.connectionEpoch + 1; if (runtime.error.startsWith('Could not connect')) patch.error = ''; }
        if (state === 'blocked') { patch.loading = false; patch.error = 'Could not connect. Contact your admin. Unsent messages are still here.'; }
        update(slot, patch);
        if (state === 'online') box?.reconcile();
      },
      onRetryScheduled: (deadline: number | null) => { if (live()) update(slot, { retryAt: deadline }); },
      onError: (failure: Error) => { if (live()) { console.info('[connection]', connectionFailure(failure)); if (!isRetryableError(failure)) update(slot, { failed: true }); } },
    } as ConstructorParameters<typeof LivePageClient>[0]);
    box = new MobileOutbox(new OutboxStore(SecureStore, config), sdk, (items, notice) => {
      if (!live()) return;
      const runtime = runtimes.current.get(slot)!;
      update(slot, { records: items, error: reconciledSendNotice(runtime.error, items, notice) });
    }, undefined, undefined, undefined, true);
    update(slot, { client: sdk, outbox: box, config, status: 'connecting', retryAt: null, failed: false, loading: true, error: '', records: [] });
    (async () => {
      try {
        await box.start();
        if (live() && appActive.current) await sdk.connect();
      } catch { if (live()) update(slot, { loading: false, error: "Could not load your messages. Don't clear this app's data; reopen the app." }); }
    })();
    const stop = () => { active = false; sdk.close(); void box?.stop(); if (stops.current.get(slot) === stop) stops.current.delete(slot); };
    stops.current.set(slot, stop);
  }, [update]);

  // Pairing runs per slot; it never replaces another saved connection.
  const pair = useCallback((slot: string, pending: PendingPairing) => {
    if (AppState.currentState === 'background') return;
    const previous = pairings.current.get(slot);
    previous?.controller.abort();
    const controller = new AbortController();
    update(slot, { status: 'pairing', pairing: pending, error: '', pairingStatus: '' });
    const promise = (previous?.promise ?? Promise.resolve()).catch(() => {}).then(() => completePairing(pending, { store: SecureStore, signal: controller.signal, keys: slotKeys(slot),
      onStatus: value => { if (!controller.signal.aborted) update(slot, { pairingStatus: value }); } }))
      .then(saved => {
        if (controller.signal.aborted || !runtimes.current.has(slot)) return;
        update(slot, { pairing: null, pairingStatus: '', config: saved });
        start(slot, saved);
      }).catch(() => {
        if (!controller.signal.aborted && runtimes.current.has(slot)) update(slot, { pairingStatus: '', error: PAIR_ERROR, status: 'blocked' });
      }).finally(() => { if (pairings.current.get(slot)?.controller === controller) pairings.current.delete(slot); });
    pairings.current.set(slot, { controller, promise });
  }, [start, update]);

  useEffect(() => {
    let mounted = true;
    let stopDraftStorage: (() => void) | undefined;
    loadSlots(SecureStore).then(slots => {
      if (!mounted) return;
      try {
        stopDraftStorage = bindLocalDraftStorage(textDrafts.current, composerDrafts.current, () => {
          if (mounted) setDraftError('Your draft could not be saved on this device. Keep the app open and copy your text before closing it.');
        });
      } catch { setDraftError("Could not load your local drafts. Don't clear this app's data; reopen the app."); }
      for (const saved of slots) runtimes.current.set(saved.slot, emptyRuntime(saved));
      changed();
      for (const saved of slots) {
        if (saved.config) start(saved.slot, saved.config);
        else if (saved.pending) pair(saved.slot, saved.pending);
      }
    }).catch(error => {
      if (mounted) setListError(error instanceof ConnectionListError ? 'The saved connection list could not be loaded. Reopen Hermes to try again. Existing connections are unchanged.'
        : "Could not load your connections. Don't clear this app's data; reopen the app.");
    }).finally(() => { if (mounted) setReady(true); });
    return () => {
      mounted = false; stopDraftStorage?.();
      for (const stop of [...stops.current.values()]) stop();
      for (const task of pairings.current.values()) task.controller.abort();
    };
  }, []);

  // Foreground connects every paired connection; background pauses all.
  useEffect(() => {
    let foreground = AppState.currentState === 'active';
    const sub = AppState.addEventListener('change', state => {
      const next = state === 'active';
      appActive.current = next;
      // End native input before background keyboard extensions can resize it.
      if (foreground && !next) Keyboard.dismiss();
      for (const runtime of runtimes.current.values()) {
        if (!next) {
          pairings.current.get(runtime.slot)?.controller.abort();
          if (runtime.client) { runtime.outbox?.setConnection('suspended'); runtime.client.suspendConnection(); update(runtime.slot, { status: 'suspended', failed: false }); }
        } else if (!foreground) {
          if (runtime.client) { update(runtime.slot, { status: 'connecting' }); runtime.client.connect().catch(() => { /* SDK retry loop owns recovery */ }); }
          else if (runtime.pairing) pair(runtime.slot, runtime.pairing);
        }
      }
      foreground = next;
    });
    return () => sub.remove();
  }, [pair, update]);

  const addConnection = useCallback((server: string, code: string) => serialize(async () => {
    if (!ready || listError) throw new ConnectionListError('The saved connection list is unavailable. Reopen Hermes.');
    const base = normalizeBase(server), normalizedCode = normalizePairingCode(code);
    const current = [...runtimes.current.values()];
    if (current.some(runtime => runtime.server && sessionServer(runtime.server) === sessionServer(base))) throw new ConnectionListError('This server is already saved. Use its existing connection.');
    if (current.length >= MAX_CONNECTIONS) throw new ConnectionListError('This version supports eight connections. Remove one before adding another.');
    const slot = await reserveSlot(SecureStore, current.map(runtime => ({ slot: runtime.slot, config: runtime.config, pending: runtime.pairing })), randomSlot);
    const pending = newPairing(base, normalizedCode, Platform.OS === 'ios' ? 'iPhone' : 'Android', Crypto.randomUUID(), await Crypto.getRandomBytesAsync(44));
    runtimes.current.set(slot, emptyRuntime({ slot, config: null, pending }));
    changed();
    pair(slot, pending);
    return slot;
  }), [ready, listError, serialize, pair, changed]);

  // Removes only this connection: its credential, client, outbox, drafts and pages.
  const removeConnection = useCallback((slot: string) => serialize(async () => {
    const runtime = runtimes.current.get(slot);
    if (!runtime) return;
    const task = pairings.current.get(slot);
    task?.controller.abort();
    await task?.promise.catch(() => {});
    const identity = runtime.config?.id ?? runtime.pairing?.config.id;
    if (identity) forgottenConnections.current.add(identity);
    const box = runtime.outbox;
    stops.current.get(slot)?.();
    try {
      if (box) { await box.stop(); await box.storage.clear(); }
      await removeSlot(SecureStore, slot);
    } catch (error) {
      // Keep the identity listed so the user can retry; the client stays stopped.
      update(slot, { client: null, outbox: null, status: 'suspended', error: 'Could not finish removing this connection. Try again.' });
      throw error;
    }
    if (identity) {
      const prefix = identity + ':';
      for (const key of [...textDrafts.current.keys()]) if (key.startsWith(prefix)) textDrafts.current.delete(key);
      for (const [key, draft] of [...composerDrafts.current]) if (key.startsWith(prefix)) { composerDrafts.current.delete(key); releaseComposerDraft(draft); }
    }
    runtimes.current.delete(slot);
    changed();
  }), [serialize, changed, update]);

  const cancelPairing = useCallback((slot: string) => removeConnection(slot), [removeConnection]);

  const connections = [...runtimes.current.values()] as readonly ConnectionRuntime[];
  const shared: Shared = { ready, listError, revision, connections, textDrafts, composerDrafts, forgottenConnections, draftError,
    addConnection, removeConnection, cancelPairing };
  const navigation = useMemo(() => ({ connection: null, owner: null,
    hasPage: (slot: string, id: string) => !!runtimes.current.get(slot)?.client?.page(id),
    connectionForServer: (server: string) => {
      const target = sessionServer(server);
      return [...runtimes.current.values()].find(runtime => runtime.config && sessionServer(runtime.config.baseUrl) === target)?.slot ?? null;
    } }), []);
  return <SharedContext.Provider value={shared}><SessionNavigationProvider value={navigation}>{children}</SessionNavigationProvider></SharedContext.Provider>;
}

/** Narrows `useApp()` and navigation to one saved connection. */
export function ConnectionScope({ slot, children, fallback = null }: { slot: string; children: React.ReactNode; fallback?: React.ReactNode }) {
  const shared = useConnections();
  const runtime = shared.connections.find(item => item.slot === slot);
  const config = runtime?.config ?? null;
  const agentName = useAgentName(config?.id ?? null);
  const outboxRef = useRef<MobileOutbox | null>(null);
  outboxRef.current = runtime?.outbox ?? null;
  const value = useMemo<AppContextValue | null>(() => runtime ? {
    ready: shared.ready, slot, name: runtime.name, config, client: runtime.client, agentName, revision: shared.revision,
    records: runtime.records, connectionEpoch: runtime.connectionEpoch, loading: runtime.loading,
    status: runtime.status === 'pairing' ? 'connecting' : runtime.status, error: runtime.error || shared.draftError,
    multiple: shared.connections.length > 1,
    textDrafts: shared.textDrafts, composerDrafts: shared.composerDrafts, forgottenConnections: shared.forgottenConnections, outboxRef,
  } : null, [runtime, shared.ready, shared.revision, shared.draftError, shared.connections.length, slot, config, agentName, shared.textDrafts, shared.composerDrafts, shared.forgottenConnections]);
  if (!value) return <>{fallback}</>;
  return <AppContext.Provider value={value}><NavigationScope connection={slot} owner={config?.id ?? slot}>{children}</NavigationScope></AppContext.Provider>;
}

/** Route parameter for a connection. Older routes without it use the primary slot. */
export function routeConnection(value: string | string[] | undefined): string | null {
  if (value === undefined) return 'primary';
  return typeof value === 'string' && /^(primary|[0-9a-f]{24})$/.test(value) ? value : null;
}
