import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, KeyboardAvoidingView, Pressable, Share, StyleSheet, View } from 'react-native';
import { Stack, useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { Text } from './FontSize';
import { useKeyboardState } from 'react-native-keyboard-controller';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import { LiveSessionClient } from '../../../packages/client/src/liveClient';
import { LivePageClient } from '../../../packages/client/src/livePages';
import { useSessionNavigation } from './sessionNavigation';
import { HttpError, type Attachment, type Interaction, type Message } from '../../../packages/client/src/index';
import type { MessageActions } from './MessageToolbar';
import { newSend } from './send';
import { ChatTimeline, ConversationLoading, type ChatTimelineHandle } from './ChatTimeline';
import { ChannelScreens } from './ChannelScreens';
import { LabelPills } from './SessionLabels';
import { projectTimeline } from './timeline';
import { VisibleReceiptHydrator } from './receiptHydration';
import { RenderResourceProvider } from './RenderResources';
import { AttachmentComposer, MessageAttachments, releaseComposerDraft } from './Attachments';
import { isAgentTyping, TypingIndicator } from './TypingIndicator';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import type { TimelineRow } from './timeline';
import { useApp, useConnections } from './connections';

export { AppProvider, ConnectionScope, routeConnection, useApp, useConnections } from './connections';

export function HeaderIcon({ label, ios, android, onPress }: { label: string; ios: SFSymbol; android: AndroidSymbol; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={onPress} style={({ pressed }) => [styles.headerIcon, pressed && styles.headerIconPressed]}>
    <SymbolView name={{ ios, android }} size={21} tintColor="#2b4e81" weight="medium" fallback={<Text style={styles.headerLink}>{label}</Text>} />
  </Pressable>;
}
export const channelRoute = (connection: string, channelId: string, page: '' | '/context' | '/files' | '/agents' | '/new-topic' = '', extra: Record<string, string> = {}) =>
  ({ pathname: `/channels/[channelId]${page}` as '/channels/[channelId]', params: { channelId, connection, ...extra } });
/** Pushed label editor of one Session on one connection. */
export const labelsRoute = (connection: string, threadId: string) =>
  ({ pathname: '/threads/[threadId]/labels' as const, params: { threadId, connection } });

/** One Settings entry; connections, Agents, models and appearance live inside it. */
export function HeaderActions({ onSettings }: { onSettings: () => void }) {
  return <View style={styles.headerActions}>
    <HeaderIcon label="Settings" ios="gearshape" android="settings" onPress={onSettings} />
  </View>;
}
/** The Session page's only header entry; labels, link and Settings live on its page. */
export function SessionOptionsButton({ onPress }: { onPress: () => void }) {
  return <View style={styles.headerActions}>
    <HeaderIcon label="Session options" ios="ellipsis" android="more_horiz" onPress={onPress} />
  </View>;
}
const EMPTY_MESSAGES: Message[] = [];

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
  const { client: accountClient, config, slot, name: connectionName, multiple, agentName, revision, records, connectionEpoch, status, error: connectionError,
    textDrafts, composerDrafts, forgottenConnections, outboxRef } = useApp();
  const focused = useIsFocused();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
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

  const navigation = useSessionNavigation();
  // One request ID per tapped reply until the server gives a definite answer, so a
  // lost reply never creates a second branch.
  const branchRequests = useRef(new Map<number, string>());
  const latest = useRef({ accountClient, config, outboxRef, threadId, navigation });
  latest.current = { accountClient, config, outboxRef, threadId, navigation };
  const messageActions = useMemo<MessageActions>(() => ({
    ...(accountClient?.supportsThreadBranch ? { branch: async (row: TimelineRow) => {
      const { accountClient: owner, threadId: source, navigation: nav } = latest.current;
      if (!owner || row.refSeq === undefined) return;
      const requests = branchRequests.current;
      const requestId = requests.get(row.refSeq) ?? 'br_' + Crypto.randomUUID();
      requests.set(row.refSeq, requestId);
      setError('');
      try {
        const created = await owner.branchThread(source, row.refSeq, requestId);
        requests.delete(row.refSeq);
        if (focusedRef.current) nav.thread(created.id);
      } catch (cause) {
        if (cause instanceof HttpError && cause.code) requests.delete(row.refSeq);
        const code = cause instanceof HttpError ? cause.code : undefined;
        setError(code === 'busy' || code === 'branch_in_progress' ? 'Wait until the current reply finishes, then try again.'
          : code === 'anchor_unavailable' || code === 'anchor_not_final' ? 'This reply cannot start a branch.'
          : 'Could not create the branch. Try again.');
      }
    } } : {}),
    ...(accountClient?.supportsMessageSources ? { sources: (row: TimelineRow) => latest.current.accountClient!.messageSources(latest.current.threadId, row.refSeq!) } : {}),
    exportMessage: (row: TimelineRow) => { void Share.share({ message: row.text }).catch(() => {}); },
    retry: () => run(async () => {
      const { config: current, outboxRef: outbox, threadId: id } = latest.current;
      const box = outbox.current;
      if (!current || !focusedRef.current || !box || box.storage.connectionId !== current.id) return;
      await box.enqueue(newSend(current, id, '/retry', 'mob_' + Crypto.randomUUID(), []));
      timelineRef.current?.followLatest();
    }, 'Could not retry. Try again.'),
  }), [accountClient, accountClient?.supportsThreadBranch, accountClient?.supportsMessageSources]);

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
    <Stack.Screen options={{ title: selected.title || 'Conversation', ...(multiple ? { headerTitle: () => <HeaderTitle title={selected.title || 'Conversation'} subtitle={connectionName} /> } : {}),
      headerRight: () => <SessionOptionsButton onPress={() => router.push({ pathname: '/threads/[threadId]/options', params: { threadId, connection: slot } })} /> }} />
    {!!(error || connectionError) && <Text style={styles.error}>{error || connectionError}</Text>}
    {accountClient?.supportsSessionLabels && !!selected.markers?.length && <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}><LabelPills markers={selected.markers} /></View>}
    <ChatTimeline ref={timelineRef} active={focusedRef.current} threadId={threadId} rows={rows}
      targetRef={located ? anchor : undefined} onLatest={anchor === undefined ? undefined : showLatest}
      locatingMessage={!located && !historyBusy ? client.supportsLatest ? 'Could not load this conversation. Try opening it again.' : 'Could not open this yet. It will resume when the connection returns.' : undefined}
      onLocateNext={!located ? () => { setError(''); void openThread(threadId, anchor); } : undefined} locatingBusy={historyBusy}
      position={entryPosition}
      onVisibleRefs={onVisibleRefs}
      text={text} onText={setText} onSend={send}
      attachmentCount={draftAttachments.length} attachmentsBusy={attachmentsBusy} renderAttachments={renderAttachments}
      typingIndicator={<TypingIndicator active={isAgentTyping(threadId, receipts, interactions, status === 'online')} name={agentName.name} />}
      composerAccessory={(parts, onHeight) => <AttachmentComposer key={composerScope} send={parts.send} expanded={parts.expanded} onPressField={parts.onPressField} client={client} threadId={threadId} initialDraft={composerDrafts.current.get(draftKey)} onDraftChange={draft => { if (config && forgottenConnections.current.has(config.id)) { releaseComposerDraft(draft); return; } if (draft.items.length) composerDrafts.current.set(draftKey, draft); else composerDrafts.current.delete(draftKey); }} onChange={onAttachmentsChange} onPasteText={value => { if (focusedRef.current && currentComposer.current === composerScope) timelineRef.current?.pasteText(value); }} clearKey={attachmentClearKey} disabled={busy} onComposerHeight={onHeight}>{parts.input}</AttachmentComposer>}
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
      onStop={() => run(async () => { const stopped = await client.stop(threadId); if (!stopped) throw new Error('Nothing is running to stop'); })} busy={busy}
      messageActions={messageActions} />
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

/** Session list of one Project; the page is scoped to the Project's connection. */
export function ChannelsScreen({ channelId }: { channelId: string }) {
  const navigation = useSessionNavigation();
  const { ready, slot, config, client, error, outboxRef, textDrafts, composerDrafts } = useApp();
  const draftThreads = useDraftThreads(config?.id);
  const router = useRouter();
  if (!ready || !config || !client) return <Notice text="Opening…" />;
  if (!client.channels.has(channelId))
    return <Notice text={client.connectionState === 'online' ? 'This channel is unavailable.' : 'Opening channel…'} />;
  return <View style={styles.flex}>
    {!!error && <Text style={styles.error}>{error}</Text>}
    <FormKeyboardAvoidingView>
      <ChannelScreens key={config.id} client={client} channelId={channelId} draftThreads={draftThreads}
        onThread={id => navigation.thread(id)}
        onContext={id => router.push(channelRoute(slot, id, '/context'))}
        onFiles={id => router.push(channelRoute(slot, id, '/files'))}
        onAgents={id => router.push(channelRoute(slot, id, '/agents'))}
        onLabels={id => router.push(labelsRoute(slot, id))}
        onArchive={async () => { await client.archiveChannel(channelId); if (router.canGoBack()) router.back(); else router.replace('/'); }}
        enqueueFirstMessage={async (threadId, messageId, text, attachments) => {
          const box = outboxRef.current;
          if (!box || box.storage.connectionId !== config.id) throw new Error('Connection changed');
          await box.enqueue(newSend(config, threadId, text, messageId, attachments));
        }} />
    </FormKeyboardAvoidingView>
  </View>;
}

/** Thread IDs with a local unsent draft for one connection identity. */
export function useDraftThreads(identity: string | undefined): ReadonlySet<string> {
  const { textDrafts, composerDrafts } = useConnections();
  const textVersion = useSyncExternalStore(textDrafts.current.subscribe, textDrafts.current.getSnapshot);
  const attachmentVersion = useSyncExternalStore(composerDrafts.current.subscribe, composerDrafts.current.getSnapshot);
  return useMemo(() => {
    const ids = new Set<string>(), prefix = `${identity ?? ''}:`;
    if (!identity) return ids;
    for (const map of [textDrafts.current, composerDrafts.current]) {
      for (const key of map.keys()) if (key.startsWith(prefix) && map.hasDraft(key)) ids.add(key.slice(prefix.length));
    }
    return ids;
  }, [identity, textVersion, attachmentVersion, textDrafts, composerDrafts]);
}

/** Native header title with the Hermes name as a second line. */
export function HeaderTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return <View accessible accessibilityRole="header" accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title} style={styles.headerTitle}>
    <Text numberOfLines={1} style={styles.headerTitleText}>{title}</Text>
    {!!subtitle && <Text numberOfLines={1} style={styles.headerSubtitle}>{subtitle}</Text>}
  </View>;
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
  headerTitle: { alignItems: 'center', maxWidth: 240 }, headerTitleText: { fontSize: 17, fontWeight: '600', color: '#172a40' }, headerSubtitle: { fontSize: 12, color: '#607187' },
});
