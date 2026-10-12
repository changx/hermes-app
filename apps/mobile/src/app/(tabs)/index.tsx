import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HeaderIcon, Notice, useConnections } from '../../App';
import { Text } from '../../FontSize';
import { MessageTime } from '../../MessageTime';
import { TabHeader } from '../../TabHeader';
import { recentRows } from '../../recentRows';
import { useSessionNavigation } from '../../sessionNavigation';

const MINUTE = 60_000;

/** Recents tab: the user's own Threads with activity in the last 24 hours, newest first. */
export default function Recents() {
  const { ready, connections, revision, listError } = useConnections();
  const navigation = useSessionNavigation();
  const router = useRouter();
  // The 24-hour window moves with time, not only with directory changes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), MINUTE); return () => clearInterval(timer); }, []);
  const rows = useMemo(() => recentRows(connections, now / 1000), [connections, revision, now]);
  const multiple = connections.length > 1;
  const loading = connections.some(c => c.client && !c.client.isCatalogueReady);
  if (!ready) return <Notice text="" />;
  return <SafeAreaView style={s.fill} edges={['top', 'left', 'right']}>
    <TabHeader title="Recents">
      <HeaderIcon label="New conversation" ios="square.and.pencil" android="edit_square" onPress={() => router.push('/new-thread')} />
    </TabHeader>
    {!!listError && <Text accessibilityRole="alert" style={s.error}>{listError}</Text>}
    <FlatList data={rows} keyExtractor={row => row.key} extraData={revision} contentContainerStyle={s.list}
      renderItem={({ item }) => {
        const source = multiple ? `${item.channelName} · ${item.connectionName}` : item.channelName;
        return <Pressable accessibilityRole="button" onPress={() => navigation.threadOn(item.slot, item.id)}
          accessibilityLabel={[item.title, source, item.running ? 'Running' : undefined, item.completedUnread ? 'Completed, unread' : undefined].filter(Boolean).join(', ')}
          style={({ pressed }) => [s.card, pressed && s.pressed]}>
          <Text numberOfLines={2} style={s.heading}>{item.title}</Text>
          <View style={s.meta}>
            <Text numberOfLines={1} style={s.source}>{source}</Text>
            <MessageTime seconds={item.lastMessageAt} />
            {item.running && <View style={s.running}><View style={s.runningDot} /><Text style={s.runningText}>Running</Text></View>}
            {item.completedUnread && <View style={s.unreadDot} />}
          </View>
        </Pressable>;
      }}
      ListEmptyComponent={loading ? null : <Text style={s.empty}>Conversations you take part in during the last 24 hours appear here.</Text>} />
  </SafeAreaView>;
}

const s = StyleSheet.create({
  fill: { flex: 1 }, list: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 24 },
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
