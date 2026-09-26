import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
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
  useEffect(() => {
    generation.current++;
    setCreating(false); setEditing(false); setRenaming(null); setName(''); setDescription(''); setTitle(''); setError('');
    return () => { generation.current++; };
  }, [channelId, client]);
  const run = async (work: (isCurrent: () => boolean) => Promise<void>) => {
    if (working.current) return;
    const version = generation.current; working.current = true; setBusy(true); setError('');
    const isCurrent = () => generation.current === version;
    try { await work(isCurrent); }
    catch (e) { if (isCurrent()) setError(e instanceof Error ? e.message : '操作失败，请重试'); }
    finally { working.current = false; setBusy(false); }
  };
  const channel = client.channels.get(channelId || '');
  const channels = [...client.channels.values()].sort((a, b) => a.name.localeCompare(b.name));
  const threads = [...client.threads.values()].filter(t => t.project_id === channelId && !t.archived).sort((a, b) => b.last_ref - a.last_ref || a.title.localeCompare(b.title));
  const startEdit = () => { if (!channel) return; setName(channel.name); setDescription(channel.description || ''); setEditing(true); setCreating(false); setError(''); };
  const rename = (thread: ThreadSummary) => { setRenaming(thread.id); setNewTitle(thread.title); setError(''); };
  const channelForm = (editing || creating) && <View style={s.form}>
    <Text style={s.heading}>{editing ? '编辑频道' : '新建频道'}</Text>
    <TextInput accessibilityLabel="频道名称" placeholder="频道名称" value={name} onChangeText={setName} style={s.input} editable={!busy} maxLength={200} />
    <TextInput accessibilityLabel="频道说明" placeholder="背景、目标或约定（可选）" value={description} onChangeText={setDescription} multiline style={[s.input, s.description]} editable={!busy} />
    <Text style={s.hint}>说明用于新话题的初始上下文；修改不会重写已有对话。</Text>
    <View style={s.row}>
      <Action label={busy ? '保存中…' : editing ? '保存' : '创建频道'} disabled={busy || !name.trim()} onPress={() => void run(async current => {
        const patch = channelPatch(name, description);
        if (editing && channelId) { await client.updateChannel(channelId, patch); if (current()) setEditing(false); }
        else { const made = await client.createChannel(patch.name, patch.description); if (current()) { setCreating(false); onChannel(made.id); } }
      })} />
      <Action label="取消" secondary disabled={busy} onPress={() => { setCreating(false); setEditing(false); }} />
    </View>
  </View>;
  return <View style={s.fill}>
    <View style={s.top}>
      {channelId && <Action label="‹ 频道" secondary disabled={busy} onPress={() => onChannel(null)} />}
      <Text style={[s.heading, s.fill]} numberOfLines={2}>{channelId ? channel?.name || '频道' : '频道'}</Text>
      <Action label={channelId ? '编辑' : '新建'} secondary disabled={busy} onPress={channelId ? startEdit : () => { setName(''); setDescription(''); setCreating(true); }} />
    </View>
    {busy && <View style={s.progress}><ActivityIndicator size="small" /><Text style={s.hint}>正在保存…</Text></View>}
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {channelId ? <FlatList keyboardShouldPersistTaps="handled" data={threads} keyExtractor={t => t.id} contentContainerStyle={s.list}
      ListHeaderComponent={<>
        {channelForm}
        {!!channel?.description && !editing && <Text selectable style={s.summary}>{channel.description}</Text>}
        <View style={s.form}><Text style={s.heading}>新话题</Text><View style={s.row}><TextInput accessibilityLabel="新话题标题" placeholder="想聊什么？" value={title} onChangeText={setTitle} style={[s.input, s.fill]} editable={!busy} maxLength={200} /><Action label="创建" disabled={busy || !title.trim()} onPress={() => void run(async current => { const made = await client.createThread(channelId, threadPatch(title).title); await client.getThread(made.id); if (current()) { setTitle(''); onThread(made.id); } })} /></View></View>
      </>}
      renderItem={({ item }) => <View style={s.card}>
        {renaming === item.id ? <><TextInput accessibilityLabel="话题新名称" style={s.input} value={newTitle} onChangeText={setNewTitle} editable={!busy} maxLength={200} /><View style={s.row}><Action label="保存" disabled={busy || !newTitle.trim()} onPress={() => void run(async current => { await client.updateThread(item.id, threadPatch(newTitle)); if (current()) setRenaming(null); })} /><Action label="取消" secondary disabled={busy} onPress={() => setRenaming(null)} /></View></> : <View style={s.row}><Pressable accessibilityRole="button" onPress={() => onThread(item.id)} style={s.fill}><Text style={s.heading}>{item.title}</Text><Text style={s.hint}>{item.unread_count ? `${item.unread_count} 条未读` : '打开对话'}</Text></Pressable><Action label="改名" secondary disabled={busy} onPress={() => rename(item)} /></View>}
      </View>}
      ListEmptyComponent={<Text style={s.empty}>还没有话题。创建一个，开始讨论。</Text>} /> : <FlatList keyboardShouldPersistTaps="handled" data={channels} keyExtractor={c => c.id} contentContainerStyle={s.list} ListHeaderComponent={channelForm || null}
      renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={() => onChannel(item.id)} style={s.card}><Text style={s.heading}>{item.name}</Text><Text numberOfLines={2} style={s.hint}>{item.description || '项目或长期讨论空间'}</Text></Pressable>}
      ListEmptyComponent={<Text style={s.empty}>创建一个频道，把相关话题放在一起。</Text>} />}
  </View>;
}
const s = StyleSheet.create({
  fill: { flex: 1 }, top: { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }, row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  list: { paddingHorizontal: 12, paddingBottom: 24 }, heading: { fontSize: 17, fontWeight: '600', color: '#172a40' }, hint: { color: '#65758b', fontSize: 13, lineHeight: 19, marginTop: 4 }, summary: { color: '#42566f', lineHeight: 22, marginBottom: 12 },
  form: { padding: 12, backgroundColor: '#edf3fc', borderRadius: 12, marginBottom: 12, gap: 9 }, input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 9, minHeight: 44, paddingHorizontal: 12, paddingVertical: 9, color: '#172a40' }, description: { minHeight: 85, maxHeight: 160, textAlignVertical: 'top' },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 14, marginBottom: 8, gap: 8 }, action: { backgroundColor: '#2960ad', paddingHorizontal: 12, paddingVertical: 11, borderRadius: 9, minHeight: 44, justifyContent: 'center' }, actionText: { color: '#fff', fontWeight: '600' }, secondary: { backgroundColor: '#e7eef8' }, secondaryText: { color: '#2b4e81' }, disabled: { opacity: 0.5 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 }, error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10, margin: 12, borderRadius: 8 }, empty: { color: '#65758b', textAlign: 'center', padding: 24 }
});
