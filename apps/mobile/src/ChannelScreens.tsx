import React, { type ReactNode, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, AppState, type AppStateStatus, Easing, FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useFocusEffect, useIsFocused } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, TextInput } from './FontSize';
import type { HermesClient, ThreadSummary } from '../../../packages/client/src/index';
import { channelPatch, threadPatch } from './channel-edits';
import { AttachmentComposer, type AttachmentComposerHandle } from './Attachments';
import { MessageTime } from './MessageTime';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { isThreadRunning } from './threadListState';

type Props = { client: HermesClient; channelId: string | null; onChannel: (id: string | null) => void; onThread: (id: string) => void };
function Action({ label, onPress, disabled = false, secondary = false }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={[s.action, secondary && s.secondary, disabled && s.disabled]}><Text style={[s.actionText, secondary && s.secondaryText]}>{label}</Text></Pressable>;
}

function IconAction({ label, ios, android, onPress, disabled = false }: { label: string; ios: SFSymbol; android: AndroidSymbol; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.iconAction, pressed && s.iconActionPressed, disabled && s.disabled]}>
    <SymbolView name={{ ios, android }} size={19} tintColor="#2b4e81" weight="medium" fallback={<Text style={s.iconFallback}>✎</Text>} />
  </Pressable>;
}

export const editorKeyboardEnabled = (visible: boolean, appState: AppStateStatus, keyboardVisible: boolean) =>
  visible && appState === 'active' && keyboardVisible;

export function EditorSheet({ visible, closeLabel, busy, bottomInset, reduceMotion, onClose, children }: {
  visible: boolean; closeLabel: string; busy: boolean; bottomInset: number; reduceMotion: boolean; onClose: () => void; children: ReactNode;
}) {
  const { height } = useWindowDimensions();
  const sheetOffset = useRef(new Animated.Value(height)).current;
  const openingHeight = useRef(height);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [keyboardVisible, setKeyboardVisible] = useState(Keyboard.isVisible());
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardVisible(false));
    const app = AppState.addEventListener('change', state => {
      setAppState(state);
      if (state === 'active') setKeyboardVisible(Keyboard.isVisible());
    });
    return () => { show.remove(); hide.remove(); app.remove(); };
  }, []);
  useEffect(() => {
    if (!visible) {
      openingHeight.current = height;
      sheetOffset.setValue(height);
    }
  }, [height, sheetOffset, visible]);
  useEffect(() => {
    if (!visible) return;
    sheetOffset.setValue(openingHeight.current);
    const animation = Animated.timing(sheetOffset, {
      toValue: 0,
      duration: reduceMotion ? 0 : 250,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [reduceMotion, sheetOffset, visible]);
  return <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
    <View style={s.modalRoot}>
      <Pressable accessibilityRole="button" accessibilityLabel={closeLabel} style={s.backdrop} disabled={busy} onPress={onClose} />
      <KeyboardAvoidingView pointerEvents="box-none" style={s.keyboardLayer} behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        enabled={Platform.OS !== 'ios' || editorKeyboardEnabled(visible, appState, keyboardVisible)}>
        <Animated.View style={[s.composer, { paddingBottom: Math.max(14, bottomInset), transform: [{ translateY: sheetOffset }] }]}>
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  </Modal>;
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
  const [reduceMotion, setReduceMotion] = useState(false);
  focusedRef.current = focused;
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (active) setReduceMotion(value); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { active = false; subscription.remove(); };
  }, []);
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
  // Newest activity first in data; the inverted list shows it at the bottom and
  // starts there natively, so entering a channel needs no scroll at all.
  const threads = [...client.threads.values()].filter(t => t.project_id === channelId && !t.archived)
    .sort((a, b) => (b.last_message_at ?? 0) - (a.last_message_at ?? 0) || b.last_ref - a.last_ref || b.title.localeCompare(a.title));
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
  const channelForm = editing && <View style={[s.form, { marginHorizontal: 12 }]}>
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
    {channelForm}
    {channelId ? <FlatList inverted={threads.length > 0} keyboardShouldPersistTaps="handled" data={threads} keyExtractor={t => t.id}
      contentContainerStyle={[s.list, threads.length > 0 ? { paddingTop: 96 + insets.bottom } : { paddingBottom: 96 + insets.bottom }]}
      ListFooterComponent={!!channel?.description && !editing ? <Text selectable style={s.summary}>{channel.description}</Text> : null}
      renderItem={({ item }) => <View style={s.card}>
        {renaming === item.id ? <><TextInput accessibilityLabel="New topic name" style={s.input} value={newTitle} onChangeText={setNewTitle} editable={!busy} maxLength={200} /><View style={s.row}><Action label="Save" disabled={busy || !newTitle.trim()} onPress={() => void run(async current => { await client.updateThread(item.id, threadPatch(newTitle)); if (current()) setRenaming(null); })} /><Action label="Cancel" secondary disabled={busy} onPress={() => setRenaming(null)} /></View></> : <View style={s.row}><Pressable accessibilityRole="button" onPress={() => onThread(item.id)} style={s.fill}><Text style={s.heading}>{item.title}</Text><View style={s.meta}><MessageTime seconds={item.last_message_at} />{isThreadRunning(item.id, client.receipts.values()) && <View accessible accessibilityRole="text" accessibilityLabel="Running" style={s.running}><View style={s.runningDot} /><Text style={s.runningText}>Running</Text></View>}{!!item.unread_count && <Text style={s.unread}>{item.unread_count} unread</Text>}</View></Pressable><IconAction label="Rename" ios="square.and.pencil" android="edit" disabled={busy} onPress={() => rename(item)} /></View>}
      </View>}
      ListEmptyComponent={<Text style={s.empty}>No topics yet. Tap + to start a conversation.</Text>} /> : <FlatList keyboardShouldPersistTaps="handled" data={channels} keyExtractor={c => c.id} contentContainerStyle={[s.list, { paddingBottom: 96 + insets.bottom }]}
      renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={() => onChannel(item.id)} style={s.card}><Text style={s.heading}>{item.name}</Text><Text numberOfLines={2} style={s.hint}>{item.description || 'A space for a project or ongoing conversations'}</Text></Pressable>}
      ListEmptyComponent={<Text style={s.empty}>Create a channel to keep related topics together.</Text>} />}
    {!!channelId && <Pressable accessibilityRole="button" accessibilityLabel="New topic" disabled={busy} onPress={openComposer} style={[s.fab, { bottom: 18 + insets.bottom }, busy && s.disabled]}><Text style={s.fabText}>＋</Text></Pressable>}
    {!channelId && <Pressable accessibilityRole="button" accessibilityLabel="New channel" disabled={busy} onPress={startCreate} style={[s.fab, { bottom: 18 + insets.bottom }, busy && s.disabled]}><Text style={s.fabText}>＋</Text></Pressable>}
    <EditorSheet visible={creating} closeLabel="Close new channel editor" busy={busy} bottomInset={insets.bottom} reduceMotion={reduceMotion} onClose={cancelChannelForm}>
      <View style={s.top}><Text style={[s.heading, s.fill]}>New channel</Text><Action label="Cancel" secondary disabled={busy} onPress={cancelChannelForm} /></View>
      {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      <View style={s.sheetForm}>
        <TextInput accessibilityLabel="Channel name" placeholder="Channel name" placeholderTextColor="#65758b" value={name} onChangeText={setName} style={s.input} editable={!busy} maxLength={200} autoFocus />
        <TextInput accessibilityLabel="Channel description" placeholder="Context, goals, or guidelines (optional)" placeholderTextColor="#65758b" value={description} onChangeText={setDescription} multiline style={[s.input, s.description]} editable={!busy} />
        <Text style={s.hint}>New topics will use this description. Existing conversations will not change.</Text>
        <View style={s.row}><View style={s.fill} /><Action label={busy ? 'Creating…' : 'Create channel'} disabled={busy || !name.trim()} onPress={submitChannel} /></View>
      </View>
    </EditorSheet>
    <EditorSheet visible={composing} closeLabel="Close new topic composer" busy={busy} bottomInset={insets.bottom} reduceMotion={reduceMotion} onClose={cancelComposer}>
      <View style={s.top}><Text style={[s.heading, s.fill]}>New topic</Text><Action label="Cancel" secondary disabled={busy} onPress={cancelComposer} /></View>
      {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      <TextInput accessibilityLabel="First message" placeholder="What would you like to discuss?" value={message} onChangeText={setMessage} editable={!busy} multiline autoFocus maxLength={16000} style={[s.input, s.message]} />
      <AttachmentComposer handleRef={attachmentComposer} client={client} threadId={null} clearKey={attachmentClearKey} disabled={busy}
        onSelectionChange={setAttachmentCount} onChange={(_, pending) => setAttachmentBusy(pending)} onPasteText={text => setMessage(value => value + text)}>
        <View style={s.fill} />
        <Action label={busy ? 'Creating…' : 'Create topic'} disabled={busy || attachmentBusy || (!message.trim() && !attachmentCount)} onPress={submitTopic} />
      </AttachmentComposer>
    </EditorSheet>
  </View>;
}
const s = StyleSheet.create({
  fill: { flex: 1 }, top: { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }, row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  list: { paddingHorizontal: 12, paddingBottom: 24 }, heading: { fontSize: 17, fontWeight: '600', color: '#172a40' }, hint: { color: '#65758b', fontSize: 13, lineHeight: 19, marginTop: 4 }, summary: { color: '#42566f', lineHeight: 22, marginBottom: 12 },
  form: { padding: 12, backgroundColor: '#edf3fc', borderRadius: 12, marginBottom: 12, gap: 9 }, sheetForm: { paddingHorizontal: 12, paddingBottom: 4, gap: 9 }, input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 9, minHeight: 44, paddingHorizontal: 12, paddingVertical: 9, color: '#172a40' }, description: { minHeight: 140, maxHeight: 260, textAlignVertical: 'top' }, message: { minHeight: 130, maxHeight: 280, marginHorizontal: 12, textAlignVertical: 'top' },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 14, marginBottom: 8, gap: 8 }, action: { backgroundColor: '#2960ad', paddingHorizontal: 12, paddingVertical: 11, borderRadius: 9, minHeight: 44, justifyContent: 'center' }, actionText: { color: '#fff', fontWeight: '600' }, secondary: { backgroundColor: '#e7eef8' }, secondaryText: { color: '#2b4e81' }, iconAction: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e7eef8' }, iconActionPressed: { backgroundColor: '#d8e4f3' }, iconFallback: { color: '#2b4e81', fontSize: 21, lineHeight: 24 }, disabled: { opacity: 0.5 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }, running: { flexDirection: 'row', alignItems: 'center', gap: 4 }, runningDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#238636' }, runningText: { color: '#237a35', fontSize: 12, fontWeight: '600' }, unread: { color: '#2960ad', fontSize: 12, fontWeight: '600' },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 }, error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10, margin: 12, borderRadius: 8 }, empty: { color: '#65758b', textAlign: 'center', padding: 24 },
  fab: { position: 'absolute', right: 20, width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2960ad', shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 7 }, fabText: { color: '#fff', fontSize: 32, lineHeight: 36 },
  modalRoot: { flex: 1 }, backdrop: { position: 'absolute', inset: 0, backgroundColor: 'rgba(11, 24, 40, 0.42)' }, keyboardLayer: { flex: 1, justifyContent: 'flex-end' }, composer: { backgroundColor: '#f8fafc', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 4, maxHeight: '82%', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: -4 }, elevation: 12 }
});
