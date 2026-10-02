import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useIsFocused } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, TextInput } from './FontSize';
import type { Attachment, ThreadSummary } from '../../../packages/client/src/index';
import type { LiveSessionClient } from '../../../packages/client/src/liveClient';
import { NewTopicComposer } from './NewTopicComposer';
import { channelPatch, threadPatch } from './channel-edits';
import { MessageTime } from './MessageTime';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';


type Props = {
  client: LiveSessionClient;
  channelId: string | null;
  onChannel: (id: string | null) => void;
  onThread: (id: string) => void;
  onNewChannel: () => void;
  enqueueFirstMessage: (threadId: string, messageId: string, text: string, attachments: Attachment[]) => Promise<void>;
};
function Action({ label, onPress, disabled = false, secondary = false }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={[s.action, secondary && s.secondary, disabled && s.disabled]}><Text style={[s.actionText, secondary && s.secondaryText]}>{label}</Text></Pressable>;
}

function IconAction({ label, ios, android, onPress, disabled = false }: { label: string; ios: SFSymbol; android: AndroidSymbol; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.iconAction, pressed && s.iconActionPressed, disabled && s.disabled]}>
    <SymbolView name={{ ios, android }} size={19} tintColor="#2b4e81" weight="medium" fallback={<Text style={s.iconFallback}>✎</Text>} />
  </Pressable>;
}

export function ChannelScreens({ client, channelId, onChannel, onThread, onNewChannel, enqueueFirstMessage }: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(''), [description, setDescription] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const working = useRef(false), generation = useRef(0);
  const focused = useIsFocused(), focusedRef = useRef(focused), insets = useSafeAreaInsets();
  focusedRef.current = focused;
  useFocusEffect(React.useCallback(() => {
    focusedRef.current = true;
    return () => { focusedRef.current = false; generation.current++; };
  }, []));
  useEffect(() => {
    generation.current++;
    setEditing(false); setRenaming(null); setName(''); setDescription(''); setError('');
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
  const startEdit = () => void run(async current => { if (!channel) return; const detail = await client.getChannelInfo(channel.id); if (!current()) return; setName(detail.name); setDescription(detail.description || ''); setEditing(true); });
  const cancelChannelForm = () => { setEditing(false); setError(''); };
  const submitChannel = () => void run(async current => {
    const patch = channelPatch(name, description);
    if (editing && channelId) { await client.updateChannel(channelId, patch); if (current()) setEditing(false); }
  });
  const rename = (thread: ThreadSummary) => { setRenaming(thread.id); setNewTitle(thread.title); setError(''); };
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
    {busy && <View style={s.progress}><ActivityIndicator size="small" /><Text style={s.hint}>Saving…</Text></View>}
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {channelForm}
    {channelId ? <FlatList inverted={threads.length > 0} keyboardShouldPersistTaps="handled" data={threads} keyExtractor={t => t.id}
      style={s.fill} maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      keyboardDismissMode="on-drag" contentContainerStyle={[s.list, { paddingTop: 16 }]}
      ListFooterComponent={!!channel?.description && !editing ? <Text selectable style={s.summary}>{channel.description}</Text> : null}
      renderItem={({ item }) => <View style={s.card}>
        {renaming === item.id ? <><TextInput accessibilityLabel="New topic name" style={s.input} value={newTitle} onChangeText={setNewTitle} editable={!busy} maxLength={200} /><View style={s.row}><Action label="Save" disabled={busy || !newTitle.trim()} onPress={() => void run(async current => { await client.updateThread(item.id, threadPatch(newTitle)); if (current()) setRenaming(null); })} /><Action label="Cancel" secondary disabled={busy} onPress={() => setRenaming(null)} /></View></> : <View style={s.row}><Pressable accessibilityRole="button" onPress={() => onThread(item.id)} style={s.fill}><Text style={s.heading}>{item.title}</Text><View style={s.meta}><MessageTime seconds={item.last_message_at} />{item.running === true && <View accessible accessibilityRole="text" accessibilityLabel="Running" style={s.running}><View style={s.runningDot} /><Text style={s.runningText}>Running</Text></View>}</View></Pressable><IconAction label="Rename" ios="square.and.pencil" android="edit" disabled={busy} onPress={() => rename(item)} /></View>}
      </View>}
      ListEmptyComponent={<Text style={s.empty}>No topics yet. Write a message below to start a conversation.</Text>} /> : <FlatList keyboardShouldPersistTaps="handled" data={channels} keyExtractor={c => c.id} contentContainerStyle={[s.list, { paddingBottom: 96 + insets.bottom }]}
      renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={() => onChannel(item.id)} style={s.card}><Text style={s.heading}>{item.name}</Text><Text numberOfLines={2} style={s.hint}>{item.description || 'A space for a project or ongoing conversations'}</Text></Pressable>}
      ListEmptyComponent={<Text style={s.empty}>Create a channel to keep related topics together.</Text>} />}
    {!!channelId && <NewTopicComposer key={channelId} client={client} channelId={channelId} enqueue={enqueueFirstMessage} onCreated={onThread} disabled={busy || editing || !!renaming} />}
    {!channelId && <Pressable accessibilityRole="button" accessibilityLabel="New channel" disabled={busy} onPress={onNewChannel} style={[s.fab, { bottom: 18 + insets.bottom }, busy && s.disabled]}><Text style={s.fabText}>＋</Text></Pressable>}
  </View>;
}
const s = StyleSheet.create({
  fill: { flex: 1 }, top: { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }, row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  list: { paddingHorizontal: 12, paddingBottom: 24 }, heading: { fontSize: 17, fontWeight: '600', color: '#172a40' }, hint: { color: '#65758b', fontSize: 13, lineHeight: 19, marginTop: 4 }, summary: { color: '#42566f', lineHeight: 22, marginBottom: 12 },
  form: { padding: 12, backgroundColor: '#edf3fc', borderRadius: 12, marginBottom: 12, gap: 9 }, input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 9, minHeight: 44, paddingHorizontal: 12, paddingVertical: 9, color: '#172a40' }, description: { minHeight: 140, maxHeight: 260, textAlignVertical: 'top' },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 14, marginBottom: 8, gap: 8 }, action: { backgroundColor: '#2960ad', paddingHorizontal: 12, paddingVertical: 11, borderRadius: 9, minHeight: 44, justifyContent: 'center' }, actionText: { color: '#fff', fontWeight: '600' }, secondary: { backgroundColor: '#e7eef8' }, secondaryText: { color: '#2b4e81' }, iconAction: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e7eef8' }, iconActionPressed: { backgroundColor: '#d8e4f3' }, iconFallback: { color: '#2b4e81', fontSize: 21, lineHeight: 24 }, disabled: { opacity: 0.5 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }, running: { flexDirection: 'row', alignItems: 'center', gap: 4 }, runningDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#238636' }, runningText: { color: '#237a35', fontSize: 12, fontWeight: '600' }, unread: { color: '#2960ad', fontSize: 12, fontWeight: '600' },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 }, error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10, margin: 12, borderRadius: 8 }, empty: { color: '#65758b', textAlign: 'center', padding: 24 },
  fab: { position: 'absolute', right: 20, width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2960ad', shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 7 }, fabText: { color: '#fff', fontSize: 32, lineHeight: 36 }
});
