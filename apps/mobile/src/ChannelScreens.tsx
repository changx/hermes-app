import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useIsFocused } from 'expo-router';
import { Text, TextInput } from './FontSize';
import type { HermesClient, ThreadSummary } from '../../../packages/client/src/index';
import { channelPatch, threadPatch } from './channel-edits';

type Props = { client: HermesClient; channelId: string | null; onChannel: (id: string | null) => void; onThread: (id: string) => void };
function Action({ label, onPress, disabled = false, secondary = false }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[s.action, secondary && s.secondary, disabled && s.disabled]}><Text style={[s.actionText, secondary && s.secondaryText]}>{label}</Text></Pressable>;
}

export function ChannelScreens({ client, channelId, onChannel, onThread }: Props) {
  const [creating, setCreating] = useState(false), [editing, setEditing] = useState(false);
  const [name, setName] = useState(''), [description, setDescription] = useState('');
  const [title, setTitle] = useState(''), [renaming, setRenaming] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const working = useRef(false), generation = useRef(0);
  const focused = useIsFocused(), focusedRef = useRef(focused);
  focusedRef.current = focused;
  useFocusEffect(React.useCallback(() => {
    focusedRef.current = true;
    return () => { focusedRef.current = false; generation.current++; };
  }, []));
  useEffect(() => {
    generation.current++;
    setCreating(false); setEditing(false); setRenaming(null); setName(''); setDescription(''); setTitle(''); setError('');
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
  const threads = [...client.threads.values()].filter(t => t.project_id === channelId && !t.archived).sort((a, b) => b.last_ref - a.last_ref || a.title.localeCompare(b.title));
  const startEdit = () => { if (!channel) return; setName(channel.name); setDescription(channel.description || ''); setEditing(true); setCreating(false); setError(''); };
  const rename = (thread: ThreadSummary) => { setRenaming(thread.id); setNewTitle(thread.title); setError(''); };
  const channelForm = (editing || creating) && <View style={s.form}>
    <Text style={s.heading}>{editing ? 'Edit channel' : 'New channel'}</Text>
    <TextInput accessibilityLabel="Channel name" placeholder="Channel name" value={name} onChangeText={setName} style={s.input} editable={!busy} maxLength={200} />
    <TextInput accessibilityLabel="Channel description" placeholder="Context, goals, or guidelines (optional)" value={description} onChangeText={setDescription} multiline style={[s.input, s.description]} editable={!busy} />
    <Text style={s.hint}>New topics will use this description. Existing conversations will not change.</Text>
    <View style={s.row}>
      <Action label={busy ? 'Saving…' : editing ? 'Save' : 'Create channel'} disabled={busy || !name.trim()} onPress={() => void run(async current => {
        const patch = channelPatch(name, description);
        if (editing && channelId) { await client.updateChannel(channelId, patch); if (current()) setEditing(false); }
        else { const made = await client.createChannel(patch.name, patch.description); if (current()) { setCreating(false); onChannel(made.id); } }
      })} />
      <Action label="Cancel" secondary disabled={busy} onPress={() => { setCreating(false); setEditing(false); }} />
    </View>
  </View>;
  return <View style={s.fill}>
    <View style={s.top}>
      <Text style={[s.heading, s.fill]} numberOfLines={2}>{channelId ? channel?.name || 'Channel' : 'Channels'}</Text>
      <Action label={channelId ? 'Edit' : 'New'} secondary disabled={busy} onPress={channelId ? startEdit : () => { setName(''); setDescription(''); setCreating(true); }} />
    </View>
    {busy && <View style={s.progress}><ActivityIndicator size="small" /><Text style={s.hint}>Saving…</Text></View>}
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {channelId ? <FlatList keyboardShouldPersistTaps="handled" data={threads} keyExtractor={t => t.id} contentContainerStyle={s.list}
      ListHeaderComponent={<>
        {channelForm}
        {!!channel?.description && !editing && <Text selectable style={s.summary}>{channel.description}</Text>}
        <View style={s.form}><Text style={s.heading}>New topic</Text><View style={s.row}><TextInput accessibilityLabel="New topic title" placeholder="What would you like to discuss?" value={title} onChangeText={setTitle} style={[s.input, s.fill]} editable={!busy} maxLength={200} /><Action label="Create" disabled={busy || !title.trim()} onPress={() => void run(async current => { const made = await client.createThread(channelId, threadPatch(title).title); await client.getThread(made.id); if (current()) { setTitle(''); onThread(made.id); } })} /></View></View>
      </>}
      renderItem={({ item }) => <View style={s.card}>
        {renaming === item.id ? <><TextInput accessibilityLabel="New topic name" style={s.input} value={newTitle} onChangeText={setNewTitle} editable={!busy} maxLength={200} /><View style={s.row}><Action label="Save" disabled={busy || !newTitle.trim()} onPress={() => void run(async current => { await client.updateThread(item.id, threadPatch(newTitle)); if (current()) setRenaming(null); })} /><Action label="Cancel" secondary disabled={busy} onPress={() => setRenaming(null)} /></View></> : <View style={s.row}><Pressable accessibilityRole="button" onPress={() => onThread(item.id)} style={s.fill}><Text style={s.heading}>{item.title}</Text><Text style={s.hint}>{item.unread_count ? `${item.unread_count} unread` : 'Open conversation'}</Text></Pressable><Action label="Rename" secondary disabled={busy} onPress={() => rename(item)} /></View>}
      </View>}
      ListEmptyComponent={<Text style={s.empty}>No topics yet. Create one to start a conversation.</Text>} /> : <FlatList keyboardShouldPersistTaps="handled" data={channels} keyExtractor={c => c.id} contentContainerStyle={s.list} ListHeaderComponent={channelForm || null}
      renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={() => onChannel(item.id)} style={s.card}><Text style={s.heading}>{item.name}</Text><Text numberOfLines={2} style={s.hint}>{item.description || 'A space for a project or ongoing conversations'}</Text></Pressable>}
      ListEmptyComponent={<Text style={s.empty}>Create a channel to keep related topics together.</Text>} />}
  </View>;
}
const s = StyleSheet.create({
  fill: { flex: 1 }, top: { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }, row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  list: { paddingHorizontal: 12, paddingBottom: 24 }, heading: { fontSize: 17, fontWeight: '600', color: '#172a40' }, hint: { color: '#65758b', fontSize: 13, lineHeight: 19, marginTop: 4 }, summary: { color: '#42566f', lineHeight: 22, marginBottom: 12 },
  form: { padding: 12, backgroundColor: '#edf3fc', borderRadius: 12, marginBottom: 12, gap: 9 }, input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 9, minHeight: 44, paddingHorizontal: 12, paddingVertical: 9, color: '#172a40' }, description: { minHeight: 85, maxHeight: 160, textAlignVertical: 'top' },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 14, marginBottom: 8, gap: 8 }, action: { backgroundColor: '#2960ad', paddingHorizontal: 12, paddingVertical: 11, borderRadius: 9, minHeight: 44, justifyContent: 'center' }, actionText: { color: '#fff', fontWeight: '600' }, secondary: { backgroundColor: '#e7eef8' }, secondaryText: { color: '#2b4e81' }, disabled: { opacity: 0.5 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 }, error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10, margin: 12, borderRadius: 8 }, empty: { color: '#65758b', textAlign: 'center', padding: 24 }
});
