import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useIsFocused } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { Text, TextInput } from './FontSize';
import { AttachmentComposer, type AttachmentComposerHandle } from './Attachments';
import type { HermesClient } from '../../../packages/client/src/index';
import { channelPatch } from './channel-edits';

const newId = (prefix: string) => prefix + Crypto.randomUUID().replace(/-/g, '');

function Action({ label, onPress, disabled = false, secondary = false }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={[s.action, secondary && s.secondary, disabled && s.disabled]}>
    <Text style={[s.actionText, secondary && s.secondaryText]}>{label}</Text>
  </Pressable>;
}

function useRouteWork() {
  const focused = useIsFocused();
  const focusedRef = useRef(focused), working = useRef(false), generation = useRef(0);
  focusedRef.current = focused;
  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    return () => { focusedRef.current = false; generation.current++; };
  }, []));
  const run = async (setBusy: (value: boolean) => void, setError: (value: string) => void,
    work: (isCurrent: () => boolean) => Promise<void>) => {
    if (working.current || !focusedRef.current) return;
    const version = generation.current;
    working.current = true; setBusy(true); setError('');
    const isCurrent = () => focusedRef.current && generation.current === version;
    try { await work(isCurrent); }
    catch { if (isCurrent()) setError('Could not complete that action. Try again later.'); }
    finally { working.current = false; if (isCurrent()) setBusy(false); }
  };
  return run;
}

export function NewChannelEditor({ client, onCreated }: {
  client: HermesClient;
  onCreated: (channelId: string) => void;
}) {
  const [name, setName] = useState(''), [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const run = useRouteWork();

  const submit = () => void run(setBusy, setError, async current => {
    const patch = channelPatch(name, description);
    const made = await client.createChannel(patch.name, patch.description);
    if (current()) onCreated(made.id);
  });
  return <View style={s.page}>
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    <View style={s.form}>
      <TextInput accessibilityLabel="Channel name" placeholder="Channel name" placeholderTextColor="#65758b"
        value={name} onChangeText={setName} style={[s.input, s.channelName]} editable={!busy} maxLength={200} />
      <View style={s.descriptionArea} collapsable={false}>
        <TextInput accessibilityLabel="Channel description" placeholder="Context, goals, or guidelines (optional)"
          placeholderTextColor="#65758b" value={description} onChangeText={setDescription} multiline
          style={[s.input, s.description]} editable={!busy} />
      </View>
      <View style={s.channelActions} collapsable={false}>
        <Text style={s.hint}>New topics will use this description. Existing conversations will not change.</Text>
        <View style={s.row}><View style={s.fill} /><Action label={busy ? 'Creating…' : 'Create channel'}
          disabled={busy || !name.trim()} onPress={submit} /></View>
      </View>
    </View>
  </View>;
}

export function NewTopicEditor({ client, channelId, onCreated }: {
  client: HermesClient;
  channelId: string;
  onCreated: (threadId: string) => void;
}) {
  const [message, setMessage] = useState(''), [attachmentCount, setAttachmentCount] = useState(0);
  const [attachmentBusy, setAttachmentBusy] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const attachmentComposer = useRef<AttachmentComposerHandle>(null);
  const draftThread = useRef<string | null>(null), draftAttachments = useRef<string[] | null>(null);
  const uploadedDraftAttachments = useRef<string[]>([]);
  const draftMessageId = useRef(newId('mob_')), draftThreadId = useRef(newId('th_'));
  const finalized = useRef(false);
  const run = useRouteWork();
  useEffect(() => () => {
    const threadId = draftThread.current;
    if (!threadId || finalized.current) return;
    const handle = attachmentComposer.current;
    const attachmentIds = draftAttachments.current ?? uploadedDraftAttachments.current;
    void (async () => {
      if (handle) await handle.discardFrom(threadId);
      else await Promise.all(attachmentIds.map(id => client.deleteUnattached(threadId, id)));
      await client.archiveThread(threadId);
    })().catch(() => { /* leaving the route must not resurrect or block the editor */ });
  }, [client]);
  const submit = () => void run(setBusy, setError, async current => {
    if ((!message.trim() && !attachmentCount) || attachmentBusy) return;
    let threadId = draftThread.current;
    if (!threadId) {
      const made = await client.createThread(channelId, 'New topic', draftThreadId.current);
      threadId = made.id; draftThread.current = threadId;
      await client.getThread(threadId);
    }
    let attachmentIds = draftAttachments.current;
    if (!attachmentIds) {
      const uploaded = await attachmentComposer.current!.uploadTo(threadId);
      attachmentIds = uploaded.map(item => item.id); draftAttachments.current = attachmentIds;
    }
    await client.send(threadId, draftMessageId.current, message, attachmentIds);
    await client.getThread(threadId);
    if (current()) { finalized.current = true; onCreated(threadId); }
  });
  return <View style={s.page}>
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    <View style={s.messageArea} collapsable={false}>
      <TextInput accessibilityLabel="First message" placeholder="What would you like to discuss?" value={message}
        onChangeText={setMessage} editable={!busy} multiline maxLength={16000} style={[s.input, s.message]} />
    </View>
    <View style={s.topicActions} collapsable={false}>
      <AttachmentComposer handleRef={attachmentComposer} client={client} threadId={null} clearKey={0} disabled={busy}
        onSelectionChange={setAttachmentCount} onChange={(attachments, pending) => {
          uploadedDraftAttachments.current = attachments.map(item => item.id);
          setAttachmentBusy(pending);
        }}
        onPasteText={text => setMessage(value => value + text)}>
        <View style={s.fill} />
        <Action label={busy ? 'Creating…' : 'Create topic'}
          disabled={busy || attachmentBusy || (!message.trim() && !attachmentCount)} onPress={submit} />
      </AttachmentComposer>
    </View>
  </View>;
}

const s = StyleSheet.create({
  page: { flex: 1, padding: 12, backgroundColor: '#f8fafc' },
  fill: { flex: 1 },
  form: { flex: 1, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 9, minHeight: 44, paddingHorizontal: 12, paddingVertical: 9, color: '#172a40' },
  channelName: { flexShrink: 0 },
  descriptionArea: { flex: 1, minHeight: 0 },
  description: { flex: 1, minHeight: 0, textAlignVertical: 'top' },
  channelActions: { flexShrink: 0, gap: 12 },
  // Keep native text measurement inside a bounded flex slot. A 180pt minimum
  // overflows the remaining slot while iOS changes the keyboard/window layout.
  messageArea: { flex: 1, minHeight: 0, marginBottom: 12 },
  message: { flex: 1, minHeight: 0, textAlignVertical: 'top' },
  topicActions: { flexShrink: 0 },
  hint: { color: '#65758b', fontSize: 13, lineHeight: 19 },
  error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10, marginBottom: 12, borderRadius: 8 },
  action: { backgroundColor: '#2960ad', paddingHorizontal: 12, paddingVertical: 11, borderRadius: 9, minHeight: 44, justifyContent: 'center' },
  actionText: { color: '#fff', fontWeight: '600' },
  secondary: { backgroundColor: '#e7eef8' },
  secondaryText: { color: '#2b4e81' },
  disabled: { opacity: 0.5 },
});
