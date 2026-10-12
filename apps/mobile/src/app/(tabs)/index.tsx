import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { HeaderIcon, Notice, useConnections } from '../../App';
import { Text, TextInput } from '../../FontSize';
import { MessageTime } from '../../MessageTime';
import { TabHeader } from '../../TabHeader';
import { quickLabels, recentRows, searchRecentRows } from '../../recentRows';
import { LabelPills } from '../../SessionLabels';
import { addQueryLabel, emptySessionQuery, removeQueryLabel, sessionQueryActive, type SessionQuery } from '../../../../../packages/client/src/sessionSearch';
import { useSessionNavigation } from '../../sessionNavigation';
import { tabListBottomPadding } from '../../tabInsets';

const MINUTE = 60_000;

/** Recents tab: the user's own Threads with activity in the last 24 hours, newest first. */
export default function Recents() {
  const { ready, connections, revision, listError } = useConnections();
  const navigation = useSessionNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // The 24-hour window moves with time, not only with directory changes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), MINUTE); return () => clearInterval(timer); }, []);
  const [query, setQuery] = useState<SessionQuery>(emptySessionQuery);
  const searching = sessionQueryActive(query);
  const rows = useMemo(() => searching ? searchRecentRows(connections, query) : recentRows(connections, now / 1000), [connections, revision, now, query, searching]);
  // Selected labels stay visible (first) even when they are not among the five most used.
  const labels = useMemo(() => { const top = quickLabels(connections); return [...query.labels.filter(label => !top.includes(label)), ...top]; }, [connections, revision, query.labels]);
  const toggle = (label: string) => setQuery(old => old.labels.includes(label) ? removeQueryLabel(old, label) : addQueryLabel(old, label));
  const multiple = connections.length > 1;
  const loading = connections.some(c => c.client && !c.client.isCatalogueReady);
  if (!ready) return <Notice text="" />;
  return <SafeAreaView style={s.fill} edges={['top', 'left', 'right']}>
    <TabHeader title="Recents">
      <HeaderIcon label="New conversation" ios="square.and.pencil" android="edit_square" onPress={() => router.push('/new-thread')} />
    </TabHeader>
    {!!listError && <Text accessibilityRole="alert" style={s.error}>{listError}</Text>}
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
    <FlatList data={rows} keyExtractor={row => row.key} extraData={revision} contentContainerStyle={[s.list, { paddingBottom: tabListBottomPadding(insets.bottom) }]}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      renderItem={({ item }) => {
        const source = multiple ? `${item.channelName} · ${item.connectionName}` : item.channelName;
        return <Pressable accessibilityRole="button" onPress={() => navigation.threadOn(item.slot, item.id)}
          accessibilityLabel={[item.title, source, item.running ? 'Running' : undefined, item.completedUnread ? 'Completed, unread' : undefined].filter(Boolean).join(', ')}
          style={({ pressed }) => [s.card, pressed && s.pressed]}>
          <Text numberOfLines={2} style={s.heading}>{item.title}</Text>
          {item.markers.length > 0 && <LabelPills markers={item.markers} />}
          <View style={s.meta}>
            <Text numberOfLines={1} style={s.source}>{source}</Text>
            <MessageTime seconds={item.lastMessageAt} />
            {item.running && <View style={s.running}><View style={s.runningDot} /><Text style={s.runningText}>Running</Text></View>}
            {item.completedUnread && <View style={s.unreadDot} />}
          </View>
        </Pressable>;
      }}
      ListEmptyComponent={loading ? null : <Text style={s.empty}>{searching ? 'No matching conversations' : 'Conversations you take part in during the last 24 hours appear here.'}</Text>} />
  </SafeAreaView>;
}

const s = StyleSheet.create({
  fill: { flex: 1 }, list: { paddingHorizontal: 12, paddingTop: 4 },
  searchArea: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, gap: 8 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#eef1f5' },
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
