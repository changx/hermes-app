import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import * as Crypto from 'expo-crypto';
import type { Attachment, HermesClient } from '../../../packages/client/src/index';
import { Text, TextInput } from './FontSize';
import { AttachmentComposer, type AttachmentComposerHandle } from './Attachments';

/** Route-owned draft: retained by the native Stack while an existing topic is open.
 * Mount with a connection/channel key; never share files or IDs across channels.
 * First-message dispatch belongs to the existing durable outbox, not this view.
 */
export function NewTopicComposer({ client, channelId, enqueue, onCreated, disabled = false }: {
  client: HermesClient; channelId: string;
  enqueue: (threadId: string, messageId: string, text: string, attachments: Attachment[]) => Promise<void>;
  onCreated: (threadId: string) => void; disabled?: boolean;
}) {
  const [text, setText] = useState(''), [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false), [attachmentBusy, setAttachmentBusy] = useState(false);
  const [error, setError] = useState(''), [clearKey, setClearKey] = useState(0);
  const [sealed, setSealed] = useState(false);
  const input = useRef<React.ElementRef<typeof TextInput>>(null);
  const attachments = useRef<AttachmentComposerHandle>(null);
  const selection = useRef<{ start: number; end: number } | null>(null);
  type Attempt = { threadId: string; messageId: string; created: boolean; payload?: { text: string; attachments: Attachment[] } };
  const attempt = useRef<Attempt | null>(null);
  const working = useRef(false), mounted = useRef(true);
  const focused = useIsFocused(), focusedRef = useRef(focused);
  focusedRef.current = focused;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
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
    const draft: Attempt = attempt.current ?? { threadId: 'th_' + Crypto.randomUUID().replace(/-/g, ''), messageId: 'mob_' + Crypto.randomUUID(), created: false };
    attempt.current = draft;
    const original = text;
    try {
      if (!draft.created) {
        const made = await client.createThread(channelId, 'New topic', draft.threadId);
        draft.threadId = made.id; draft.created = true;
      }
      if (!mounted.current) return;
      if (!draft.payload) {
        // Hydrate the summary before enqueue: opening needs its channel. Once
        // sealed, queue retries do not depend on another network read.
        await client.getThread(draft.threadId);
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
      attempt.current = null;
      if (mounted.current) {
        setText(''); setCount(0); setSealed(false); selection.current = null; setClearKey(key => key + 1);
        if (focusedRef.current) onCreated(draft.threadId);
      }
    } catch {
      if (mounted.current) setError('Could not start this conversation. Your message is still here. Try sending again.');
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return <View collapsable={false} style={s.surface} testID="new-topic-composer">
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    <AttachmentComposer client={client} threadId={null} handleRef={attachments} clearKey={clearKey}
      disabled={busy || disabled || sealed} onSelectionChange={setCount} onChange={(_, pending) => setAttachmentBusy(pending)} onPasteText={paste}>
      <Pressable accessible={false} focusable={false} style={s.field} onPress={() => input.current?.focus()}>
        <TextInput ref={input} accessibilityLabel="First message" placeholder="Start a new conversation…" placeholderTextColor="#65758b"
          multiline maxLength={16000} editable={!busy && !disabled && !sealed} value={text} onChangeText={value => { if (!working.current && !attempt.current?.payload) setText(value); }}
          numberOfLines={Platform.OS === 'ios' && !text.length ? 1 : undefined}
          onSelectionChange={event => { selection.current = event.nativeEvent.selection; }}
          underlineColorAndroid="transparent" style={s.input} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Send" accessibilityHint="Starts a new conversation"
        accessibilityState={{ busy }} disabled={busy || disabled || attachmentBusy || (!text.trim() && !count)} onPress={() => void submit()}
        style={[s.send, (busy || disabled || attachmentBusy || (!text.trim() && !count)) && s.disabled]}>
        <Text style={s.arrow}>↑</Text>
      </Pressable>
    </AttachmentComposer>
  </View>;
}
const s = StyleSheet.create({
  surface: { flexShrink: 0, backgroundColor: 'rgba(248, 250, 253, 0.98)', borderTopWidth: 1, borderColor: '#e2e8f0', boxShadow: '0 -4px 10px -4px rgba(23, 42, 64, 0.16)' },
  field: { flex: 1, minWidth: 0, minHeight: 42, maxHeight: 120, justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  input: { maxHeight: 102, padding: 0, color: '#172a40' },
  send: { width: 42, height: 42, borderRadius: 12, backgroundColor: '#2960ad', alignItems: 'center', justifyContent: 'center' },
  arrow: { color: '#fff', fontSize: 24, fontWeight: '600' }, disabled: { opacity: 0.5 },
  error: { color: '#9d1b32', paddingHorizontal: 12, paddingTop: 8 },
});
