import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { FontSizeSettings, Text } from './FontSize';
import { useKeyboardState } from 'react-native-keyboard-controller';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { connectionFailure } from '../../../packages/client/src/index';
import { LiveSessionClient } from '../../../packages/client/src/liveClient';
import type { Attachment, Interaction } from '../../../packages/client/src/index';
import { nativeTransport } from './transport';
import { DEFAULT_BASE, connection, newSend } from './send';
import { ConnectionScreen } from './ConnectionScreen';
import { CONFIG_KEY, PAIRING_KEY, completePairing, newPairing, normalizePairingCode, restorePairing, type PendingPairing } from './pairing';
import type { Connection, SendRecord } from './send';
import { MobileOutbox, OutboxStore, type NetworkState } from './outbox';
import { ChatTimeline, type ChatTimelineHandle } from './ChatTimeline';
import { ChannelScreens } from './ChannelScreens';
import { projectTimeline, windowStart, type TimelinePosition } from './timeline';
import { historyBlockStart, loadHistoryBlocks } from './historyBlocks';
import { VisibleReceiptHydrator } from './receiptHydration';
import { AttachmentComposer, MessageAttachments, releaseComposerDraft, type ComposerDraft } from './Attachments';
import { isAgentTyping, TypingIndicator } from './TypingIndicator';
import { AgentSettings, useAgentName } from './AgentSettings';
import { ModelSettings } from './ModelSettings';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import type { TimelineRow } from './timeline';

import { reconciledSendNotice } from './sendNotice';

function HeaderIcon({ label, ios, android, onPress }: { label: string; ios: SFSymbol; android: AndroidSymbol; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={onPress} style={({ pressed }) => [styles.headerIcon, pressed && styles.headerIconPressed]}>
    <SymbolView name={{ ios, android }} size={21} tintColor="#2b4e81" weight="medium" fallback={<Text style={styles.headerLink}>{label}</Text>} />
  </Pressable>;
}
export function HeaderActions({ onConnection, onSettings }: { onConnection: () => void; onSettings: () => void }) {
  return <View style={styles.headerActions}>
    <HeaderIcon label="Connection" ios="antenna.radiowaves.left.and.right" android="wifi" onPress={onConnection} />
    <HeaderIcon label="Agent settings" ios="gearshape" android="settings" onPress={onSettings} />
  </View>;
}
type AppContextValue = {
  ready: boolean; config: Connection | null; client: LiveSessionClient | null;
  agentName: ReturnType<typeof useAgentName>; identity: number; revision: number;
  records: SendRecord[]; connectionEpoch: number; loading: boolean; status: NetworkState; error: string;
  base: string; pairingCode: string; pendingPairing: PendingPairing | null; pairingBusy: boolean;
  pairingStatus: string; busy: boolean; editing: boolean;
  setPairingCode: (value: string) => void; setEditing: (value: boolean) => void;
  saveConnection: () => void; forget: () => void; cancelPairing: () => void;
  textDrafts: React.RefObject<Map<string, string>>; outboxRef: React.RefObject<MobileOutbox | null>;
  composerDrafts: React.RefObject<Map<string, ComposerDraft>>;
  forgottenConnections: React.RefObject<Set<string>>;
};
const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [config, setConfig] = useState<Connection | null>(null);
  const agentName = useAgentName(config?.id ?? null);
  const [ready, setReady] = useState(false), [editing, setEditing] = useState(false);
  const [base, setBase] = useState(DEFAULT_BASE), [pairingCode, setPairingCode] = useState('');
  const [pendingPairing, setPendingPairing] = useState<PendingPairing | null>(null);
  const [pairingBusy, setPairingBusy] = useState(false), [pairingStatus, setPairingStatus] = useState('');
  const [pairingEpoch, setPairingEpoch] = useState(0);
  const pairingTask = useRef<{ controller: AbortController; promise: Promise<unknown> } | null>(null);
  const [session, setSession] = useState<{ config: Connection; client: LiveSessionClient } | null>(null);
  const client = session?.config === config ? session.client : null;
  const [identity, setIdentity] = useState(0);
  const [revision, setRevision] = useState(0), [busy, setBusy] = useState(false);
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [loading, setLoading] = useState(false), [status, setStatus] = useState<NetworkState>('suspended'), [error, setError] = useState('');
  // Only unsent user input survives leaving a conversation.
  const textDrafts = useRef(new Map<string, string>());
  const composerDrafts = useRef(new Map<string, ComposerDraft>());
  const forgottenConnections = useRef(new Set<string>());
  const [records, setRecords] = useState<SendRecord[]>([]);
  const outboxRef = useRef<MobileOutbox | null>(null);
  const busyRef = useRef(false);
  const appActive = useRef(AppState.currentState === 'active');

  useEffect(() => {
    let mounted = true;
    Promise.all([SecureStore.getItemAsync(CONFIG_KEY), SecureStore.getItemAsync(PAIRING_KEY)]).then(([raw, savedPairing]) => {
      if (!mounted) return;
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') throw new Error('Saved connection is invalid');
        const c = parsed as Connection;
        const valid = connection(c.baseUrl, c.token, c.id);
        // Do not remount the Stack on cold restore: keep an incoming deep link alive.
        setConfig(valid); setBase(valid.baseUrl);
      }
      const pending = restorePairing(savedPairing);
      if (pending && (!raw || JSON.parse(raw).token !== pending.config.token)) {
        setPendingPairing(pending); setBase(pending.config.baseUrl); setPairingCode(pending.code); setEditing(true);
      } else if (pending) void SecureStore.deleteItemAsync(PAIRING_KEY).catch(() => {});
    }).catch(() => { if (mounted) setError("Could not load your connection. Don't clear this app's data; reopen the app."); }).finally(() => { if (mounted) setReady(true); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let foreground = AppState.currentState === 'active';
    const sub = AppState.addEventListener('change', state => {
      const next = state === 'active';
      // End native input before background keyboard extensions can resize it.
      // Retain drafts and leave reopening to the user's next input tap.
      if (foreground && !next) Keyboard.dismiss();
      if (!next) pairingTask.current?.controller.abort();
      if (next && !foreground) setPairingEpoch(n => n + 1);
      foreground = next;
    });
    return () => { sub.remove(); pairingTask.current?.controller.abort(); };
  }, []);

  useEffect(() => {
    if (!pendingPairing || AppState.currentState === 'background') return;
    let active = true;
    const controller = new AbortController();
    setPairingBusy(true); setError('');
    const previous = pairingTask.current;
    previous?.controller.abort();
    const promise = (previous?.promise ?? Promise.resolve()).then(() => completePairing(pendingPairing, { store: SecureStore, signal: controller.signal,
      onStatus: value => { if (active) setPairingStatus(value); }
    })).then(saved => {
      if (!active) return;
      setPairingBusy(false);
      setSession(null); setConfig(saved); setIdentity(n => n + 1); setBase(saved.baseUrl); setEditing(false); setPairingCode('');
      setPendingPairing(null); setPairingStatus('');
      router.replace('/');
    }).catch(() => {
      if (active && !controller.signal.aborted) { setPairingStatus(''); setError('Could not pair. Check the pairing code or contact your admin.'); }
    }).finally(() => { if (active) setPairingBusy(false); });
    pairingTask.current = { controller, promise };
    return () => { active = false; controller.abort(); };
  }, [pendingPairing, pairingEpoch]);

  useEffect(() => {
    if (!config) { setSession(null); return; }
    let active = true;
    const transport = nativeTransport(config.baseUrl);
    let box: MobileOutbox | null = null;
    const sdk = new LiveSessionClient({ ...transport, token: () => config.token,
      onChange: () => { if (active) { setRevision((n: number) => n + 1); box?.reconcile(); } },
      onConnectionState: (state: NetworkState) => {
        if (!active) return;
        setStatus(state); box?.setConnection(state);
        if (state === 'online') { setLoading(false); setError(previous => previous.startsWith('Could not connect') ? '' : previous); setConnectionEpoch((n: number) => n + 1); box?.reconcile(); }
        if (state === 'blocked') { setLoading(false); setError('Could not connect. Contact your admin. Unsent messages are still here.'); }
      },
      onError: (failure: Error) => { if (active) console.info('[connection]', connectionFailure(failure)); },
    } as ConstructorParameters<typeof LiveSessionClient>[0]);
    box = new MobileOutbox(new OutboxStore(SecureStore, config), sdk, (items, notice) => {
      if (!active) return;
      setRecords(items);
      setError(previous => reconciledSendNotice(previous, items, notice));
    }, undefined, undefined, undefined, true);
    outboxRef.current = box;
    setSession({ config, client: sdk }); setStatus('connecting'); setLoading(true); setError('');
    setRecords([]);
    (async () => {
      try {
        await box.start();
        if (active && appActive.current) await sdk.connect();
      } catch { if (active) { setLoading(false); setError("Could not load your messages. Don't clear this app's data; reopen the app."); } }
    })();
    return () => { active = false; sdk.close(); void box?.stop(); if (outboxRef.current === box) outboxRef.current = null; };
  }, [config]);

  useEffect(() => {
    if (!client) return;
    const sub = AppState.addEventListener('change', state => {
      appActive.current = state === 'active';
      if (state !== 'active') { outboxRef.current?.setConnection('suspended'); client.suspendConnection(); setStatus('suspended'); return; }
      setStatus('connecting');
      client.connect().catch(() => { /* SDK retry loop owns recovery */ });
    });
    return () => sub.remove();
  }, [client]);


  const run = async (fn: () => Promise<void>, fallback = 'Could not complete that action. Try again later.') => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await fn(); } catch { setError(fallback); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const saveConnection = () => run(async () => {
    if (pairingBusy) return;
    const code = normalizePairingCode(pairingCode);
    const existing = restorePairing(await SecureStore.getItemAsync(PAIRING_KEY));
    const next = existing && existing.config.baseUrl === base.replace(/\/$/, '') && existing.code === code
      ? existing : newPairing(base, code, Platform.OS === 'ios' ? 'iPhone' : 'Android', Crypto.randomUUID(), await Crypto.getRandomBytesAsync(44));
    setPendingPairing(next); setPairingEpoch(n => n + 1);
  }, 'Invalid pairing code. Check it and try again.');
  const forget = () => run(async () => {
    pairingTask.current?.controller.abort();
    await pairingTask.current?.promise.catch(() => {});
    await SecureStore.deleteItemAsync(PAIRING_KEY);
    setPendingPairing(null);
    const old = outboxRef.current;
    if (old) { await old.stop(); await old.storage.clear(); forgottenConnections.current.add(old.storage.connectionId); }
    await SecureStore.deleteItemAsync(CONFIG_KEY);
    textDrafts.current.clear(); composerDrafts.current.forEach(releaseComposerDraft); composerDrafts.current.clear();
    setRecords([]); setSession(null); setConfig(null); setIdentity(n => n + 1); setPairingCode(''); setEditing(false); setStatus('suspended');
    router.replace('/connection');
  });
  const cancelPairing = () => run(async () => {
    pairingTask.current?.controller.abort();
    await pairingTask.current?.promise.catch(() => {});
    await SecureStore.deleteItemAsync(PAIRING_KEY);
    setPendingPairing(null); setPairingStatus(''); setPairingCode(''); setEditing(false);
    if (router.canGoBack()) router.back(); else router.replace('/');
  });
  const value: AppContextValue = { ready, config, client, agentName, identity, revision, records, connectionEpoch,
    loading, status, error, base, pairingCode, pendingPairing, pairingBusy, pairingStatus, busy, editing,
    setPairingCode, setEditing, saveConnection, forget, cancelPairing, textDrafts, composerDrafts, forgottenConnections, outboxRef };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('AppProvider is required');
  return context;
}

export function ThreadScreen({ threadId }: { threadId: string }) {
  const focused = useIsFocused();
  const { config } = useApp();
  // App backgrounding is not navigation. Keep this one current scene mounted;
  // only a genuinely covered/popped route releases its timeline and media.
  return focused ? <OpenedThreadScreen key={`${config?.id ?? ''}:${threadId}`} threadId={threadId} /> : null;
}

function OpenedThreadScreen({ threadId }: { threadId: string }) {
  const router = useRouter();
  const { config, client, agentName, revision, records, connectionEpoch, status, error: connectionError,
    textDrafts, composerDrafts, forgottenConnections, outboxRef } = useApp();
  const focused = useIsFocused();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const draftKey = `${config?.id ?? ''}:${threadId}`;
  const [text, setText] = useState(() => textDrafts.current.get(draftKey) || ''), [pageCursor, setPageCursor] = useState<string | null>(null), [historyBusy, setHistoryBusy] = useState(false);
  useEffect(() => {
    if (text) textDrafts.current.set(draftKey, text);
    else textDrafts.current.delete(draftKey);
  }, [text, draftKey, textDrafts]);
  const [attachmentDraft, setAttachmentDraft] = useState<{ scope: string; items: Attachment[]; busy: boolean }>({ scope: '', items: [], busy: false });
  const [attachmentClearKey, setAttachmentClearKey] = useState(0);
  const composerScope = `${config?.id || ''}:${threadId}`;
  const currentComposer = useRef(composerScope);
  currentComposer.current = composerScope;
  useEffect(() => {
    currentComposer.current = composerScope;
    return () => { currentComposer.current = ''; };
  }, [composerScope]);
  const onAttachmentsChange = useCallback((items: Attachment[], uploading: boolean) => {
    if (currentComposer.current === composerScope) setAttachmentDraft({ scope: composerScope, items, busy: uploading });
  }, [composerScope]);
  const draftAttachments = attachmentDraft.scope === composerScope ? attachmentDraft.items : [];
  const attachmentsBusy = attachmentDraft.scope === composerScope && attachmentDraft.busy;
  const renderAttachments = useCallback((row: TimelineRow) => client && row.attachments?.length
    ? <MessageAttachments client={client} threadId={threadId} attachments={row.attachments} /> : null, [client, threadId]);
  const [located, setLocated] = useState(false), [startRef, setStartRef] = useState<number | null>(null);
  const timelineRef = useRef<ChatTimelineHandle>(null);
  // Every entry opens at the latest message; keep only the loaded history window.
  const [entryPosition] = useState<TimelinePosition>(() => ({ offset: 0, following: true, startRef: null }));
  const receiptHydrator = useRef<VisibleReceiptHydrator | null>(null);
  if (!receiptHydrator.current) receiptHydrator.current = new VisibleReceiptHydrator();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const busyRef = useRef(false);
  const openingRef = useRef(0);
  const ownedWatch = useRef<object | null>(null);
  const tailRepairRef = useRef<{ controller: AbortController } | null>(null);
  const appActive = useRef(AppState.currentState === 'active');
  const [foreground, setForeground] = useState(appActive.current);
  const [visibleRefs, setVisibleRefs] = useState<number[]>([]);
  const onVisibleRefs = useCallback((refs: number[]) => setVisibleRefs(old => old.length === refs.length && old.every((v, i) => v === refs[i]) ? old : refs), []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => { appActive.current = state === 'active'; setForeground(appActive.current); });
    return () => sub.remove();
  }, []);
  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    return () => { focusedRef.current = false; ++openingRef.current; setHistoryBusy(false); tailRepairRef.current?.controller.abort(); tailRepairRef.current = null; receiptHydrator.current?.cancel(); };
  }, []));

  const run = async (fn: () => Promise<void>, fallback = 'Could not complete that action. Try again later.') => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    // This state belongs only to this route; a hidden retained chat still needs
    // its failure/busy state settled when the user returns from settings.
    try { await fn(); } catch { setError(fallback); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const openThread = async (id: string) => {
    if (!client || !focusedRef.current || !appActive.current) return;
    const opening = ++openingRef.current;
    setPageCursor(null); setHistoryBusy(true); setLocated(false); setStartRef(null);
    try {
      const openingTask = client.openConversation(id); ownedWatch.current = client.currentConversationKey;
      await openingTask;
      const current = () => focusedRef.current && appActive.current && opening === openingRef.current && client.currentThreadId === id;
      if (!current()) return;
      const blocks = await loadHistoryBlocks(client, id, null, client.currentOlderCursor, { current, onCursor: setPageCursor });
      if (!blocks || !current()) return;
      setPageCursor(blocks.olderCursor); setStartRef(blocks.startRef); setLocated(true);
    } catch { if (focusedRef.current && opening === openingRef.current) setError('Could not open this conversation. It will resume when the connection returns.'); }
    finally { if (focusedRef.current && opening === openingRef.current) setHistoryBusy(false); }
  };
  const loadOlder = async () => {
    if (!client || !focusedRef.current || !appActive.current || historyBusy) return;
    timelineRef.current?.holdPosition();
    const opening = openingRef.current, id = threadId;
    setHistoryBusy(true);
    try {
      const blocks = await loadHistoryBlocks(client, id, visibleMessages[0]?.ref_seq ?? null, client.supportsLatest ? pageCursor : null, {
        current: () => focusedRef.current && opening === openingRef.current,
        onCursor: setPageCursor
      });
      if (!focusedRef.current || opening !== openingRef.current) return;
      if (blocks) setStartRef(blocks.startRef);
    } catch { if (appActive.current && focusedRef.current && opening === openingRef.current) setError('Could not load earlier messages. Your current conversation is still available.'); }
    finally { if (focusedRef.current && opening === openingRef.current) setHistoryBusy(false); }
  };
  const send = () => run(async () => {
    const box = outboxRef.current;
    if (!config || !focusedRef.current || !box || box.storage.connectionId !== config.id) return;
    if (attachmentsBusy) return;
    const original = text, scope = composerScope;
    const selectedDraft = composerDrafts.current.get(draftKey);
    await box.enqueue(newSend(config, threadId, original, 'mob_' + Crypto.randomUUID(), draftAttachments));
    if (outboxRef.current === box && textDrafts.current.get(draftKey) === original) textDrafts.current.delete(draftKey);
    const retainedDraft = composerDrafts.current.get(draftKey);
    if (selectedDraft && retainedDraft && selectedDraft.items.length === retainedDraft.items.length && selectedDraft.items.every((item, index) => item === retainedDraft.items[index])) {
      composerDrafts.current.delete(draftKey);
      if (currentComposer.current !== scope) releaseComposerDraft(retainedDraft);
    }
    if (currentComposer.current === scope) {
      timelineRef.current?.followLatest();
      setText((old: string) => old === original ? '' : old);
      setAttachmentDraft({ scope, items: [], busy: false });
      setAttachmentClearKey(value => value + 1);
    }
  }, "Message not saved or sent. Don't clear this app's data; try again.");
  const answer = (item: Interaction, choice: string) => run(async () => {
    if (!client || !focusedRef.current) return;
    const current = await client.getInteraction(item.thread_id, item.id);
    if (current.state !== 'pending' || current.generation !== item.generation) throw new Error('Request is no longer active');
    if (focusedRef.current) await client.answerInteraction(current, choice);
  });

  const messages = client?.messages.get(threadId) || [];
  const first = windowStart(messages, startRef ?? historyBlockStart(messages).startRef);
  const visibleMessages = located ? messages.slice(first) : [];
  const receipts = client ? [...client.receipts.values()].filter(r => r.thread_id === threadId && (r.state === 'queued' || r.state === 'running')) : [];
  const interactions = client ? [...client.interactions.values()].filter(i => i.thread_id === threadId && i.state === 'pending') : [];
  const rows = projectTimeline(visibleMessages, null, threadId, client?.drafts.get(threadId), client?.supportsSendIdentity, records, client?.receipts, interactions, messages);
  const result = client?.threads.get(threadId);
  useEffect(() => {
    if (!client || !focused || !foreground || !located || !result?.completed_unread || !result.result_version || !result.result_ref || !visibleRefs.includes(result.result_ref)) return;
    void client.markResultRead(threadId, result.result_version, result.result_ref).catch(() => {});
  }, [client, threadId, focused, foreground, located, visibleRefs, result?.completed_unread, result?.result_version, result?.result_ref, connectionEpoch, status]);

  const visibleReceiptSignature = JSON.stringify(visibleMessages.filter(m => m.role === 'user' && m.receipt_id && m.client_message_id)
    .map(m => [m.receipt_id, m.client_message_id]));
  useEffect(() => {
    if (focused && client && located && client.connectionState === 'online') receiptHydrator.current?.update(client, threadId, visibleMessages, connectionEpoch);
    else receiptHydrator.current?.cancel();
    return () => receiptHydrator.current?.cancel();
  }, [focused, client, threadId, located, visibleReceiptSignature, connectionEpoch, status]);


  const recoverLatest = async () => {
    if (!client || !focusedRef.current || !appActive.current || !client.tailIncomplete.has(threadId) || tailRepairRef.current) return;
    const task = { controller: new AbortController() }, opening = openingRef.current;
    tailRepairRef.current = task;
    try {
      // Data repair is not navigation: retain located/startRef/older cursor and
      // the generation of an ongoing pull. SDK continues the saved forward page.
      await client.recoverHistoryTail(threadId, task.controller.signal);
      if (!task.controller.signal.aborted && focusedRef.current && opening === openingRef.current)
        setError((previous: string) => previous === 'Could not update recent messages. Your current conversation is still available.' ? '' : previous);
    } catch {
      if (!task.controller.signal.aborted && appActive.current && focusedRef.current && opening === openingRef.current)
        setError('Could not update recent messages. Your current conversation is still available.');
    } finally {
      if (tailRepairRef.current === task) tailRepairRef.current = null;
    }
  };
  useEffect(() => {
    if (focused && client && located && client.tailIncomplete.has(threadId)) void recoverLatest();
  }, [focused, revision, client, threadId, located, connectionEpoch, status]);
  useEffect(() => {
    if (focused && client && client.threads.has(threadId) && !located && !historyBusy && !pageCursor) void openThread(threadId);
  }, [focused, client, threadId, revision, connectionEpoch]);
  useEffect(() => {
    return () => { ++openingRef.current; tailRepairRef.current?.controller.abort(); tailRepairRef.current = null; receiptHydrator.current?.cancel(); if (client?.currentThreadId === threadId && client.currentConversationKey === ownedWatch.current) client.closeConversation(); };
  }, [client, threadId]);

  const selected = client?.threads.get(threadId);
  if (!config || !client) return <Notice text="Opening conversation…" />;
  if (!selected || selected.archived || !client.channels.has(selected.project_id))
    return <Notice text={status === 'online' ? 'This conversation is unavailable.' : 'Opening conversation…'} />;
  return <View style={styles.flex}>
    <Stack.Screen options={{ title: selected.title || 'Conversation',
      headerRight: () => <HeaderActions onConnection={() => router.push('/connection')} onSettings={() => router.push('/settings')} /> }} />
    {!!(error || connectionError) && <Text style={styles.error}>{error || connectionError}</Text>}
    <ChatTimeline ref={timelineRef} active={focusedRef.current} threadId={threadId} rows={rows}
      startRef={visibleMessages[0]?.ref_seq ?? null} hasOlder={located && (first > 0 || !!pageCursor && client.supportsLatest)}
      locatingMessage={!located && !historyBusy ? client.supportsLatest ? 'Could not load this conversation. Try opening it again.' : pageCursor ? 'More messages to load before the latest conversation.' : 'Could not open this yet. It will resume when the connection returns.' : undefined}
      onLocateNext={!located ? () => { void openThread(threadId); } : undefined} locatingBusy={historyBusy}
      onOlder={loadOlder}
      position={entryPosition} onPosition={() => {}}
      onVisibleRefs={onVisibleRefs}
      text={text} onText={setText} onSend={send}
      attachmentCount={draftAttachments.length} attachmentsBusy={attachmentsBusy} renderAttachments={renderAttachments}
      typingIndicator={<TypingIndicator active={isAgentTyping(threadId, receipts, interactions, status === 'online')} name={agentName.name} />}
      composerAccessory={(controls, onHeight) => <AttachmentComposer key={composerScope} client={client} threadId={threadId} initialDraft={composerDrafts.current.get(draftKey)} onDraftChange={draft => { if (config && forgottenConnections.current.has(config.id)) { releaseComposerDraft(draft); return; } if (draft.items.length) composerDrafts.current.set(draftKey, draft); else composerDrafts.current.delete(draftKey); }} onChange={onAttachmentsChange} onPasteText={value => { if (focusedRef.current && currentComposer.current === composerScope) timelineRef.current?.pasteText(value); }} clearKey={attachmentClearKey} disabled={busy} onComposerHeight={onHeight}>{controls}</AttachmentComposer>}
      receipts={receipts} interactions={interactions} answers={answers}
      onAnswerText={(id, value) => setAnswers(old => ({ ...old, [id]: value }))} onAnswer={answer}
      onDeleteFailed={id => run(async () => {
        const box = outboxRef.current;
        if (!focusedRef.current || !config || !box || box.storage.connectionId !== config.id) return;
        await box.deleteFailed(threadId, id);
      }, 'Could not finish deleting this saved message. Try again; do not clear your app data.')}
      onCancel={r => run(async () => { await client.cancelQueued(threadId, r.id); })}
      onStop={() => run(async () => { const stopped = await client.stop(threadId); if (!stopped) throw new Error('Nothing is running to stop'); })} busy={busy} />
  </View>;
}

export function Notice({ text }: { text: string }) {
  return <View style={styles.center}><Text style={styles.hint}>{text}</Text></View>;
}

export function FormKeyboardAvoidingView({ children }: { children: React.ReactNode }) {
  const focused = useIsFocused();
  const keyboardVisible = useKeyboardState(state => state.isVisible);
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  // Retained forms must explicitly restore zero padding. Controller's height
  // mode returns {} on disable, leaving Reanimated's native height/flex behind.
  // The hidden-header home route still starts below the top safe-area inset.
  return <KeyboardAvoidingView style={styles.flex} behavior="padding"
    keyboardVerticalOffset={Math.max(headerHeight, insets.top)} enabled={focused && keyboardVisible}>
    {children}
  </KeyboardAvoidingView>;
}

export function ChannelsScreen({ channelId = null }: { channelId?: string | null }) {
  const { ready, config, client, error, outboxRef } = useApp();
  const router = useRouter();
  if (!ready) return <Notice text="Opening…" />;
  if (!config || !client) return <Notice text="Opening…" />;
  if (channelId && !client.channels.has(channelId))
    return <Notice text={client.connectionState === 'online' ? 'This channel is unavailable.' : 'Opening channel…'} />;
  return <View style={styles.flex}>
    {!channelId && <View style={styles.header}><View style={styles.flex}><Text style={styles.brandSmall}>Hermes App</Text></View>
      <HeaderActions onConnection={() => router.push('/connection')} onSettings={() => router.push('/settings')} />
    </View>}
    {!!error && <Text style={styles.error}>{error}</Text>}
    <FormKeyboardAvoidingView>
      <ChannelScreens key={config.id} client={client} channelId={channelId} onChannel={id => { if (id) router.push({ pathname: '/channels/[channelId]', params: { channelId: id } }); }}
        onThread={id => router.push({ pathname: '/threads/[threadId]', params: { threadId: id } })}
        onNewChannel={() => router.push('/new-channel')}
        onContext={id => router.push({ pathname: '/channels/[channelId]/context', params: { channelId: id } })}
        onFiles={id => router.push({ pathname: '/channels/[channelId]/files', params: { channelId: id } })}
        onAgents={id => router.push({ pathname: '/channels/[channelId]/agents', params: { channelId: id } })}
        enqueueFirstMessage={async (threadId, messageId, text, attachments) => {
          const box = outboxRef.current;
          if (!box || box.storage.connectionId !== config.id) throw new Error('Connection changed');
          await box.enqueue(newSend(config, threadId, text, messageId, attachments));
        }} />
    </FormKeyboardAvoidingView>
  </View>;
}

export function ConnectionRoute() {
  const { ready, config, pairingCode, setPairingCode, pendingPairing, busy, pairingBusy, pairingStatus, error,
    saveConnection, forget, cancelPairing, setEditing } = useApp();
  const router = useRouter();
  if (!ready) return <Notice text="Opening…" />;
  return <FormKeyboardAvoidingView>
    <ConnectionScreen code={pairingCode} onCode={setPairingCode}
      connected={!!config} pairing={!!pendingPairing} busy={busy || pairingBusy} status={pairingStatus} error={error}
      onPair={saveConnection} onBack={() => { if (pendingPairing) cancelPairing(); else { setEditing(false); if (router.canGoBack()) router.back(); else router.replace('/'); } }}
      onForget={forget} />
  </FormKeyboardAvoidingView>;
}

export function SettingsRoute() {
  const { config, client, agentName } = useApp();
  const router = useRouter();
  if (!config || !client) return <Notice text="Opening settings…" />;
  return <FormKeyboardAvoidingView>
    <AgentSettings key={config.id} name={agentName.name} ready={agentName.ready} error={agentName.error}
      saving={agentName.saving} onSave={agentName.save} onRetry={agentName.reload} onClose={() => router.back()}>
      <ModelSettings key={config.id} client={client} />
      <FontSizeSettings />
    </AgentSettings>
  </FormKeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { paddingLeft: 16, paddingRight: 8, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 6, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  brandSmall: { fontSize: 19, fontWeight: '700', color: '#14283e' },
  hint: { color: '#607187', fontSize: 12, margin: 9 }, error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10 },
  button: { backgroundColor: '#2960ad', borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', margin: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 2 }, headerLink: { color: '#2b4e81', fontSize: 13, fontWeight: '600' },
  headerIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' }, headerIconPressed: { backgroundColor: '#e6edf7' },
  secondary: { backgroundColor: '#e6edf7' }, disabled: { opacity: 0.5 }, buttonText: { color: '#fff', fontWeight: '600', fontSize: 13 }, secondaryText: { color: '#2b4e81' },
});
