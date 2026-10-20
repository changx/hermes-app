import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Notice, useConnections } from '../../App';
import { NewFab } from '../../NewFab';
import { useSessionMenu } from '../../useSessionMenu';
import { Text, TextInput } from '../../FontSize';
import { MessageTime } from '../../MessageTime';
import { TabHeader } from '../../TabHeader';
import { mergeFileHits, quickLabels, recentRows, searchRecentRows, todoRows, type FileHitRow, type RecentRow } from '../../recentRows';
import { TodoFlag } from '../../TodoFlag';
import { hasTodo } from '../../../../../packages/client/src/todo';
import { addQueryLabel, emptySessionQuery, removeQueryLabel, sessionQueryActive, type SessionQuery } from '../../../../../packages/client/src/sessionSearch';
import { useSessionNavigation } from '../../sessionNavigation';
import { tabListBottomPadding } from '../../tabInsets';

const MINUTE = 60_000;
// File search asks the servers; wait for a pause in typing first.
const FILE_SEARCH_DELAY_MS = 300;

type Item = { kind: 'section'; key: string; title: string } | { kind: 'row'; key: string; row: RecentRow } | { kind: 'file'; key: string; hit: FileHitRow };
type Files = { state: 'idle' | 'loading' | 'ready'; rows: readonly FileHitRow[]; failed: number };
const NO_FILES: Files = { state: 'idle', rows: [], failed: 0 };
const fileDate = (seconds: number) => new Date(seconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * Recents tab: a Todo section (every flagged Thread, any age), then the
 * user's own Threads with activity in the last 72 hours. Both lists put
 * running Threads first, then newest activity. A search shows the matching
 * Threads, then the matching files (delivered or sent) from every server that
 * searches files; a file opens its Thread at the message that carried it.
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
  const [files, setFiles] = useState<Files>(NO_FILES);
  const fileRequest = useRef(0);
  // Connections that can search files, as a stable key: a directory change does not search again.
  const fileSources = connections.filter(c => c.client?.supportsFileSearch === true && c.client.connectionState === 'online');
  const fileSourceKey = fileSources.map(c => c.slot).join('\n');
  const fileSourcesRef = useRef(fileSources); fileSourcesRef.current = fileSources;
  useEffect(() => {
    const id = ++fileRequest.current, sources = fileSourcesRef.current;
    if (!searching || !sources.length) { setFiles(NO_FILES); return; }
    setFiles(old => ({ ...old, state: 'loading' }));
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void Promise.allSettled(sources.map(c => c.client!.files.search(query.text, query.labels, null, controller.signal)
        .then(page => ({ slot: c.slot, name: c.name, items: page.items })))).then(results => {
        if (id !== fileRequest.current) return;
        const found = results.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
        setFiles({ state: 'ready', rows: mergeFileHits(found), failed: results.length - found.length });
      });
    }, FILE_SEARCH_DELAY_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, searching, fileSourceKey]);
  const items = useMemo((): Item[] => {
    const rowItem = (section: string) => (row: RecentRow): Item => ({ kind: 'row', key: `${section}:${row.key}`, row });
    if (searching) {
      const rows = searchRecentRows(connections, query).map(rowItem('search'));
      if (!files.rows.length) return rows;
      return [...rows, { kind: 'section', key: 'section:files', title: 'Files' }, ...files.rows.map(hit => ({ kind: 'file' as const, key: 'file:' + hit.key, hit }))];
    }
    const todos = todoRows(connections), recents = recentRows(connections, now / 1000);
    if (!todos.length) return recents.map(rowItem('recent'));
    return [{ kind: 'section', key: 'section:todo', title: 'Todo' }, ...todos.map(rowItem('todo')),
      ...(recents.length ? [{ kind: 'section' as const, key: 'section:recent', title: 'Recent' }, ...recents.map(rowItem('recent'))] : [])];
  }, [connections, revision, now, query, searching, files.rows]);
  // Selected labels stay visible (first) even when they are not among the five most used.
  const labels = useMemo(() => { const top = quickLabels(connections); return [...query.labels.filter(label => !top.includes(label)), ...top]; }, [connections, revision, query.labels]);
  const toggle = (label: string) => setQuery(old => old.labels.includes(label) ? removeQueryLabel(old, label) : addQueryLabel(old, label));
  const multiple = connections.length > 1;
  const loading = connections.some(c => c.client && !c.client.isCatalogueReady);
  // Long press: the shared Session menu, on the row's own connection.
  const menu = useSessionMenu();
  const clientOf = (row: RecentRow) => connections.find(c => c.slot === row.slot)?.client ?? null;
  if (!ready) return <Notice text="" />;
  return <SafeAreaView style={s.fill} edges={['top', 'left', 'right']}>
    <TabHeader title="Recents" />
    {!!listError && <Text accessibilityRole="alert" style={s.error}>{listError}</Text>}
    {!!menu.error && <Text accessibilityRole="alert" style={s.error}>{menu.error}</Text>}
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
        if (entry.kind === 'file') {
          const { file, slot, connectionName } = entry.hit;
          const where = [file.thread_title, file.channel_name, multiple ? connectionName : undefined].filter(Boolean).join(' · ');
          const name = file.name || 'Unnamed file';
          return <Pressable accessibilityRole="button" onPress={() => navigation.threadOn(slot, file.thread_id, file.ref_seq ?? undefined)}
            accessibilityLabel={[name, where, file.list === 'uploaded' ? 'Sent by you' : 'Delivered', file.state === 'available' ? undefined : 'No longer available'].filter(Boolean).join(', ')}
            style={({ pressed }) => [s.card, pressed && s.pressed]}>
            <View style={s.fileTitle}>
              <SymbolView name={{ ios: 'doc', android: 'description' }} size={15} tintColor="#607187" fallback={null} />
              <Text numberOfLines={2} style={[s.heading, s.fill]}>{name}</Text>
            </View>
            {!!file.caption && <Text numberOfLines={2} style={s.caption}>{file.caption}</Text>}
            <View style={s.meta}>
              <Text numberOfLines={1} style={s.source}>{where}</Text>
              <Text style={s.source}>{file.state === 'available' ? fileDate(file.created_at) : 'No longer available'}</Text>
            </View>
          </Pressable>;
        }
        const item = entry.row, todo = hasTodo(item.markers);
        const source = multiple ? `${item.channelName} · ${item.connectionName}` : item.channelName;
        return <Pressable accessibilityRole="button" onPress={() => navigation.threadOn(item.slot, item.id)}
          {...menu.rowProps({ slot: item.slot, client: clientOf(item), id: item.id, title: item.title })}
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
      ListEmptyComponent={loading || files.state === 'loading' ? null : <Text style={s.empty}>{searching ? (fileSources.length ? 'No matching conversations or files' : 'No matching conversations') : 'Conversations you take part in during the last 72 hours appear here.'}</Text>}
      ListFooterComponent={searching && files.failed > 0 ? <Text accessibilityRole="alert" style={s.empty}>Files could not be searched on {files.failed === 1 ? 'one server' : `${files.failed} servers`}.</Text> : null} />
    <NewFab label="New conversation" onPress={() => router.push('/new-thread')} />
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
  fileTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 }, caption: { fontSize: 14, color: '#42566f', marginTop: 4 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  source: { flexShrink: 1, fontSize: 13, color: '#607187' },
  running: { flexDirection: 'row', alignItems: 'center', gap: 4 }, runningDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#238636' },
  runningText: { color: '#237a35', fontSize: 12, fontWeight: '600' }, unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4DA3FF' },
  error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10 },
  empty: { color: '#65758b', textAlign: 'center', padding: 24 },
});
