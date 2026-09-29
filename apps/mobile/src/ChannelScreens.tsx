import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useIsFocused } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, TextInput } from './FontSize';
import type { HermesClient, ThreadSummary } from '../../../packages/client/src/index';
import { channelPatch, threadPatch } from './channel-edits';
import { AttachmentComposer, type AttachmentComposerHandle } from './Attachments';
import { MessageTime } from './MessageTime';

type Props = { client: HermesClient; channelId: string | null; onChannel: (id: string | null) => void; onThread: (id: string) => void };
function Action({ label, onPress, disabled = false, secondary = false }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={[s.action, secondary && s.secondary, disabled && s.disabled]}><Text style={[s.actionText, secondary && s.secondaryText]}>{label}</Text></Pressable>;
}

const newId = (prefix: string) => prefix + Crypto.randomUUID().replace(/-/g, '');

export function ChannelScreens({ client, channelId, onChannel, onThread }: Props) {
  const [creating, setCreating] = useState(false), [editing, setEditing] = useState(false), [composing, setComposing] = useState(false);
  const [name, setName] = useState(''), [description, setDescription] = useState('');
  const [message, setMessage] = useState(''), [attachmentCount, setAttachmentCount] = useState(0), [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentClearKey, setAttachmentClearKey] = useState(0), [renaming, setRenaming] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const working = useRef(false), generation = useRef(0), attachmentComposer = useRef<AttachmentComposerHandle>(null);
  const draftThread = useRef<string | null>(null), draftAttachments = useRef<string[] | null>(null), draftMessageId = useRef(''), draftThreadId = useRef('');
  const focused = useIsFocused(), focusedRef = useRef(focused), insets = useSafeAreaInsets();
  // Open a channel at its newest topic; stop sticking once the user scrolls.
  const topicList = useRef<FlatList<ThreadSummary>>(null), stickToEnd = useRef(true);
  focusedRef.current = focused;
  useFocusEffect(React.useCallback(() => {
    focusedRef.current = true;
    return () => { focusedRef.current = false; generation.current++; };
  }, []));
  const resetComposer = () => {
    setComposing(false); setMessage(''); setAttachmentCount(0); setAttachmentBusy(false); setAttachmentClearKey(value => value + 1);
    draftThread.current = null; draftAttachments.current = null; draftMessageId.current = ''; draftThreadId.current = '';
  };
  useEffect(() => {
    generation.current++;
    stickToEnd.current = true;
    setCreating(false); setEditing(false); setRenaming(null); setName(''); setDescription(''); setError(''); resetComposer();
    return () => { generation.current++; };
  }, [channelId, client]);
  const run = async (work: (isCurrent: () => boolean) => Promise<void>) => {
    if (working.current || !focusedRef.current) return;
    const version = generation.current; working.current = true; setBusy(true); setError('');
    const isCurrent = () => focusedRef.current && generation.current === version;
    try { await work(isCurrent); }
    catch { if (isCurrent()) setError('Could not complete that action. Try again later.'); }
    finally { working.current = false; setBusy(false); }
  };
  const channel = client.channels.get(channelId || '');
  const channels = [...client.channels.values()].sort((a, b) => a.name.localeCompare(b.name));
  // Oldest activity first so the newest topic sits at the bottom, like a chat.
  const threads = [...client.threads.values()].filter(t => t.project_id === channelId && !t.archived)
    .sort((a, b) => (a.last_message_at ?? 0) - (b.last_message_at ?? 0) || a.last_ref - b.last_ref || a.title.localeCompare(b.title));
  const startEdit = () => { if (!channel) return; setName(channel.name); setDescription(channel.description || ''); setEditing(true); setCreating(false); setError(''); };
  const startCreate = () => { setName(''); setDescription(''); setEditing(false); setError(''); setCreating(true); };
  const cancelChannelForm = () => { setCreating(false); setEditing(false); setError(''); };
  const submitChannel = () => void run(async current => {
    const patch = channelPatch(name, description);
    if (editing && channelId) { await client.updateChannel(channelId, patch); if (current()) setEditing(false); }
    else { const made = await client.createChannel(patch.name, patch.description); if (current()) { setCreating(false); onChannel(made.id); } }
  });
  const rename = (thread: ThreadSummary) => { setRenaming(thread.id); setNewTitle(thread.title); setError(''); };
  const openComposer = () => {
    draftThreadId.current = newId('th_'); draftMessageId.current = newId('mob_');
    draftThread.current = null; draftAttachments.current = null; setMessage(''); setAttachmentCount(0); setError(''); setComposing(true);
  };
  const cancelComposer = () => {
    if (!draftThread.current) { resetComposer(); return; }
    void run(async current => {
      await attachmentComposer.current?.discardFrom(draftThread.current!);
      await client.archiveThread(draftThread.current!);
      if (current()) resetComposer();
    });
  };
  const submitTopic = () => void run(async current => {
    if (!channelId || (!message.trim() && !attachmentCount) || attachmentBusy) return;
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
    if (current()) { resetComposer(); onThread(threadId); }
  });
  const channelForm = editing && <View style={s.form}>
    <Text style={s.heading}>Edit channel</Text>
    <TextInput accessibilityLabel="Channel name" placeholder="Channel name" placeholderTextColor="#65758b" value={name} onChangeText={setName} style={s.input} editable={!busy} maxLength={200} />
    <TextInput accessibilityLabel="Channel description" placeholder="Context, goals, or guidelines (optional)" placeholderTextColor="#65758b" value={description} onChangeText={setDescription} multiline style={[s.input, s.description]} editable={!busy} />
    <Text style={s.hint}>New topics will use this description. Existing conversations will not change.</Text>
    <View style={s.row}>
      <Action label={busy ? 'Saving…' : 'Save'} disabled={busy || !name.trim()} onPress={submitChannel} />
      <Action label="Cancel" secondary disabled={busy} onPress={cancelChannelForm} />
    </View>
  </View>;
  return <View style={s.fill}>
    <View style={s.top}>
      <Text style={[s.heading, s.fill]} numberOfLines={2}>{channelId ? channel?.name || 'Channel' : 'Channels'}</Text>
      {!!channelId && <Action label="Edit" secondary disabled={busy} onPress={startEdit} />}
    </View>
    {busy && !composing && !creating && <View style={s.progress}><ActivityIndicator size="small" /><Text style={s.hint}>Saving…</Text></View>}
    {!!error && !composing && !creating && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {channelId ? <FlatList ref={topicList} keyboardShouldPersistTaps="handled" data={threads} keyExtractor={t => t.id} contentContainerStyle={[s.list, { paddingBottom: 96 + insets.bottom }]}
      onScrollBeginDrag={() => { stickToEnd.current = false; }}
      onContentSizeChange={(_, height) => { if (stickToEnd.current && height > 0) topicList.current?.scrollToEnd({ animated: false }); }}
      ListHeaderComponent={<>{channelForm}{!!channel?.description && !editing && <Text selectable style={s.summary}>{channel.description}</Text>}</>}
      renderItem={({ item }) => <View style={s.card}>
        {renaming === item.id ? <><TextInput accessibilityLabel="New topic name" style={s.input} value={newTitle} onChangeText={setNewTitle} editable={!busy} maxLength={200} /><View style={s.row}><Action label="Save" disabled={busy || !newTitle.trim()} onPress={() => void run(async current => { await client.updateThread(item.id, threadPatch(newTitle)); if (current()) setRenaming(null); })} /><Action label="Cancel" secondary disabled={busy} onPress={() => setRenaming(null)} /></View></> : <View style={s.row}><Pressable accessibilityRole="button" onPress={() => onThread(item.id)} style={s.fill}><Text style={s.heading}>{item.title}</Text><View style={s.meta}><MessageTime seconds={item.last_message_at} />{!!item.unread_count && <Text style={s.unread}>{item.unread_count} unread</Text>}</View></Pressable><Action label="Rename" secondary disabled={busy} onPress={() => rename(item)} /></View>}
      </View>}
      ListEmptyComponent={<Text style={s.empty}>No topics yet. Tap + to start a conversation.</Text>} /> : <FlatList keyboardShouldPersistTaps="handled" data={channels} keyExtractor={c => c.id} contentContainerStyle={[s.list, { paddingBottom: 96 + insets.bottom }]}
      renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={() => onChannel(item.id)} style={s.card}><Text style={s.heading}>{item.name}</Text><Text numberOfLines={2} style={s.hint}>{item.description || 'A space for a project or ongoing conversations'}</Text></Pressable>}
      ListEmptyComponent={<Text style={s.empty}>Create a channel to keep related topics together.</Text>} />}
    {!!channelId && <Pressable accessibilityRole="button" accessibilityLabel="New topic" disabled={busy} onPress={openComposer} style={[s.fab, { bottom: 18 + insets.bottom }, busy && s.disabled]}><Text style={s.fabText}>＋</Text></Pressable>}
    {!channelId && <Pressable accessibilityRole="button" accessibilityLabel="New channel" disabled={busy} onPress={startCreate} style={[s.fab, { bottom: 18 + insets.bottom }, busy && s.disabled]}><Text style={s.fabText}>＋</Text></Pressable>}
    <Modal visible={creating} transparent animationType="slide" onRequestClose={cancelChannelForm}>
      <KeyboardAvoidingView style={s.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close new channel editor" style={s.backdrop} disabled={busy} onPress={cancelChannelForm} />
        <View style={[s.composer, { paddingBottom: Math.max(14, insets.bottom) }]}>
          <View style={s.top}><Text style={[s.heading, s.fill]}>New channel</Text><Action label="Cancel" secondary disabled={busy} onPress={cancelChannelForm} /></View>
          {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
          <View style={s.sheetForm}>
            <TextInput accessibilityLabel="Channel name" placeholder="Channel name" placeholderTextColor="#65758b" value={name} onChangeText={setName} style={s.input} editable={!busy} maxLength={200} autoFocus />
            <TextInput accessibilityLabel="Channel description" placeholder="Context, goals, or guidelines (optional)" placeholderTextColor="#65758b" value={description} onChangeText={setDescription} multiline style={[s.input, s.description]} editable={!busy} />
            <Text style={s.hint}>New topics will use this description. Existing conversations will not change.</Text>
            <View style={s.row}><View style={s.fill} /><Action label={busy ? 'Creating…' : 'Create channel'} disabled={busy || !name.trim()} onPress={submitChannel} /></View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
    <Modal visible={composing} transparent animationType="fade" onRequestClose={cancelComposer}>
      <KeyboardAvoidingView style={s.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close new topic composer" style={s.backdrop} disabled={busy} onPress={cancelComposer} />
        <View style={[s.composer, { paddingBottom: Math.max(14, insets.bottom) }]}>
          <View style={s.top}><Text style={[s.heading, s.fill]}>New topic</Text><Action label="Cancel" secondary disabled={busy} onPress={cancelComposer} /></View>
          {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
          <TextInput accessibilityLabel="First message" placeholder="What would you like to discuss?" value={message} onChangeText={setMessage} editable={!busy} multiline autoFocus maxLength={16000} style={[s.input, s.message]} />
          <AttachmentComposer handleRef={attachmentComposer} client={client} threadId={null} clearKey={attachmentClearKey} disabled={busy}
            onSelectionChange={setAttachmentCount} onChange={(_, pending) => setAttachmentBusy(pending)} onPasteText={text => setMessage(value => value + text)}>
            <View style={s.fill} />
            <Action label={busy ? 'Creating…' : 'Create topic'} disabled={busy || attachmentBusy || (!message.trim() && !attachmentCount)} onPress={submitTopic} />
          </AttachmentComposer>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  </View>;
}
const s = StyleSheet.create({
  fill: { flex: 1 }, top: { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }, row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  list: { paddingHorizontal: 12, paddingBottom: 24 }, heading: { fontSize: 17, fontWeight: '600', color: '#172a40' }, hint: { color: '#65758b', fontSize: 13, lineHeight: 19, marginTop: 4 }, summary: { color: '#42566f', lineHeight: 22, marginBottom: 12 },
  form: { padding: 12, backgroundColor: '#edf3fc', borderRadius: 12, marginBottom: 12, gap: 9 }, sheetForm: { paddingHorizontal: 12, paddingBottom: 4, gap: 9 }, input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 9, minHeight: 44, paddingHorizontal: 12, paddingVertical: 9, color: '#172a40' }, description: { minHeight: 140, maxHeight: 260, textAlignVertical: 'top' }, message: { minHeight: 130, maxHeight: 280, marginHorizontal: 12, textAlignVertical: 'top' },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 14, marginBottom: 8, gap: 8 }, action: { backgroundColor: '#2960ad', paddingHorizontal: 12, paddingVertical: 11, borderRadius: 9, minHeight: 44, justifyContent: 'center' }, actionText: { color: '#fff', fontWeight: '600' }, secondary: { backgroundColor: '#e7eef8' }, secondaryText: { color: '#2b4e81' }, disabled: { opacity: 0.5 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }, unread: { color: '#2960ad', fontSize: 12, fontWeight: '600' },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 }, error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10, margin: 12, borderRadius: 8 }, empty: { color: '#65758b', textAlign: 'center', padding: 24 },
  fab: { position: 'absolute', right: 20, width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2960ad', shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 7 }, fabText: { color: '#fff', fontSize: 32, lineHeight: 36 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' }, backdrop: { position: 'absolute', inset: 0, backgroundColor: 'rgba(11, 24, 40, 0.42)' }, composer: { backgroundColor: '#f8fafc', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 4, maxHeight: '82%', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: -4 }, elevation: 12 }
});
