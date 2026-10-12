import React, { useEffect, useRef, useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { connectionFailure, threadModelLabel, threadModelRequest, type AgentModelSettings, type Attachment, type HermesClient, type ModelConfirmationRequired, type ThreadModelChoice } from '../../../packages/client/src/index';

// By name and status: the error may come from another bundle copy of the shared client.
const needsConfirmation = (error: unknown): error is ModelConfirmationRequired => error instanceof Error && error.name === 'ModelConfirmationRequired';
const rejected = (error: unknown) => error instanceof Error && (error as { status?: unknown }).status === 400;
import { retryStep } from './retryStep.ts';
import { Text, TextInput } from './FontSize';
import { AttachmentComposer, type AttachmentComposerHandle } from './Attachments';
import { ComposerSendButton } from './ComposerCard';
import { ThreadModelButton, ThreadModelPicker } from './ThreadModelPicker';

/** Route-owned draft: retained by the native Stack while an existing topic is open.
 * Never share files or IDs across channels. Mount with a connection/channel
 * key, or change `client`/`channelId` only while `onTargetLock` reports false:
 * before the first send attempt the text and files are local only. From the
 * first attempt until the durable commit, the Thread and message IDs belong to
 * the current target, so the owner must keep it.
 * First-message dispatch belongs to the existing durable outbox, not this view.
 * The model control lists the models of `client` (the Channel's own connection); a remount
 * per connection/Channel resets it to the primary model. `showModel` keeps the control visible;
 * otherwise it appears while typing or when a model other than the default is chosen.
 */
export function NewTopicComposer({ client, channelId, enqueue, onCreated, disabled = false, onTargetLock, placeholder = 'Start a new conversation…', autoFocus = false, showModel = false }: {
  client: HermesClient; channelId: string;
  enqueue: (threadId: string, messageId: string, text: string, attachments: Attachment[]) => Promise<void>;
  onCreated: (threadId: string) => void; disabled?: boolean;
  onTargetLock?: (locked: boolean) => void; placeholder?: string; autoFocus?: boolean; showModel?: boolean;
}) {
  const [text, setText] = useState(''), [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false), [attachmentBusy, setAttachmentBusy] = useState(false);
  const [error, setError] = useState(''), [clearKey, setClearKey] = useState(0);
  const [sealed, setSealed] = useState(false), [inputFocused, setFocused] = useState(false);
  const input = useRef<React.ElementRef<typeof TextInput>>(null);
  const attachments = useRef<AttachmentComposerHandle>(null);
  const selection = useRef<{ start: number; end: number } | null>(null);
  // The model is fixed with the Thread ID at the first attempt; retries send the same request.
  type Attempt = { threadId: string; messageId: string; created: boolean; model?: ThreadModelChoice; confirmModel?: boolean; payload?: { text: string; attachments: Attachment[] } };
  const [models, setModels] = useState<AgentModelSettings | null>(null), [modelsFailed, setModelsFailed] = useState(false);
  const [modelChoice, setModelChoice] = useState<ThreadModelChoice | null>(null), [picking, setPicking] = useState(false);
  const [modelsWanted, setModelsWanted] = useState(0), [locked, setLocked] = useState(false);
  const attempt = useRef<Attempt | null>(null);
  const lockCallback = useRef(onTargetLock); lockCallback.current = onTargetLock;
  const setAttempt = (value: Attempt | null) => { attempt.current = value; setLocked(value !== null); lockCallback.current?.(value !== null); };
  const working = useRef(false), mounted = useRef(true);
  const focused = useIsFocused(), focusedRef = useRef(focused);
  focusedRef.current = focused;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // Focus when the owner allows it, not at mount: the owner waits for the
  // push animation to end so the keyboard does not compete with it.
  useEffect(() => { if (autoFocus && focusedRef.current) input.current?.focus(); }, [autoFocus]);
  const supportsModel = client.supportsThreadModel === true;
  // Another Channel (possibly on another connection) has its own list: reload and use Default.
  const target = useRef({ client, channelId });
  useEffect(() => {
    if (target.current.client === client && target.current.channelId === channelId) return;
    target.current = { client, channelId };
    setModels(null); setModelsFailed(false); setModelChoice(null); setPicking(false);
  }, [client, channelId]);
  const modelVisible = supportsModel && (showModel || inputFocused || modelChoice !== null || picking);
  // Load the list once the control is shown, from this composer's own connection only.
  useEffect(() => {
    if (!modelVisible || models || (modelsFailed && !modelsWanted)) return;
    const controller = new AbortController();
    setModelsFailed(false);
    client.getModelSettings(controller.signal).then(value => { if (mounted.current && !controller.signal.aborted) setModels(value); })
      .catch(() => { if (mounted.current && !controller.signal.aborted) setModelsFailed(true); })
      .finally(() => { if (mounted.current && !controller.signal.aborted) setModelsWanted(0); });
    return () => controller.abort();
  }, [client, modelVisible, models, modelsWanted]);
  const confirmModel = (draft: Attempt, warning: string) => {
    // Nothing was created. Cancel unlocks the draft so another model can be chosen.
    Alert.alert('Use this model?', warning, [
      { text: 'Cancel', style: 'cancel', onPress: () => { if (attempt.current === draft && !draft.created) setAttempt(null); } },
      { text: 'Use model', onPress: () => { if (attempt.current === draft) { draft.confirmModel = true; void submit(); } } },
    ]);
  };
  const paste = (value: string) => {
    if (working.current || disabled || attempt.current?.payload) return;
    setText(old => {
      const start = Math.min(selection.current?.start ?? old.length, old.length);
      const end = Math.max(start, Math.min(selection.current?.end ?? start, old.length));
      const next = (old.slice(0, start) + value + old.slice(end)).slice(0, 16000);
      selection.current = { start: Math.min(start + value.length, next.length), end: Math.min(start + value.length, next.length) };
      return next;
    });
  };
  const submit = async () => {
    if (working.current || disabled || !focusedRef.current || attachmentBusy || (!text.trim() && !count)) return;
    working.current = true; setBusy(true); setError('');
    // Creation can be acknowledged ambiguously; every retry uses the same ID.
    const draft: Attempt = attempt.current ?? { threadId: 'th_' + Crypto.randomUUID().replace(/-/g, ''), messageId: 'mob_' + Crypto.randomUUID(), created: false,
      model: supportsModel ? threadModelRequest(models, modelChoice) : undefined };
    setAttempt(draft);
    const original = text;
    const alive = () => mounted.current;
    try {
      if (!draft.created) {
        // Same client thread ID and title on every attempt: the server returns
        // the existing thread, so a temporary failure retries without a duplicate.
        const made = await retryStep(() => client.createThread(channelId, 'New topic', draft.threadId, draft.model, draft.confirmModel), alive);
        draft.threadId = made.id; draft.created = true;
      }
      if (!mounted.current) return;
      if (!draft.payload) {
        // Hydrate the summary before enqueue: opening needs its channel. Once
        // sealed, queue retries do not depend on another network read.
        await retryStep(() => client.getThread(draft.threadId), alive);
        if (!mounted.current) return;
        const uploaded = await attachments.current!.uploadTo(draft.threadId);
        if (!mounted.current) return;
        // Even an uncertain local storage commit must never reuse this message
        // identity with edited text/files. Retry the exact sealed payload.
        draft.payload = { text: original, attachments: uploaded };
        setSealed(true);
      }
      await enqueue(draft.threadId, draft.messageId, draft.payload.text, draft.payload.attachments);
      // No network read after the durable commit; a dropped connection must not
      // leave this draft looking unsent or cause another first-message send.
      setAttempt(null);
      if (mounted.current) {
        setText(''); setCount(0); setSealed(false); selection.current = null; setClearKey(key => key + 1);
        if (focusedRef.current) onCreated(draft.threadId);
      }
    } catch (failure) {
      if (needsConfirmation(failure) && !draft.created) {
        if (mounted.current) confirmModel(draft, failure.warning);
        return;
      }
      console.info('[new-topic]', connectionFailure(failure));
      if (draft.model && !draft.created && rejected(failure)) {
        // The server rejected the model and created nothing: let the user choose another.
        setAttempt(null);
        if (mounted.current) setError('This model is not available. Choose another model and send again.');
        return;
      }
      if (mounted.current) setError('Could not start this conversation. Your message is still here. Try sending again.');
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return <View collapsable={false} style={s.surface} testID="new-topic-composer">
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {modelVisible && <ThreadModelButton label={threadModelLabel(models, modelChoice)} disabled={busy || disabled || locked}
      onPress={() => { if (!attempt.current) setPicking(true); }} />}
    {supportsModel && <ThreadModelPicker visible={picking} settings={models} failed={modelsFailed} selected={modelChoice}
      onClose={() => setPicking(false)} onRetry={() => setModelsWanted(n => n + 1)}
      onPick={choice => { if (!attempt.current) setModelChoice(choice); setPicking(false); }} />}
    <AttachmentComposer client={client} threadId={null} handleRef={attachments} clearKey={clearKey}
      disabled={busy || disabled || sealed} onSelectionChange={setCount} onChange={(_, pending) => setAttachmentBusy(pending)} onPasteText={paste}
      expanded={inputFocused} onPressField={() => input.current?.focus()}
      send={<ComposerSendButton hint="Starts a new conversation" busy={busy} disabled={busy || disabled || attachmentBusy || (!text.trim() && !count)} onPress={() => void submit()} />}>
      <TextInput ref={input} accessibilityLabel="First message" placeholder={placeholder} placeholderTextColor="#8e8e93"
        multiline maxLength={16000} editable={!busy && !disabled && !sealed} value={text} onChangeText={value => { if (!working.current && !attempt.current?.payload) setText(value); }}
        numberOfLines={Platform.OS === 'ios' && !text.length ? 1 : undefined}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onSelectionChange={event => { selection.current = event.nativeEvent.selection; }}
        underlineColorAndroid="transparent" style={s.input} />
    </AttachmentComposer>
  </View>;
}
const s = StyleSheet.create({
  surface: { flexShrink: 0, backgroundColor: 'rgba(248, 250, 253, 0.98)', borderTopWidth: 1, borderColor: '#e2e8f0', boxShadow: '0 -4px 10px -4px rgba(23, 42, 64, 0.16)' },
  input: { maxHeight: 102, padding: 0, color: '#1f2329' },
  error: { color: '#9d1b32', paddingHorizontal: 12, paddingTop: 8 },
});
