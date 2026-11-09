import React, { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Platform, Pressable, Share, StyleSheet, View } from 'react-native';
import { Stack, useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { Text } from './FontSize';
import * as Crypto from 'expo-crypto';
import { LiveSessionClient } from '../../../packages/client/src/liveClient';
import { LivePageClient } from '../../../packages/client/src/livePages';
import { useSessionNavigation } from './sessionNavigation';
import { HttpError, type Attachment, type Interaction, type Message, type Receipt, type VaultPrompt, type VaultPromptAnswer } from '../../../packages/client/src/index';
import type { MessageActions } from './MessageToolbar';
import { newSend } from './send';
import { ChatTimeline, ConversationLoading, type ChatTimelineHandle } from './ChatTimeline';
import { ChannelScreens } from './ChannelScreens';
import { LabelPills } from './SessionLabels';
import { TODO_COLOR } from './TodoFlag';
import { sessionHeaderItems } from './sessionHeaderItems';
import { setThreadTodo } from './todoToggle';
import { hasTodo, withoutTodo } from '../../../packages/client/src/todo';
import { projectTimeline } from './timeline';
import { VisibleReceiptHydrator } from './receiptHydration';
import { RenderResourceProvider } from './RenderResources';
import { AttachmentComposer, MessageAttachments, releaseComposerDraft } from './Attachments';
import { AttachmentFiles } from './attachmentFiles';
import { isAgentTyping, TypingIndicator } from './TypingIndicator';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import type { TimelineRow } from './timeline';
import { useApp, useAppScope, useConnections } from './connections';
import { usePageVersion } from './pageUpdates';
import { FormKeyboardAvoidingView } from './FormKeyboardAvoidingView';

export { AppProvider, ConnectionScope, routeConnection, useApp, useConnections } from './connections';
export { FormKeyboardAvoidingView } from './FormKeyboardAvoidingView';

export function HeaderIcon({ label, ios, android, onPress }: { label: string; ios: SFSymbol; android: AndroidSymbol; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={onPress} style={({ pressed }) => [styles.headerIcon, pressed && styles.headerIconPressed]}>
    <SymbolView name={{ ios, android }} size={21} tintColor="#2b4e81" weight="medium" fallback={<Text style={styles.headerLink}>{label}</Text>} />
  </Pressable>;
}
export const channelRoute = (connection: string, channelId: string, page: '' | '/context' | '/agents' | '/new-topic' | '/automations' = '', extra: Record<string, string> = {}) =>
  ({ pathname: `/channels/[channelId]${page}` as '/channels/[channelId]', params: { channelId, connection, ...extra } });
/** Pushed label editor of one Session on one connection. */
export const labelsRoute = (connection: string, threadId: string) =>
  ({ pathname: '/threads/[threadId]/labels' as const, params: { threadId, connection } });
export const sessionFilesRoute = (connection: string, threadId: string) =>
  ({ pathname: '/threads/[threadId]/files' as const, params: { threadId, connection } });

/** One Settings entry; connections, Agents, models and appearance live inside it. */
export function HeaderActions({ onSettings }: { onSettings: () => void }) {
  return <View style={styles.headerActions}>
    <HeaderIcon label="Settings" ios="gearshape" android="settings" onPress={onSettings} />
  </View>;
}
/** The Session page's only header entry; labels, link and Settings live on its page. */
export function SessionOptionsButton({ onPress, todo }: { onPress: () => void; todo?: { on: boolean; busy: boolean; onPress: () => void } }) {
  return <View style={styles.headerActions}>
    {todo && <Pressable accessibilityRole="button" accessibilityLabel={todo.on ? 'Remove todo' : 'Mark as todo'} accessibilityState={{ selected: todo.on, busy: todo.busy }} disabled={todo.busy} hitSlop={6}
      onPress={todo.onPress} style={({ pressed }) => [styles.headerIcon, pressed && styles.headerIconPressed, todo.busy && styles.headerIconBusy]}>
      <SymbolView name={todo.on ? { ios: 'flag.fill', android: 'flag' } : { ios: 'flag', android: 'outlined_flag' }} size={20} tintColor={todo.on ? TODO_COLOR : '#2b4e81'} weight="medium" fallback={<Text style={styles.headerLink}>{todo.on ? 'Todo' : 'Flag'}</Text>} />
    </Pressable>}
    <HeaderIcon label="Session options" ios="ellipsis" android="more_horiz" onPress={onPress} />
  </View>;
}
const EMPTY_MESSAGES: Message[] = [];

// Memo: the route renders again for every account-wide change; this page must not.
export const ThreadScreen = memo(function ThreadScreen({ threadId, targetRef }: { threadId: string; targetRef?: number }) {
  const { config } = useAppScope();
  // Native Stack owns mount/unmount. Blur is only a visibility signal, not
  // permission to destroy a page that a detail reader/settings has covered.
  return <OpenedThreadScreen key={`${config?.id ?? ''}:${threadId}`} threadId={threadId} targetRef={targetRef} />;
});

function OpenedThreadScreen({ threadId, targetRef }: { threadId: string; targetRef?: number }) {
  const { client: account } = useAppScope();
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

const MountedThreadScreen = memo(function MountedThreadScreen({ client, threadId, targetRef }: { client: LiveSessionClient; threadId: string; targetRef?: number }) {
  const router = useRouter();
  // Battery: this page renders for changes of its own page and account only, and
  // waits while it is hidden. See docs/mobile-battery.md.
  const { client: accountClient, config, slot, name: connectionName, multiple, agentName, records, connectionEpoch, status, error: connectionError,
    textDrafts, composerDrafts, forgottenConnections, outboxRef } = useAppScope();
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
  // One download store per Thread page: rows and the gallery share files, so each downloads once.
  const attachmentFiles = useMemo(() => new AttachmentFiles(client, threadId), [client, threadId]);
  useEffect(() => () => attachmentFiles.dispose(), [attachmentFiles]);
  // Read at tap time, so the gallery shows every attachment the timeline holds then.
  const galleryRows = useRef<readonly TimelineRow[]>([]);
  const gallery = useCallback(() => galleryRows.current.map(row => row.attachments), []);
  const renderAttachments = useCallback((row: TimelineRow) => row.attachments?.length
    ? <MessageAttachments files={attachmentFiles} attachments={row.attachments} gallery={gallery} server={config?.baseUrl} /> : null, [attachmentFiles, gallery, config?.baseUrl]);
  const [located, setLocated] = useState(false);
  // Only a finished open that showed no content is a failure. Not located and
  // not busy also covers an open that has not started yet (the first render,
  // a new session just confirmed) or was interrupted; that is still loading.
  const [openFailed, setOpenFailed] = useState(false);
  const awaitingOpen = !located && !historyBusy && !openFailed;
  const [anchor, setAnchor] = useState(targetRef);
  const timelineRef = useRef<ChatTimelineHandle>(null);
  // Entry loads the complete transcript once; the timeline renders every row.
  const [entryPosition] = useState(() => ({ following: targetRef === undefined }));
  const receiptHydrator = useRef<VisibleReceiptHydrator | null>(null);
  if (!receiptHydrator.current) receiptHydrator.current = new VisibleReceiptHydrator();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  // The flag saves on its own; the composer stays usable meanwhile.
  const [todoBusy, setTodoBusy] = useState(false);
  const busyRef = useRef(false);
  const openingRef = useRef(0);
  const ownedWatch = useRef<object | null>(null);
  const tailRepairRef = useRef<{ controller: AbortController } | null>(null);
  const appActive = useRef(AppState.currentState === 'active');
  const [foreground, setForeground] = useState(appActive.current);
  const pageVersion = usePageVersion(client, accountClient, focused && foreground);
  // Visible rows change many times while scrolling. Keep them in a ref; only the
  // completed-result row being in view is state, so scrolling does not render the page.
  const visibleRefs = useRef<readonly number[]>([]);
  const resultRefSeq = useRef<number | undefined>(undefined);
  const [resultInView, setResultInView] = useState<number | undefined>(undefined);
  const onVisibleRefs = useCallback((refs: number[]) => {
    visibleRefs.current = refs;
    const target = resultRefSeq.current;
    setResultInView(target !== undefined && refs.includes(target) ? target : undefined);
  }, []);

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
    setHistoryBusy(true); setLocated(false); setOpenFailed(false);
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
    finally { if (!contentShown && focusedRef.current && opening === openingRef.current) { setHistoryBusy(false); setOpenFailed(true); } }
  };
  const showLatest = () => run(async () => { setAnchor(undefined); await openThread(threadId, undefined); if (focusedRef.current) timelineRef.current?.followLatest(); });
  const send = () => run(async () => {
    const box = outboxRef.current;
    if (!config || !focusedRef.current || !box || box.storage.connectionId !== config.id) return;
    if (attachmentsBusy) return;
    const original = text, scope = composerScope;
    const selectedDraft = composerDrafts.current.get(draftKey);
    // While the session is still being created, a later text message carries the same
    // create request: whichever message the outbox sends first creates it (same ID).
    await box.enqueue(newSend(config, threadId, original, 'mob_' + Crypto.randomUUID(), draftAttachments, starting && !draftAttachments.length ? starting : undefined));
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
  // One send per vault prompt; the server takes the first answer. The values never leave this call.
  const answerVault = (prompt: VaultPrompt, value: VaultPromptAnswer) => run(async () => {
    if (!client || !focusedRef.current) return;
    await client.answerVaultPrompt(prompt, value);
  }, 'That request is no longer open. Hermes will ask again if it still needs it.');

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
  const startingActions = useMemo<MessageActions>(() => ({ exportMessage: messageActions.exportMessage }), [messageActions]);

  // A new session whose first message is saved but whose create is not confirmed yet:
  // show it at once from the outbox record; the normal open runs once the server has it.
  // Both views give ChatTimeline the same key, so the confirmation keeps the same
  // timeline. A remount would hide it until it is positioned again (a visible flash).
  const starting = accountClient?.threads.has(threadId) ? undefined : records.find(r => r.threadId === threadId && r.create)?.create;
  const ready = located || !!starting;
  const messages = client.messages.get(threadId) ?? EMPTY_MESSAGES;
  const visibleMessages = ready ? messages : EMPTY_MESSAGES;
  // Scoped receipt/interaction maps mutate in place. Their small signatures are
  // dependencies, while transcript objects never enter a serialized signature.
  const receiptSignature = JSON.stringify([...client.receipts.values()].filter(r => r.thread_id === threadId));
  const interactionSignature = JSON.stringify([...client.interactions.values()].filter(i => i.thread_id === threadId));
  const receipts = useMemo(() => [...client.receipts.values()].filter(r => r.thread_id === threadId && (r.state === 'queued' || r.state === 'running')), [client, threadId, receiptSignature]);
  const interactions = useMemo(() => [...client.interactions.values()].filter(i => i.thread_id === threadId && i.state === 'pending'), [client, threadId, interactionSignature]);
  const vaultSignature = JSON.stringify([...client.vaultPrompts.values()].filter(p => p.thread_id === threadId).map(p => p.id));
  const vaultPrompts = useMemo(() => [...client.vaultPrompts.values()].filter(p => p.thread_id === threadId), [client, threadId, vaultSignature]);
  const draft = client.drafts.get(threadId);
  const rows = useMemo(() => projectTimeline(visibleMessages, null, threadId, draft, client.supportsSendIdentity, records, client.receipts, interactions, messages),
    [visibleMessages, threadId, draft, client, client.supportsSendIdentity, records, receiptSignature, interactions, messages]);
  galleryRows.current = rows;
  const result = client?.threads.get(threadId);
  resultRefSeq.current = result?.result_ref;
  useEffect(() => {
    if (!client || !focused || !foreground || !located || !result?.completed_unread || !result.result_version || !result.result_ref) return;
    if (resultInView !== result.result_ref && !visibleRefs.current.includes(result.result_ref)) return;
    void client.markResultRead(threadId, result.result_version, result.result_ref).catch(() => {});
  }, [client, threadId, focused, foreground, located, resultInView, result?.completed_unread, result?.result_version, result?.result_ref, connectionEpoch, status]);

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
  }, [focused, pageVersion, client, threadId, located, connectionEpoch, status]);
  useEffect(() => {
    const lostOwnership = client && (client.currentThreadId !== threadId || client.currentConversationKey !== ownedWatch.current);
    if (focused && client && client.threads.has(threadId) && (!located || lostOwnership) && !historyBusy && (anchor === undefined || !error)) void openThread(threadId, anchor);
  }, [focused, client, threadId, pageVersion, connectionEpoch]);
  useEffect(() => {
    return () => { ++openingRef.current; tailRepairRef.current?.controller.abort(); tailRepairRef.current = null; receiptHydrator.current?.cancel(); };
  }, [client, threadId]);

  // Stable identities: every message row compares these props, so a new function on
  // each render would render the whole transcript again.
  const deleteFailed = useLatestCallback((id: string) => run(async () => {
    const box = outboxRef.current;
    if (!focusedRef.current || !config || !box || box.storage.connectionId !== config.id) return;
    await box.deleteFailed(threadId, id);
  }, 'Could not finish deleting this saved message. Try again; do not clear your app data.'));
  const retryFailed = useLatestCallback((id: string) => run(async () => {
    const box = outboxRef.current;
    if (!focusedRef.current || !config || !box || box.storage.connectionId !== config.id) return;
    await box.retryFailed(threadId, id);
  }, 'Could not retry this message. It is still saved on this device.'));
  const cancelQueued = useLatestCallback((r: Receipt) => run(async () => { await client.cancelQueued(threadId, r.id); }));
  const onAnswerText = useCallback((id: string, value: string) => setAnswers(old => ({ ...old, [id]: value })), []);
  const selected = accountClient?.threads.get(threadId);
  const todo = hasTodo(selected?.markers);
  const toggleTodo = () => {
    const owner = accountClient;
    if (!owner || todoBusy) return;
    setTodoBusy(true); setError('');
    void setThreadTodo(owner, threadId, !todo).then(failure => { if (failure && focusedRef.current) setError(failure); }).finally(() => setTodoBusy(false));
  };
  // Header subtitle: connection (only when several exist) and the channel name.
  const headerSubtitle = (channelId?: string) =>
    [multiple ? connectionName : '', channelId ? client?.channels.get(channelId)?.name : ''].filter(Boolean).join(' · ') || undefined;
  const headerTitle = (title: string, channelId?: string) => {
    const subtitle = headerSubtitle(channelId);
    return subtitle ? { headerTitle: () => <HeaderTitle title={title} subtitle={subtitle} /> } : {};
  };
  if (!config || !client) return <Notice text="Opening conversation…" />;
  if (starting && client.channels.has(starting.channelId)) return <View style={styles.flex}>
    <Stack.Screen options={{ title: starting.title, ...headerTitle(starting.title, starting.channelId), headerRight: undefined }} />
    {!!(error || connectionError) && <Text style={styles.error}>{error || connectionError}</Text>}
    <ChatTimeline key="timeline" ref={timelineRef} active={focusedRef.current} threadId={threadId} rows={rows} position={entryPosition} onVisibleRefs={onVisibleRefs}
      text={text} onText={setText} onSend={send} attachmentCount={0} attachmentsBusy={false} renderAttachments={renderAttachments}
      typingIndicator={<TypingIndicator active={false} name={agentName.name} />}
      receipts={receipts} interactions={interactions} answers={answers}
      onAnswerText={onAnswerText} onAnswer={answer} vaultPrompts={vaultPrompts} onVaultAnswer={answerVault}
      onDeleteFailed={deleteFailed} onRetryFailed={retryFailed}
      onCancel={ignore} onStop={ignore} busy={busy} messageActions={startingActions} />
  </View>;
  if (!selected || selected.archived || !client.channels.has(selected.project_id))
    return <Notice text={status === 'online' && client.isCatalogueReady ? 'This conversation is unavailable.' : 'Opening conversation…'} />;
  // Source navigation must mount the list only after the target rows exist, so its
  // native initial index points at the exact message rather than the latest.
  if (anchor !== undefined && !located) return <View style={styles.flex}>
    <Stack.Screen options={{ title: selected.title || 'Conversation', ...headerTitle(selected.title || 'Conversation', selected.project_id) }} />
    {!!(error || connectionError) && <Text style={styles.error}>{error || connectionError}</Text>}
    {historyBusy || awaitingOpen ? <ConversationLoading active={focused && foreground} /> : <Pressable accessibilityRole="button" accessibilityLabel="Try again" onPress={() => { setError(''); void openThread(threadId, anchor); }}><Text>Try again</Text></Pressable>}
  </View>;
  const headerButtons = { onPress: () => router.push({ pathname: '/threads/[threadId]/options', params: { threadId, connection: slot } }),
    todo: accountClient?.supportsSessionLabels ? { on: todo, busy: todoBusy || status !== 'online', onPress: toggleTodo } : undefined };
  return <View style={styles.flex}>
    <Stack.Screen options={{ title: selected.title || 'Conversation', ...headerTitle(selected.title || 'Conversation', selected.project_id),
      ...(Platform.OS === 'ios' ? { headerRight: undefined, unstable_headerRightItems: () => sessionHeaderItems(headerButtons) }
        : { headerRight: () => <SessionOptionsButton {...headerButtons} /> }) }} />
    {!!(error || connectionError) && <Text style={styles.error}>{error || connectionError}</Text>}
    {accountClient?.supportsSessionLabels && withoutTodo(selected.markers).length > 0 && <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}><LabelPills markers={withoutTodo(selected.markers)} /></View>}
    <ChatTimeline key="timeline" ref={timelineRef} active={focusedRef.current} threadId={threadId} rows={rows}
      targetRef={located ? anchor : undefined} onLatest={anchor === undefined ? undefined : showLatest}
      locatingMessage={!located && !historyBusy && openFailed ? client.supportsLatest ? 'Could not load this conversation. Try opening it again.' : 'Could not open this yet. It will resume when the connection returns.' : undefined}
      onLocateNext={!located ? () => { setError(''); void openThread(threadId, anchor); } : undefined} locatingBusy={historyBusy || awaitingOpen}
      position={entryPosition}
      onVisibleRefs={onVisibleRefs}
      text={text} onText={setText} onSend={send}
      attachmentCount={draftAttachments.length} attachmentsBusy={attachmentsBusy} renderAttachments={renderAttachments}
      typingIndicator={<TypingIndicator active={focused && isAgentTyping(threadId, receipts, interactions, status === 'online')} name={agentName.name} />}
      composerAccessory={(parts, onHeight) => <AttachmentComposer key={composerScope} send={parts.send} expanded={parts.expanded} onPressField={parts.onPressField} client={client} threadId={threadId} initialDraft={composerDrafts.current.get(draftKey)} onDraftChange={draft => { if (config && forgottenConnections.current.has(config.id)) { releaseComposerDraft(draft); return; } if (draft.items.length) composerDrafts.current.set(draftKey, draft); else composerDrafts.current.delete(draftKey); }} onChange={onAttachmentsChange} onPasteText={value => { if (focusedRef.current && currentComposer.current === composerScope) timelineRef.current?.pasteText(value); }} clearKey={attachmentClearKey} disabled={busy} onComposerHeight={onHeight}>{parts.input}</AttachmentComposer>}
      receipts={receipts} interactions={interactions} answers={answers}
      onAnswerText={onAnswerText} onAnswer={answer} vaultPrompts={vaultPrompts} onVaultAnswer={answerVault}
      onDeleteFailed={deleteFailed} onRetryFailed={retryFailed}
      onCancel={cancelQueued}
      onStop={() => run(async () => { const stopped = await client.stop(threadId); if (!stopped) throw new Error('Nothing is running to stop'); })} busy={busy}
      messageActions={messageActions} />
  </View>;
});

const ignore = () => {};
/** A function with one identity for the page's life that always runs the latest `fn`. */
function useLatestCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn);
  latest.current = fn;
  return useCallback((...args: A) => latest.current(...args), []);
}

export function Notice({ text }: { text: string }) {
  return <View style={styles.center}><Text style={styles.hint}>{text}</Text></View>;
}

/** Session list of one Project; the page is scoped to the Project's connection. */
export function ChannelsScreen({ channelId }: { channelId: string }) {
  const navigation = useSessionNavigation();
  const { ready, slot, config, client, error, outboxRef, textDrafts, composerDrafts } = useApp();
  const draftThreads = useDraftThreads(config?.id);
  const router = useRouter();
  if (!ready || !config || !client) return <Notice text="Opening…" />;
  if (!client.channels.has(channelId))
    return <Notice text={client.connectionState === 'online' && client.isCatalogueReady ? 'This channel is unavailable.' : 'Opening channel…'} />;
  return <View style={styles.flex}>
    {!!error && <Text style={styles.error}>{error}</Text>}
    <FormKeyboardAvoidingView>
      <ChannelScreens key={config.id} client={client} channelId={channelId} draftThreads={draftThreads}
        onThread={id => navigation.thread(id)}
        onContext={id => router.push(channelRoute(slot, id, '/context'))}
        onAgents={id => router.push(channelRoute(slot, id, '/agents'))}
        onLabels={id => router.push(labelsRoute(slot, id))}
        onArchive={async () => { await client.archiveChannel(channelId); if (router.canGoBack()) router.back(); else router.replace('/'); }}
        enqueueFirstMessage={async (threadId, messageId, text, attachments, create) => {
          const box = outboxRef.current;
          if (!box || box.storage.connectionId !== config.id) throw new Error('Connection changed');
          await box.enqueue(newSend(config, threadId, text, messageId, attachments, create));
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
  headerIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' }, headerIconPressed: { backgroundColor: '#e6edf7' }, headerIconBusy: { opacity: 0.5 },
  secondary: { backgroundColor: '#e6edf7' }, disabled: { opacity: 0.5 }, buttonText: { color: '#fff', fontWeight: '600', fontSize: 13 }, secondaryText: { color: '#2b4e81' },
  headerTitle: { alignItems: 'center', maxWidth: 240 }, headerTitleText: { fontSize: 17, fontWeight: '600', color: '#172a40' }, headerSubtitle: { fontSize: 12, color: '#607187' },
});
