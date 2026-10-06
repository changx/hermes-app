import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { LocalDraftMap } from '../../../packages/client/src/localDraftMap';
import { bindLocalDraftStorage } from './localDraftStorage';
import { Alert, AppState, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { FontSizeSettings, Text } from './FontSize';
import { useKeyboardState } from 'react-native-keyboard-controller';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as Clipboard from 'expo-clipboard';
import { buildSessionLink } from '../../../packages/client/src/sessionLinks';
import { connectionFailure, isRetryableError } from '../../../packages/client/src/index';
import { NetworkStatusToast } from './NetworkStatusToast';
import { LiveSessionClient } from '../../../packages/client/src/liveClient';
import { LivePageClient } from '../../../packages/client/src/livePages';
import { SessionNavigationProvider, useSessionNavigation } from './sessionNavigation';
import type { Attachment, Interaction, Message } from '../../../packages/client/src/index';
import { nativeTransport } from './transport';
import { DEFAULT_BASE, connection, newSend } from './send';
import { ConnectionScreen } from './ConnectionScreen';
import { CONFIG_KEY, PAIRING_KEY, completePairing, newPairing, normalizePairingCode, restorePairing, type PendingPairing } from './pairing';
import type { Connection, SendRecord } from './send';
import { MobileOutbox, OutboxStore, type NetworkState } from './outbox';
import { ChatTimeline, ConversationLoading, type ChatTimelineHandle } from './ChatTimeline';
import { ChannelScreens } from './ChannelScreens';
import { LabelPills, LabelsEditor } from './SessionLabels';
import { projectTimeline } from './timeline';
import { VisibleReceiptHydrator } from './receiptHydration';
import { RenderResourceProvider } from './RenderResources';

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
export function HeaderActions({ onConnection, onSettings, onCopyLink, onSessionMenu }: { onConnection: () => void; onSettings: () => void; onCopyLink?: () => void; onSessionMenu?: () => void }) {
  return <View style={styles.headerActions}>
    {onSessionMenu ? <HeaderIcon label="Session options" ios="ellipsis" android="more_horiz" onPress={onSessionMenu} /> : onCopyLink && <HeaderIcon label="Copy session link" ios="link" android="link" onPress={onCopyLink} />}
    <HeaderIcon label="Connection" ios="antenna.radiowaves.left.and.right" android="wifi" onPress={onConnection} />
    <HeaderIcon label="Agent settings" ios="gearshape" android="settings" onPress={onSettings} />
  </View>;
}
type AppContextValue = {
  ready: boolean; config: Connection | null; client: LivePageClient | null;
  agentName: ReturnType<typeof useAgentName>; identity: number; revision: number;
  records: SendRecord[]; connectionEpoch: number; loading: boolean; status: NetworkState; error: string;
  base: string; pairingCode: string; pendingPairing: PendingPairing | null; pairingBusy: boolean;
  pairingStatus: string; busy: boolean; editing: boolean;
  setPairingCode: (value: string) => void; setEditing: (value: boolean) => void;
  saveConnection: () => void; forget: () => void; cancelPairing: () => void;
  textDrafts: React.RefObject<LocalDraftMap<string>>; outboxRef: React.RefObject<MobileOutbox | null>;
  composerDrafts: React.RefObject<LocalDraftMap<ComposerDraft>>;
  forgottenConnections: React.RefObject<Set<string>>;
};
const AppContext = createContext<AppContextValue | null>(null);
const EMPTY_MESSAGES: Message[] = [];

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
  const [session, setSession] = useState<{ config: Connection; client: LivePageClient } | null>(null);
  const client = session?.config === config ? session.client : null;
  const [identity, setIdentity] = useState(0);
  const [revision, setRevision] = useState(0), [busy, setBusy] = useState(false);
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [loading, setLoading] = useState(false), [status, setStatus] = useState<NetworkState>('suspended'), [error, setError] = useState('');
  const [retryAt, setRetryAt] = useState<number | null>(null), [networkFailed, setNetworkFailed] = useState(false);
  // Only unsent user input survives leaving a conversation.
  const textDrafts = useRef(new LocalDraftMap<string>(value => !!value.trim()));
  const composerDrafts = useRef(new LocalDraftMap<ComposerDraft>(value => value.items.length > 0));
  const forgottenConnections = useRef(new Set<string>());
  const [records, setRecords] = useState<SendRecord[]>([]);
  const outboxRef = useRef<MobileOutbox | null>(null);
  const busyRef = useRef(false);
  const appActive = useRef(AppState.currentState === 'active');

  useEffect(() => {
    let mounted = true;
    let stopDraftStorage: (() => void) | undefined;
    Promise.all([SecureStore.getItemAsync(CONFIG_KEY), SecureStore.getItemAsync(PAIRING_KEY)]).then(([raw, savedPairing]) => {
      if (!mounted) return;
      stopDraftStorage = bindLocalDraftStorage(textDrafts.current, composerDrafts.current, () => {
        if (mounted) setError("Your draft could not be saved on this device. Keep the app open and copy your text before closing it.");
      });
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
    }).catch(() => { if (mounted) setError("Could not load your connection or local drafts. Don't clear this app's data; reopen the app."); }).finally(() => { if (mounted) setReady(true); });
    return () => { mounted = false; stopDraftStorage?.(); };
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
    const sdk = new LivePageClient({ ...transport, token: () => config.token,
      onChange: () => { if (active) { setRevision((n: number) => n + 1); box?.reconcile(); } },
      onConnectionState: (state: NetworkState) => {
        if (!active) return;
        setStatus(state); box?.setConnection(state);
        if (state === 'connecting' || state === 'syncing' || state === 'online') setNetworkFailed(false);
        if (state === 'online') { setLoading(false); setError(previous => previous.startsWith('Could not connect') ? '' : previous); setConnectionEpoch((n: number) => n + 1); box?.reconcile(); }
        if (state === 'blocked') { setLoading(false); setError('Could not connect. Contact your admin. Unsent messages are still here.'); }
      },
      onRetryScheduled: (deadline: number | null) => { if (active) setRetryAt(deadline); },
      onError: (failure: Error) => { if (active) { console.info('[connection]', connectionFailure(failure)); if (!isRetryableError(failure)) setNetworkFailed(true); } },
    } as ConstructorParameters<typeof LivePageClient>[0]);
    box = new MobileOutbox(new OutboxStore(SecureStore, config), sdk, (items, notice) => {
      if (!active) return;
      setRecords(items);
      setError(previous => reconciledSendNotice(previous, items, notice));
    }, undefined, undefined, undefined, true);
    outboxRef.current = box;
    setSession({ config, client: sdk }); setStatus('connecting'); setRetryAt(null); setNetworkFailed(false); setLoading(true); setError('');
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
      if (state !== 'active') { outboxRef.current?.setConnection('suspended'); client.suspendConnection(); setStatus('suspended'); setNetworkFailed(false); return; }
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
    if (config) forgottenConnections.current.add(config.id);
    if (old) { await old.stop(); await old.storage.clear(); forgottenConnections.current.add(old.storage.connectionId); }
    await SecureStore.deleteItemAsync(CONFIG_KEY);
    const prefix = (old?.storage.connectionId ?? config?.id) + ':';
    for (const key of [...textDrafts.current.keys()]) if (key.startsWith(prefix)) textDrafts.current.delete(key);
    for (const [key, draft] of [...composerDrafts.current]) if (key.startsWith(prefix)) { composerDrafts.current.delete(key); releaseComposerDraft(draft); }
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
  return <AppContext.Provider value={value}><SessionNavigationProvider value={{ hasPage: id => !!client?.page(id), server: config?.baseUrl }}><View style={styles.flex}>{children}{client && <NetworkStatusToast state={status} retryAt={retryAt} failed={networkFailed} />}</View></SessionNavigationProvider></AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('AppProvider is required');
  return context;
}

export function ThreadScreen({ threadId, targetRef }: { threadId: string; targetRef?: number }) {
  const { config } = useApp();
  // Native Stack owns mount/unmount. Blur is only a visibility signal, not
  // permission to destroy a page that a detail reader/settings has covered.
  return <OpenedThreadScreen key={`${config?.id ?? ''}:${threadId}`} threadId={threadId} targetRef={targetRef} />;
}

function OpenedThreadScreen({ threadId, targetRef }: { threadId: string; targetRef?: number }) {
  const { client: account } = useApp();
  const [owner, setOwner] = useState<{ account: LivePageClient; id: string; page: LiveSessionClient } | null>(null);
  // Registration is a committed lifetime, never a render side effect. A render
  // that suspends/is discarded owns nothing. Effect replay reacquires a fresh
  // owner before rendering its contents; cleanup releases only that exact owner.
  useEffect(() => {
    if (!account) return;
    const page = account.acquirePage(threadId);
    setOwner({ account, id: threadId, page });
    return () => { account.releasePage(threadId, page); };
  }, [account, threadId]);
  if (!owner || owner.account !== account || owner.id !== threadId) return null;
  if (account?.page(threadId) !== owner.page) return <Notice text="This conversation is unavailable." />;
  return <RenderResourceProvider><MountedThreadScreen client={owner.page} threadId={threadId} targetRef={targetRef} /></RenderResourceProvider>;
}

function MountedThreadScreen({ client, threadId, targetRef }: { client: LiveSessionClient; threadId: string; targetRef?: number }) {
  const router = useRouter();
  const { client: accountClient, config, agentName, revision, records, connectionEpoch, status, error: connectionError,
    textDrafts, composerDrafts, forgottenConnections, outboxRef } = useApp();
  const focused = useIsFocused();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const [editingLabels, setEditingLabels] = useState(false);
  const draftKey = `${config?.id ?? ''}:${threadId}`;
  const [text, setText] = useState(() => textDrafts.current.get(draftKey) || ''), [historyBusy, setHistoryBusy] = useState(false);
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
  const [located, setLocated] = useState(false);
  const [anchor, setAnchor] = useState(targetRef);
  const timelineRef = useRef<ChatTimelineHandle>(null);
  // Entry loads the complete transcript once; the timeline renders every row.
  const [entryPosition] = useState(() => ({ following: targetRef === undefined }));
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
  const openThread = async (id: string, requestedRef: number | undefined) => {
    if (!client || !focusedRef.current || !appActive.current) return;
    const opening = ++openingRef.current;
    setHistoryBusy(true); setLocated(false);
    let contentShown = false;
    const releaseContent = () => {
      if (contentShown || !focusedRef.current || !appActive.current || opening !== openingRef.current || client.currentThreadId !== id) return;
      contentShown = true;
      setLocated(true); setHistoryBusy(false);
    };
    try {
      const openingTask = client.openConversation(id, requestedRef, undefined, releaseContent); ownedWatch.current = client.currentConversationKey;
      await openingTask;
      releaseContent();
    } catch { if (focusedRef.current && opening === openingRef.current) setError(contentShown ? 'Could not refresh conversation status. It will resume when the connection returns.' : requestedRef === undefined ? 'Could not open this conversation. It will resume when the connection returns.' : 'Could not open the source message. It may no longer be available.'); }
    finally { if (!contentShown && focusedRef.current && opening === openingRef.current) setHistoryBusy(false); }
  };
  const showLatest = () => run(async () => { setAnchor(undefined); await openThread(threadId, undefined); if (focusedRef.current) timelineRef.current?.followLatest(); });
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
      if (anchor !== undefined) { setAnchor(undefined); await openThread(threadId, undefined); }
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

  const messages = client.messages.get(threadId) ?? EMPTY_MESSAGES;
  const visibleMessages = located ? messages : EMPTY_MESSAGES;
  // Scoped receipt/interaction maps mutate in place. Their small signatures are
  // dependencies, while transcript objects never enter a serialized signature.
  const receiptSignature = JSON.stringify([...client.receipts.values()]);
  const interactionSignature = JSON.stringify([...client.interactions.values()]);
  const receipts = useMemo(() => [...client.receipts.values()].filter(r => r.thread_id === threadId && (r.state === 'queued' || r.state === 'running')), [client, threadId, receiptSignature]);
  const interactions = useMemo(() => [...client.interactions.values()].filter(i => i.thread_id === threadId && i.state === 'pending'), [client, threadId, interactionSignature]);
  const draft = client.drafts.get(threadId);
  const rows = useMemo(() => projectTimeline(visibleMessages, null, threadId, draft, client.supportsSendIdentity, records, client.receipts, interactions, messages),
    [visibleMessages, threadId, draft, client, client.supportsSendIdentity, records, receiptSignature, interactions, messages]);
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
      // Data repair is not navigation: retain located state and
      // any ongoing open. SDK continues the saved forward page.
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
    const lostOwnership = client && (client.currentThreadId !== threadId || client.currentConversationKey !== ownedWatch.current);
    if (focused && client && client.threads.has(threadId) && (!located || lostOwnership) && !historyBusy && (anchor === undefined || !error)) void openThread(threadId, anchor);
  }, [focused, client, threadId, revision, connectionEpoch]);
  useEffect(() => {
    return () => { ++openingRef.current; tailRepairRef.current?.controller.abort(); tailRepairRef.current = null; receiptHydrator.current?.cancel(); };
  }, [client, threadId]);

  const selected = accountClient?.threads.get(threadId);
  if (!config || !client) return <Notice text="Opening conversation…" />;
  if (!selected || selected.archived || !client.channels.has(selected.project_id))
    return <Notice text={status === 'online' ? 'This conversation is unavailable.' : 'Opening conversation…'} />;
  // Source navigation must mount the list only after the target rows exist, so its
  // native initial index points at the exact message rather than the latest.
  if (anchor !== undefined && !located) return <View style={styles.flex}>
    <Stack.Screen options={{ title: selected.title || 'Conversation' }} />
    {!!(error || connectionError) && <Text style={styles.error}>{error || connectionError}</Text>}
    {historyBusy ? <ConversationLoading active={focused && foreground} /> : <Pressable accessibilityRole="button" accessibilityLabel="Try again" onPress={() => { setError(''); void openThread(threadId, anchor); }}><Text>Try again</Text></Pressable>}
  </View>;
  return <View style={styles.flex}>
    <Stack.Screen options={{ title: selected.title || 'Conversation',
      headerRight: () => <HeaderActions onSessionMenu={accountClient?.supportsSessionLabels ? () => Alert.alert(selected.title, undefined, [{ text: 'Edit labels', onPress: () => setEditingLabels(true) }, { text: 'Copy session link', onPress: () => { void Clipboard.setStringAsync(buildSessionLink(config.baseUrl, threadId)).catch(() => setError('Could not copy the conversation link.')); } }, { text: 'Cancel', style: 'cancel' }]) : undefined} onCopyLink={() => { void Clipboard.setStringAsync(buildSessionLink(config.baseUrl, threadId)).catch(() => setError('Could not copy the conversation link.')); }} onConnection={() => router.push('/connection')} onSettings={() => router.push('/settings')} /> }} />
    {!!(error || connectionError) && <Text style={styles.error}>{error || connectionError}</Text>}
    {accountClient?.supportsSessionLabels && !!selected.markers?.length && <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}><LabelPills markers={selected.markers} /></View>}
    {editingLabels && accountClient && <LabelsEditor key={draftKey} client={accountClient} threadId={threadId} visible={focused} onClose={() => setEditingLabels(false)} />}
    <ChatTimeline ref={timelineRef} active={focusedRef.current} threadId={threadId} rows={rows}
      targetRef={located ? anchor : undefined} onLatest={anchor === undefined ? undefined : showLatest}
      locatingMessage={!located && !historyBusy ? client.supportsLatest ? 'Could not load this conversation. Try opening it again.' : 'Could not open this yet. It will resume when the connection returns.' : undefined}
      onLocateNext={!located ? () => { setError(''); void openThread(threadId, anchor); } : undefined} locatingBusy={historyBusy}
      position={entryPosition}
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
      onRetryFailed={id => run(async () => {
        const box = outboxRef.current;
        if (!focusedRef.current || !config || !box || box.storage.connectionId !== config.id) return;
        await box.retryFailed(threadId, id);
      }, 'Could not retry this message. It is still saved on this device.')}
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
  const navigation = useSessionNavigation();
  const { ready, config, client, error, outboxRef, textDrafts, composerDrafts } = useApp();
  const textVersion = useSyncExternalStore(textDrafts.current.subscribe, textDrafts.current.getSnapshot);
  const attachmentVersion = useSyncExternalStore(composerDrafts.current.subscribe, composerDrafts.current.getSnapshot);
  const draftThreads = useMemo(() => {
    const ids = new Set<string>(), prefix = `${config?.id ?? ''}:`;
    for (const map of [textDrafts.current, composerDrafts.current]) {
      for (const key of map.keys()) if (key.startsWith(prefix) && map.hasDraft(key)) ids.add(key.slice(prefix.length));
    }
    return ids;
  }, [config?.id, textVersion, attachmentVersion, textDrafts, composerDrafts]);
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
      <ChannelScreens key={config.id} client={client} channelId={channelId} draftThreads={draftThreads} onChannel={id => { if (id) router.push({ pathname: '/channels/[channelId]', params: { channelId: id } }); }}
        onThread={id => navigation.thread(id)}
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
