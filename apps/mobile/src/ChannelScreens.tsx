import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useIsFocused } from 'expo-router';
import { Text, TextInput } from './FontSize';
import type { Attachment, ThreadSummary } from '../../../packages/client/src/index';
import type { LiveSessionClient } from '../../../packages/client/src/liveClient';
import { NewTopicComposer } from './NewTopicComposer';
import { threadPatch } from './channel-edits';
import { MessageTime } from './MessageTime';
import { LabelPills, LabelsFilter } from './SessionLabels';
import { emptyLabelFilter, labelFilterActive, matchesLabels } from '../../../packages/client/src/sessionLabels';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';


type Props = {
  client: LiveSessionClient;
  channelId: string;
  draftThreads?: ReadonlySet<string>;
  onThread: (id: string) => void;
  onContext: (id: string) => void;
  onFiles: (id: string) => void;
  onAgents: (id: string) => void;
  onLabels: (id: string) => void;
  /** Archives the Channel and leaves its page. The page unmounts when the Channel disappears. */
  onArchive: () => Promise<void>;
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

export function ChannelScreens({ client, channelId, draftThreads, onThread, onContext, onFiles, onAgents, onLabels, onArchive, enqueueFirstMessage }: Props) {
  const [editing, setEditing] = useState(false);
  const [labelFilter, setLabelFilter] = useState(emptyLabelFilter);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
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
    setEditing(false); setRenaming(null); setName(''); setError('');
    setLabelFilter(emptyLabelFilter());
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
  const channel = client.channels.get(channelId);
  // Running sessions first; latest activity first within each group.
  const channelThreads = [...client.threads.values()].filter(t => t.project_id === channelId && !t.archived)
    .sort((a, b) => Number(b.running === true) - Number(a.running === true) || (b.last_message_at ?? 0) - (a.last_message_at ?? 0) || b.title.localeCompare(a.title) || a.id.localeCompare(b.id));
  const filtering = client.supportsSessionLabels && labelFilterActive(labelFilter);
  const threads = filtering ? channelThreads.filter(t => matchesLabels(t.markers, labelFilter)) : channelThreads;
  const startEdit = () => { if (!channel || busy) return; setName(channel.name); setEditing(true); setError(''); };
  // Core archive: the Channel and its sessions leave every list; nothing is deleted.
  const archiveChannel = () => Alert.alert(`Archive “${channel?.name ?? 'this channel'}”?`, 'The channel and its sessions will no longer be shown on any device.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Archive', style: 'destructive', onPress: () => void run(onArchive) },
  ]);
  const channelMenu = () => Alert.alert('Channel', undefined, [
    { text: 'Rename channel', onPress: startEdit },
    ...(client.supportsChannelArchive ? [{ text: 'Archive channel', style: 'destructive' as const, onPress: archiveChannel }] : []),
    { text: 'Cancel', style: 'cancel' },
  ]);
  const cancelChannelForm = () => { setEditing(false); setError(''); };
  const submitChannel = () => void run(async current => {
    const patch = { name: threadPatch(name).title };
    if (editing && channelId) { await client.updateChannel(channelId, patch); if (current()) setEditing(false); }
  });
  const rename = (thread: ThreadSummary) => { setRenaming(thread.id); setNewTitle(thread.title); setError(''); };
  const sessionMenu = (thread: ThreadSummary) => { if (busy) return; Alert.alert(thread.title, undefined, [
    { text: 'Rename session', onPress: () => rename(thread) },
    ...(client.supportsSessionLabels ? [{ text: 'Edit labels', onPress: () => { if (focusedRef.current) onLabels(thread.id); } }] : []),
    { text: 'Archive session', style: 'destructive' as const, onPress: () => Alert.alert('Archive this session?', 'It will no longer be shown on any device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Archive', style: 'destructive', onPress: () => void run(async () => { await client.archiveThread(thread.id); }) },
    ]) },
    { text: 'Cancel', style: 'cancel' },
  ]); };
  const channelForm = editing && <View style={[s.form, { marginHorizontal: 12 }]}>
    <Text style={s.heading}>Rename channel</Text>
    <TextInput accessibilityLabel="Channel name" placeholder="Channel name" placeholderTextColor="#65758b" value={name} onChangeText={setName} style={s.input} editable={!busy} maxLength={200} />

    <View style={s.row}>
      <Action label={busy ? 'Saving…' : 'Save'} disabled={busy || !name.trim()} onPress={submitChannel} />
      <Action label="Cancel" secondary disabled={busy} onPress={cancelChannelForm} />
    </View>
  </View>;
  return <View style={s.fill}>
    <View style={s.top}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.fill} contentContainerStyle={s.toolbarLinks}>
      <Pressable accessibilityRole="button" accessibilityLabel="Channel context" disabled={busy || editing || !!renaming}
        onPress={() => onContext(channelId)} style={({ pressed }) => [s.contextLink, pressed && s.iconActionPressed]}>
        <SymbolView name={{ ios: 'info.circle', android: 'info' }} size={18} tintColor="#2b4e81" fallback={<Text>ⓘ</Text>} />
        <Text style={s.contextText}>Context</Text>
      </Pressable>
      {client.supportsChannelWorkspace === true && <>
      <Pressable accessibilityRole="button" accessibilityLabel="Channel files" disabled={busy || editing || !!renaming}
        onPress={() => { if (focusedRef.current) onFiles(channelId); }} style={({ pressed }) => [s.workspaceLink, pressed && s.iconActionPressed]}>
        <SymbolView name={{ ios: 'folder', android: 'folder' }} size={17} tintColor="#2b4e81" fallback={<Text>▤</Text>} />
        <Text style={s.contextText}>Files</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Channel AGENTS.md" disabled={busy || editing || !!renaming}
        onPress={() => { if (focusedRef.current) onAgents(channelId); }} style={({ pressed }) => [s.workspaceLink, pressed && s.iconActionPressed]}>
        <SymbolView name={{ ios: 'doc.text', android: 'description' }} size={17} tintColor="#2b4e81" fallback={<Text>▤</Text>} />
        <Text style={s.contextText}>AGENTS.md</Text>
      </Pressable>
      </>}
      </ScrollView>
      <IconAction label="Channel options" ios="ellipsis" android="more_horiz" disabled={busy || editing || !!renaming} onPress={channelMenu} />
    </View>
    {client.supportsSessionLabels === true && <LabelsFilter key={'labels-filter:' + channelId} rows={channelThreads} value={labelFilter} onChange={setLabelFilter} />}
    {busy && <View style={s.progress}><ActivityIndicator size="small" /><Text style={s.hint}>Saving…</Text></View>}
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {channelForm}
    <FlatList key={'sessions:' + channelId} keyboardShouldPersistTaps="handled" data={threads} keyExtractor={t => t.id}
      style={s.fill} extraData={draftThreads}
      keyboardDismissMode="on-drag" contentContainerStyle={[s.list, { paddingTop: 16 }]}
      ListHeaderComponent={<Text style={s.sectionHeading}>Sessions</Text>}
      renderItem={({ item }) => <View style={s.card}>
        {renaming === item.id ? <><TextInput accessibilityLabel="New session name" style={s.input} value={newTitle} onChangeText={setNewTitle} editable={!busy} maxLength={200} /><View style={s.row}><Action label="Save" disabled={busy || !newTitle.trim()} onPress={() => void run(async current => { await client.updateThread(item.id, threadPatch(newTitle)); if (current()) setRenaming(null); })} /><Action label="Cancel" secondary disabled={busy} onPress={() => setRenaming(null)} /></View></> : <Pressable accessibilityRole="button" accessibilityLabel={`${item.title}${draftThreads?.has(item.id) ? ', draft' : ''}${client.supportsSessionLabels && item.markers?.length ? ', labels: ' + item.markers.join(', ') : ''}`} accessibilityHint="Open session. Long press for options."
          accessibilityActions={[{ name: 'rename', label: 'Rename session' }, ...(client.supportsSessionLabels ? [{ name: 'labels', label: 'Edit labels' }] : [])]} onAccessibilityAction={event => { if (!busy && event.nativeEvent.actionName === 'rename') rename(item); if (!busy && client.supportsSessionLabels && event.nativeEvent.actionName === 'labels' && focusedRef.current) onLabels(item.id); }}
          disabled={busy || editing || !!renaming} onPress={() => onThread(item.id)} onLongPress={() => sessionMenu(item)} style={s.fill}>
          <Text style={s.heading}>{item.title}</Text>{client.supportsSessionLabels && <LabelPills markers={item.markers} />}<View style={s.meta}>{draftThreads?.has(item.id) && <Text accessibilityLabel="Draft" style={s.draft}>draft</Text>}<MessageTime seconds={item.last_message_at} />{item.running === true && <View accessible accessibilityRole="text" accessibilityLabel="Running" style={s.running}><View style={s.runningDot} /><Text style={s.runningText}>Running</Text></View>}{item.completed_unread && <View accessible accessibilityRole="text" accessibilityLabel="Completed, unread" style={s.unreadDot} />}</View>
        </Pressable>}
      </View>}
      ListEmptyComponent={<Text style={s.empty}>{filtering ? 'No matching sessions.' : 'No sessions yet. Write a message below to start a conversation.'}</Text>} />
    <NewTopicComposer key={channelId} client={client} channelId={channelId} enqueue={enqueueFirstMessage} onCreated={onThread} disabled={busy || editing || !!renaming} />
  </View>;
}
const s = StyleSheet.create({
  fill: { flex: 1 }, top: { paddingHorizontal: 12, paddingTop: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }, row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  toolbarLinks: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  contextLink: { minHeight: 44, paddingHorizontal: 6, borderRadius: 6, flexDirection: 'row', alignItems: 'center', gap: 6 },
  workspaceLink: { minHeight: 44, paddingHorizontal: 6, borderRadius: 6, flexDirection: 'row', alignItems: 'center', gap: 6 },
  contextText: { fontSize: 14, color: '#2b4e81' }, sectionHeading: { fontSize: 13, fontWeight: '600', color: '#65758b', marginBottom: 12 },
  list: { paddingHorizontal: 12, paddingBottom: 24 }, heading: { fontSize: 17, fontWeight: '600', color: '#172a40' }, hint: { color: '#65758b', fontSize: 13, lineHeight: 19, marginTop: 4 }, summary: { color: '#42566f', lineHeight: 22, marginBottom: 12 },
  form: { padding: 12, backgroundColor: '#edf3fc', borderRadius: 12, marginBottom: 12, gap: 9 }, input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 9, minHeight: 44, paddingHorizontal: 12, paddingVertical: 9, color: '#172a40' }, description: { minHeight: 140, maxHeight: 260, textAlignVertical: 'top' },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 14, marginBottom: 8, gap: 8 }, action: { backgroundColor: '#2960ad', paddingHorizontal: 12, paddingVertical: 11, borderRadius: 9, minHeight: 44, justifyContent: 'center' }, actionText: { color: '#fff', fontWeight: '600' }, secondary: { backgroundColor: '#e7eef8' }, secondaryText: { color: '#2b4e81' }, iconAction: { width: 44, height: 44, borderRadius: 6, alignItems: 'center', justifyContent: 'center' }, iconActionPressed: { backgroundColor: '#d8e4f3' }, iconFallback: { color: '#2b4e81', fontSize: 21, lineHeight: 24 }, disabled: { opacity: 0.5 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }, running: { flexDirection: 'row', alignItems: 'center', gap: 4 }, runningDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#238636' }, runningText: { color: '#237a35', fontSize: 12, fontWeight: '600' }, unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4DA3FF' },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 }, error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10, margin: 12, borderRadius: 8 }, empty: { color: '#65758b', textAlign: 'center', padding: 24 },
  draft: { color: '#dc2626', fontSize: 12, fontWeight: '600' },
  fab: { position: 'absolute', right: 20, width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2960ad', shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 7 }, fabText: { color: '#fff', fontSize: 32, lineHeight: 36 }
});
