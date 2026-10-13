import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { HeaderIcon, Notice, labelsRoute, useConnections } from '../../App';
import { threadPatch } from '../../channel-edits';
import { setThreadTodo } from '../../todoToggle';
import { Text, TextInput } from '../../FontSize';
import { MessageTime } from '../../MessageTime';
import { TabHeader } from '../../TabHeader';
import { quickLabels, recentRows, searchRecentRows, todoRows, type RecentRow } from '../../recentRows';
import { TodoFlag } from '../../TodoFlag';
import { hasTodo } from '../../../../../packages/client/src/todo';
import { addQueryLabel, emptySessionQuery, removeQueryLabel, sessionQueryActive, type SessionQuery } from '../../../../../packages/client/src/sessionSearch';
import { useSessionNavigation } from '../../sessionNavigation';
import { tabListBottomPadding } from '../../tabInsets';

const MINUTE = 60_000;

type Item = { kind: 'section'; key: string; title: string } | { kind: 'row'; key: string; row: RecentRow };

/**
 * Recents tab: a Todo section (every flagged Thread, any age), then the
 * user's own Threads with activity in the last 72 hours. Both lists put
 * running Threads first, then newest activity. A search shows one result list.
 */
export default function Recents() {
  const { ready, connections, revision, listError } = useConnections();
  const navigation = useSessionNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // The 72-hour window moves with time, not only with directory changes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), MINUTE); return () => clearInterval(timer); }, []);
  const [query, setQuery] = useState<SessionQuery>(emptySessionQuery);
  const searching = sessionQueryActive(query);
  const items = useMemo((): Item[] => {
    const rowItem = (section: string) => (row: RecentRow): Item => ({ kind: 'row', key: `${section}:${row.key}`, row });
    if (searching) return searchRecentRows(connections, query).map(rowItem('search'));
    const todos = todoRows(connections), recents = recentRows(connections, now / 1000);
    if (!todos.length) return recents.map(rowItem('recent'));
    return [{ kind: 'section', key: 'section:todo', title: 'Todo' }, ...todos.map(rowItem('todo')),
      ...(recents.length ? [{ kind: 'section' as const, key: 'section:recent', title: 'Recent' }, ...recents.map(rowItem('recent'))] : [])];
  }, [connections, revision, now, query, searching]);
  // Selected labels stay visible (first) even when they are not among the five most used.
  const labels = useMemo(() => { const top = quickLabels(connections); return [...query.labels.filter(label => !top.includes(label)), ...top]; }, [connections, revision, query.labels]);
  const toggle = (label: string) => setQuery(old => old.labels.includes(label) ? removeQueryLabel(old, label) : addQueryLabel(old, label));
  const multiple = connections.length > 1;
  const loading = connections.some(c => c.client && !c.client.isCatalogueReady);
  // Long press: the same Session menu as the Channel list, on the row's own connection.
  const [actionError, setActionError] = useState('');
  const working = useRef(false);
  const clientOf = (row: RecentRow) => connections.find(c => c.slot === row.slot)?.client ?? null;
  const run = async (work: () => Promise<string | void>) => {
    if (working.current) return;
    working.current = true; setActionError('');
    try { const failure = await work(); if (failure) setActionError(failure); }
    catch { setActionError('Could not complete that action. Try again later.'); }
    finally { working.current = false; }
  };
  const renameSession = (row: RecentRow) => Alert.prompt('Rename session', undefined, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Save', onPress: (title?: string) => { const client = clientOf(row), next = title?.trim();
      if (client && next && next !== row.title) void run(async () => { await client.updateThread(row.id, threadPatch(next)); }); } },
  ], 'plain-text', row.title);
  const archiveSession = (row: RecentRow) => Alert.alert('Archive this session?', 'It will no longer be shown on any device.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Archive', style: 'destructive', onPress: () => { const client = clientOf(row); if (client) void run(async () => { await client.archiveThread(row.id); }); } },
  ]);
  const sessionActions = (row: RecentRow) => {
    const client = clientOf(row), labels = client?.supportsSessionLabels === true, todo = hasTodo(row.markers);
    return [
      ...(labels ? [{ name: 'todo', label: todo ? 'Remove todo' : 'Mark as todo', run: () => { if (client) void run(() => setThreadTodo(client, row.id, !todo)); } }] : []),
      // Alert.prompt exists only on iOS.
      ...(Platform.OS === 'ios' ? [{ name: 'rename', label: 'Rename session', run: () => renameSession(row) }] : []),
      ...(labels ? [{ name: 'labels', label: 'Edit labels', run: () => router.push(labelsRoute(row.slot, row.id)) }] : []),
      { name: 'archive', label: 'Archive session', destructive: true, run: () => archiveSession(row) },
    ];
  };
  const sessionMenu = (row: RecentRow) => { if (working.current || !clientOf(row)) return; Alert.alert(row.title, undefined, [
    ...sessionActions(row).map(action => ({ text: action.label, onPress: action.run, ...(action.destructive ? { style: 'destructive' as const } : {}) })),
    { text: 'Cancel', style: 'cancel' },
  ]); };
  if (!ready) return <Notice text="" />;
  return <SafeAreaView style={s.fill} edges={['top', 'left', 'right']}>
    <TabHeader title="Recents">
      <HeaderIcon label="New conversation" ios="square.and.pencil" android="edit_square" onPress={() => router.push('/new-thread')} />
    </TabHeader>
    {!!listError && <Text accessibilityRole="alert" style={s.error}>{listError}</Text>}
    {!!actionError && <Text accessibilityRole="alert" style={s.error}>{actionError}</Text>}
    <View style={s.searchArea}>
      <View style={s.search}>
        <SymbolView name={{ ios: 'magnifyingglass', android: 'search' }} size={15} tintColor="#7b8794" fallback={null} />
        <TextInput accessibilityLabel="Search conversations" placeholder="Search" placeholderTextColor="#9aa5b1" value={query.text}
          onChangeText={text => setQuery(old => ({ ...old, text }))} autoCorrect={false} autoCapitalize="none" returnKeyType="search" clearButtonMode="never" style={s.searchInput} />
        {searching && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8} onPress={() => setQuery(emptySessionQuery())}>
          <SymbolView name={{ ios: 'xmark.circle.fill', android: 'cancel' }} size={16} tintColor="#9aa5b1" fallback={<Text style={s.clear}>Clear</Text>} />
        </Pressable>}
      </View>
      {labels.length > 0 && <View style={s.labels} accessibilityRole="toolbar" accessibilityLabel="Quick label filter">
        {labels.map(label => { const on = query.labels.includes(label);
          return <Pressable key={label} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={on ? `Remove label ${label} from search` : `Search label ${label}`}
            hitSlop={4} onPress={() => toggle(label)} style={({ pressed }) => [s.label, on && s.labelOn, pressed && s.labelPressed]}>
            <Text numberOfLines={1} style={[s.labelText, on && s.labelTextOn]}>{label}</Text>
          </Pressable>; })}
      </View>}
    </View>
    <FlatList data={items} keyExtractor={item => item.key} extraData={revision} contentContainerStyle={[s.list, { paddingBottom: tabListBottomPadding(insets.bottom) }]}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      renderItem={({ item: entry }) => {
        if (entry.kind === 'section') return <Text accessibilityRole="header" style={s.section}>{entry.title}</Text>;
        const item = entry.row, todo = hasTodo(item.markers);
        const source = multiple ? `${item.channelName} · ${item.connectionName}` : item.channelName;
        const actions = sessionActions(item);
        return <Pressable accessibilityRole="button" onPress={() => navigation.threadOn(item.slot, item.id)} onLongPress={() => sessionMenu(item)}
          accessibilityActions={actions.map(({ name, label }) => ({ name, label }))}
          onAccessibilityAction={event => { if (!working.current) actions.find(action => action.name === event.nativeEvent.actionName)?.run(); }}
          accessibilityLabel={[item.title, source, item.running ? 'Running' : undefined, item.completedUnread ? 'Completed, unread' : undefined, todo ? 'Todo' : undefined].filter(Boolean).join(', ')}
          style={({ pressed }) => [s.card, pressed && s.pressed]}>
          <Text numberOfLines={2} style={s.heading}>{item.title}</Text>
          <View style={s.meta}>
            <Text numberOfLines={1} style={s.source}>{source}</Text>
            <MessageTime seconds={item.lastMessageAt} />
            {item.running && <View style={s.running}><View style={s.runningDot} /><Text style={s.runningText}>Running</Text></View>}
            {item.completedUnread && <View style={s.unreadDot} />}
            {todo && <TodoFlag />}
          </View>
        </Pressable>;
      }}
      ListEmptyComponent={loading ? null : <Text style={s.empty}>{searching ? 'No matching conversations' : 'Conversations you take part in during the last 72 hours appear here.'}</Text>} />
  </SafeAreaView>;
}

const s = StyleSheet.create({
  fill: { flex: 1 }, list: { paddingHorizontal: 12, paddingTop: 4 },
  section: { fontSize: 13, fontWeight: '600', color: '#65758b', marginTop: 8, marginBottom: 8, paddingHorizontal: 4 },
  searchArea: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, gap: 8 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0' },
  searchInput: { flex: 1, minWidth: 0, paddingVertical: 7, fontSize: 16, color: '#172a40' },
  clear: { color: '#607187', fontSize: 13 },
  labels: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  label: { maxWidth: '100%', borderRadius: 7, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: '#edf2f7' },
  labelOn: { backgroundColor: '#d5e1f0' }, labelPressed: { backgroundColor: '#dfe7f1' },
  labelText: { color: '#42566f', fontSize: 13, fontWeight: '500' }, labelTextOn: { color: '#23384f' },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 14, marginBottom: 8 },
  pressed: { backgroundColor: '#eef3fa' },
  heading: { fontSize: 17, fontWeight: '600', color: '#172a40' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  source: { flexShrink: 1, fontSize: 13, color: '#607187' },
  running: { flexDirection: 'row', alignItems: 'center', gap: 4 }, runningDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#238636' },
  runningText: { color: '#237a35', fontSize: 12, fontWeight: '600' }, unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4DA3FF' },
  error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10 },
  empty: { color: '#65758b', textAlign: 'center', padding: 24 },
});
