import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConnectionScope, Notice, routeConnection, useApp } from '../../../App';
import { Text } from '../../../FontSize';
import { AutomationCard } from '../../../AutomationCard';
import { loadAutomationRows, mergeAutomationRows, type AutomationLoad, type AutomationRow } from '../../../automationRows';
import { routeId } from '../../../routeId';

/** The automations that deliver to one channel, and a New automation entry for it. */
function Page({ id }: { id: string }) {
  const { client, slot, name } = useApp();
  const router = useRouter();
  const [rows, setRows] = useState<AutomationRow[]>([]), [notes, setNotes] = useState<AutomationLoad['notes']>([]);
  const [cursors, setCursors] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true), [more, setMore] = useState(false);
  const generation = useRef(0);
  const source = useCallback(() => [{ slot, name, client }], [slot, name, client]);
  const load = useCallback(async () => {
    const version = ++generation.current;
    const result = await loadAutomationRows(source(), { channel: id });
    if (version !== generation.current) return;
    setRows(result.rows); setCursors(result.cursors); setNotes(result.notes); setLoading(false);
  }, [source, id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const loadMore = async () => {
    if (more || loading || !cursors.size) return;
    const version = generation.current;
    setMore(true);
    try {
      const result = await loadAutomationRows(source(), { cursors, channel: id });
      if (version !== generation.current) return;
      setRows(old => mergeAutomationRows(old, result.rows)); setCursors(result.cursors);
    } finally { setMore(false); }
  };
  if (!client) return <Notice text="" />;
  if (!client.supportsAutomations) return <Notice text="Automations are not available on this connection yet." />;
  const channelName = client.channels.get(id)?.name ?? 'this channel';
  return <FlatList data={rows} keyExtractor={row => row.key} contentContainerStyle={s.list}
    refreshing={false} onRefresh={() => void load()} onEndReachedThreshold={0.5} onEndReached={() => void loadMore()}
    ListHeaderComponent={<View style={s.header}>
      {client.supportsAutomationEditors && <Pressable accessibilityRole="button" style={({ pressed }) => [s.create, pressed && s.pressed]}
        onPress={() => router.push({ pathname: '/new-thread', params: { automation: '1', channel: id, connection: slot } })}>
        <Text style={s.createText}>New automation</Text>
        <Text style={s.createHint}>Describe what should run and when. Results go to {channelName}.</Text>
      </Pressable>}
      {loading && <ActivityIndicator style={s.spinner} />}
    </View>}
    renderItem={({ item }) => <AutomationCard job={item.job}
      onPress={() => router.push({ pathname: '/automations/[automationId]', params: { automationId: item.job.id, connection: item.slot } })} />}
    ListFooterComponent={<>
      {more && <ActivityIndicator style={s.spinner} />}
      {notes.map(note => <Text key={note.key} style={s.note}>{note.text}</Text>)}
    </>}
    ListEmptyComponent={loading || notes.length ? null : <Text style={s.empty}>No automations deliver to {channelName} yet.</Text>} />;
}

export default function ChannelAutomations() {
  const { channelId: rawId, connection } = useLocalSearchParams<{ channelId: string; connection?: string | string[] }>();
  const id = routeId(rawId), slot = routeConnection(connection);
  if (!id || !slot) return <Notice text="This channel is unavailable." />;
  return <SafeAreaView style={s.fill} edges={['bottom', 'left', 'right']}>
    <ConnectionScope slot={slot} fallback={<Notice text="This channel is unavailable." />}><Page id={id} /></ConnectionScope>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  fill: { flex: 1 }, list: { paddingHorizontal: 12, paddingBottom: 24 }, header: { paddingTop: 12 },
  create: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#bcd0ea', borderRadius: 12, padding: 14, marginBottom: 12, gap: 4 },
  pressed: { backgroundColor: '#eef3fa' },
  createText: { fontSize: 16, fontWeight: '700', color: '#2b4e81' }, createHint: { fontSize: 13, color: '#607187' },
  spinner: { marginVertical: 12 }, note: { fontSize: 13, color: '#607187', paddingHorizontal: 6, marginTop: 8 },
  empty: { color: '#65758b', textAlign: 'center', padding: 24 },
});
