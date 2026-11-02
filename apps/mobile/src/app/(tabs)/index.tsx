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
import { mergeFileHits, mergeMessageHits, quickLabels, recentRows, searchRecentRows, todoRows, type FileHitRow, type MessageHitRow, type RecentRow } from '../../recentRows';
import type { SessionTextHit } from '../../../../../packages/client/src/sessionText';
import { TodoFlag } from '../../TodoFlag';
import { hasTodo } from '../../../../../packages/client/src/todo';
import { addQueryLabel, emptySessionQuery, removeQueryLabel, sessionQueryActive, type SessionQuery } from '../../../../../packages/client/src/sessionSearch';
import { useSessionNavigation } from '../../sessionNavigation';
import { tabListBottomPadding } from '../../tabInsets';

const MINUTE = 60_000;
// File search asks the servers; wait for a pause in typing first.
const FILE_SEARCH_DELAY_MS = 300;
// The AI order costs a model call: ask for it only after the typing has paused.
const REFINE_DELAY_MS = 500;

type Item = { kind: 'section'; key: string; title: string } | { kind: 'row'; key: string; row: RecentRow } | { kind: 'file'; key: string; hit: FileHitRow }
  | { kind: 'message'; key: string; hit: MessageHitRow };
type Found = { slot: string; name: string; items: readonly SessionTextHit[] };
/** `ranking`: the AI order is on its way. `refined`: rows are in the AI order; `none`: the AI found no fit. */
type Messages = { state: 'idle' | 'loading' | 'ready'; found: readonly Found[]; ranking: boolean; refined: boolean; none: boolean; indexing: boolean; failed: number };
const NO_MESSAGES: Messages = { state: 'idle', found: [], ranking: false, refined: false, none: false, indexing: false, failed: 0 };
type Files = { state: 'idle' | 'loading' | 'ready'; rows: readonly FileHitRow[]; failed: number };
const NO_FILES: Files = { state: 'idle', rows: [], failed: 0 };
const fileDate = (seconds: number) => new Date(seconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * Recents tab: a Todo section (every flagged Thread, any age), then the
 * user's own Threads with activity in the last 72 hours. Both lists put
 * running Threads first, then newest activity. A search shows the matching
 * Threads by title, then Threads whose messages match (keywords and meaning at
 * once, then the AI order a few seconds later; a tap opens the best message),
 * then the matching files (delivered or sent) from every server that
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
  const [messages, setMessages] = useState<Messages>(NO_MESSAGES);
  const messageRequest = useRef(0);
  const messageSources = connections.filter(c => c.client?.supportsSessionSearch === true && c.client.connectionState === 'online');
  const messageSourceKey = messageSources.map(c => c.slot + (c.client!.supportsSessionSearchRefine ? '+ai' : '')).join('\n');
  const messageSourcesRef = useRef(messageSources); messageSourcesRef.current = messageSources;
  useEffect(() => {
    const id = ++messageRequest.current, sources = messageSourcesRef.current, text = query.text.trim();
    if (!text || !sources.length) { setMessages(NO_MESSAGES); return; }
    setMessages(old => ({ ...old, state: 'loading', ranking: false }));
    const controller = new AbortController();
    let refineTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      void Promise.allSettled(sources.map(c => c.client!.sessionText.search(text, query.labels, controller.signal)
        .then(page => ({ slot: c.slot, name: c.name, page })))).then(results => {
        if (id !== messageRequest.current) return;
        const pages = results.flatMap(r => r.status === 'fulfilled' && r.value.page.available ? [r.value] : []);
        const found = pages.map(p => ({ slot: p.slot, name: p.name, items: p.page.items }));
        const ai = sources.filter(c => c.client!.supportsSessionSearchRefine && found.some(f => f.slot === c.slot && f.items.length));
        setMessages({ state: 'ready', found, ranking: ai.length > 0, refined: false, none: false, indexing: pages.some(p => !p.page.ready), failed: results.length - pages.length });
        if (!ai.length) return;
        refineTimer = setTimeout(() => {
          void Promise.allSettled(ai.map(c => c.client!.sessionText.refine(text, query.labels, controller.signal).then(page => ({ slot: c.slot, page })))).then(refined => {
            if (id !== messageRequest.current) return;
            const done = refined.flatMap(r => r.status === 'fulfilled' && r.value.page.available ? [r.value] : []);
            // A server whose AI order failed keeps its first order.
            setMessages(old => !done.length ? { ...old, ranking: false } : { ...old, ranking: false, refined: true,
              // None: every AI answer found nothing, and no other server has rows.
              none: done.every(d => d.page.none) && old.found.every(f => !f.items.length || done.some(d => d.slot === f.slot)),
              found: old.found.map(f => { const d = done.find(x => x.slot === f.slot); return d ? { ...f, items: d.page.items } : f; }) });
          });
        }, REFINE_DELAY_MS);
      });
    }, FILE_SEARCH_DELAY_MS);
    return () => { clearTimeout(timer); clearTimeout(refineTimer); controller.abort(); };
  }, [query, messageSourceKey]);
  const items = useMemo((): Item[] => {
    const rowItem = (section: string) => (row: RecentRow): Item => ({ kind: 'row', key: `${section}:${row.key}`, row });
    if (searching) {
      const titled = searchRecentRows(connections, query), rows = titled.map(rowItem('search'));
      const found = mergeMessageHits(messages.found, new Set(titled.map(row => row.key)));
      const messageTitle = messages.ranking ? 'Messages · AI is ranking…' : messages.refined ? 'Messages · ranked by AI' : 'Messages';
      const middle: Item[] = found.length || messages.ranking ? [{ kind: 'section', key: 'section:messages', title: messageTitle }, ...found.map(hit => ({ kind: 'message' as const, key: 'message:' + hit.key, hit }))] : [];
      if (!files.rows.length) return [...rows, ...middle];
      return [...rows, ...middle, { kind: 'section', key: 'section:files', title: 'Files' }, ...files.rows.map(hit => ({ kind: 'file' as const, key: 'file:' + hit.key, hit }))];
    }
    const todos = todoRows(connections), recents = recentRows(connections, now / 1000);
    if (!todos.length) return recents.map(rowItem('recent'));
    return [{ kind: 'section', key: 'section:todo', title: 'Todo' }, ...todos.map(rowItem('todo')),
      ...(recents.length ? [{ kind: 'section' as const, key: 'section:recent', title: 'Recent' }, ...recents.map(rowItem('recent'))] : [])];
  }, [connections, revision, now, query, searching, files.rows, messages]);
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
        if (entry.kind === 'message') {
          const { hit, slot, connectionName } = entry.hit;
          const where = multiple ? `${hit.channel_name} · ${connectionName}` : hit.channel_name;
          return <Pressable accessibilityRole="button" onPress={() => navigation.threadOn(slot, hit.thread_id, hit.seq ?? undefined)}
            {...menu.rowProps({ slot, client: connections.find(c => c.slot === slot)?.client ?? null, id: hit.thread_id, title: hit.title })}
            accessibilityLabel={[hit.title, where, hit.snippet || undefined].filter(Boolean).join(', ')}
            style={({ pressed }) => [s.card, pressed && s.pressed]}>
            <Text numberOfLines={2} style={s.heading}>{hit.title}</Text>
            {!!hit.snippet && <Text numberOfLines={2} style={s.caption}>{hit.snippet}</Text>}
            <View style={s.meta}><Text numberOfLines={1} style={s.source}>{where}</Text></View>
          </Pressable>;
        }
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
      ListEmptyComponent={loading || files.state === 'loading' || messages.state === 'loading' || messages.none ? undefined : <Text style={s.empty}>{searching ? (fileSources.length ? 'No matching conversations or files' : 'No matching conversations') : 'Conversations you take part in during the last 72 hours appear here.'}</Text>}
      ListFooterComponent={searching ? <SearchNotes files={files.failed} messages={messages} /> : undefined} />
    <NewFab label="New conversation" onPress={() => router.push('/new-thread')} />
  </SafeAreaView>;
}

/** Notes under the search results; one line each. */
function SearchNotes({ files, messages }: { files: number; messages: Messages }) {
  const servers = (n: number) => n === 1 ? 'one server' : `${n} servers`;
  const notes = [messages.none ? 'AI found no message that answers this.' : '', messages.indexing ? 'Older messages are still being indexed. Some may be missing.' : '',
    messages.failed > 0 ? `Messages could not be searched on ${servers(messages.failed)}.` : '', files > 0 ? `Files could not be searched on ${servers(files)}.` : ''].filter(Boolean);
  if (!notes.length) return null;
  return <View>{notes.map(note => <Text key={note} accessibilityRole={/could not/.test(note) ? 'alert' : undefined} style={s.empty}>{note}</Text>)}</View>;
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
