import React, { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './FontSize';
import { unreadCountDescription, unreadCountLabel } from '../../../packages/client/src/projectDirectory';
import type { ConnectionRuntime } from './connections';
import { projectRows } from './projectRows';
import { tabListBottomPadding } from './tabInsets';
import { NewFab } from './NewFab';

export function ProjectList({ connections, revision, onProject, onNewChannel, onConnections }: {
  connections: readonly ConnectionRuntime[]; revision: number;
  onProject: (slot: string, id: string) => void; onNewChannel: () => void; onConnections: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { rows, pending } = useMemo(() => projectRows(connections), [connections, revision]);
  return <View style={s.fill}>
    <FlatList keyboardShouldPersistTaps="handled" data={rows} keyExtractor={row => row.key} extraData={revision}
      contentContainerStyle={[s.list, { paddingBottom: tabListBottomPadding(insets.bottom) }]}
      renderItem={({ item }) => {
        // Every row names its connection, also with one saved connection.
        const source = [item.connectionName, item.issue].filter(Boolean).join(' · ');
        return <Pressable accessibilityRole="button" onPress={() => onProject(item.slot, item.id)} style={({ pressed }) => [s.card, pressed && s.pressed]}
          accessibilityLabel={[item.name, item.connectionName, item.issue, unreadCountDescription(item.unread)].filter(Boolean).join(', ')}>
          <View style={s.fill}>
            <Text numberOfLines={1} style={s.heading}>{item.name}</Text>
            {!!source && <Text numberOfLines={1} style={[s.source, item.issue && s.issue]}>{source}</Text>}
          </View>
          {item.unread > 0 && <View style={s.badge}><Text style={s.badgeText}>{unreadCountLabel(item.unread)}</Text></View>}
        </Pressable>;
      }}
      ListFooterComponent={pending.length ? <View style={s.pending}>{pending.map(row =>
        <Pressable key={row.key} accessibilityRole="button" accessibilityLabel={`${row.connectionName}, ${row.text}. Open connections.`} onPress={onConnections} style={s.pendingRow}>
          <Text numberOfLines={1} style={s.pendingName}>{row.connectionName}</Text><Text numberOfLines={1} style={s.pendingText}>{row.text}</Text>
        </Pressable>)}</View> : null}
      ListEmptyComponent={pending.length ? null : <Text style={s.empty}>Create a channel to keep related topics together.</Text>} />
    <NewFab label="New channel" onPress={onNewChannel} />
  </View>;
}

const s = StyleSheet.create({
  fill: { flex: 1 }, list: { paddingHorizontal: 12, paddingTop: 12 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8, minHeight: 56 },
  pressed: { backgroundColor: '#eef3fa' },
  heading: { fontSize: 17, fontWeight: '600', color: '#172a40' },
  source: { fontSize: 13, color: '#607187', marginTop: 2 }, issue: { color: '#8a5300' },
  // Darker than the session dot so white digits stay readable.
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a66c9' },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  pending: { marginTop: 8, gap: 4 }, pendingRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6 },
  pendingName: { fontSize: 14, fontWeight: '600', color: '#42566f', flexShrink: 1 }, pendingText: { fontSize: 13, color: '#607187', flexShrink: 1 },
  empty: { color: '#65758b', textAlign: 'center', padding: 24 },
});
