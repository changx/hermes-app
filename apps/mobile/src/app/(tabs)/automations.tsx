import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { HeaderIcon, Notice, useConnections } from '../../App';
import { Text } from '../../FontSize';
import { TabHeader } from '../../TabHeader';
import { tabListBottomPadding } from '../../tabInsets';
import { AutomationCard } from '../../AutomationCard';
import { loadAutomationRows, mergeAutomationRows, type AutomationLoad, type AutomationRow } from '../../automationRows';

/** Automations tab: scheduled jobs of every saved connection; scrolling to the end loads more. */
export default function Automations() {
  const { ready, connections, revision } = useConnections();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<AutomationRow[]>([]), [notes, setNotes] = useState<AutomationLoad['notes']>([]);
  const [cursors, setCursors] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true), [more, setMore] = useState(false);
  const focused = useRef(false), generation = useRef(0);
  const sources = useCallback(() => connections.map(runtime => ({ slot: runtime.slot, name: runtime.name, client: runtime.client })), [connections]);
  const load = useCallback(async () => {
    const version = ++generation.current;
    const result = await loadAutomationRows(sources());
    if (version !== generation.current) return;
    setRows(result.rows); setCursors(result.cursors); setNotes(result.notes); setLoading(false);
  }, [sources]);
  const loadMore = async () => {
    if (more || loading || !cursors.size) return;
    const version = generation.current;
    setMore(true);
    try {
      const result = await loadAutomationRows(sources(), { cursors });
      if (version !== generation.current) return;  // a full reload replaced the list
      setRows(old => mergeAutomationRows(old, result.rows)); setCursors(result.cursors);
      if (result.notes.length) setNotes(result.notes);
    } finally { setMore(false); }
  };
  useFocusEffect(useCallback(() => { focused.current = true; void load(); return () => { focused.current = false; }; }, [load]));
  // New results change the directory; refresh counts while the tab is visible.
  useEffect(() => { if (focused.current) void load(); }, [revision, load]);
  if (!ready) return <Notice text="" />;
  const multiple = connections.length > 1;
  const canCreate = connections.some(runtime => runtime.client?.supportsAutomationEditors);
  return <SafeAreaView style={s.fill} edges={['top', 'left', 'right']}>
    <TabHeader title="Automations">
      {canCreate && <HeaderIcon label="New automation" ios="plus" android="add" onPress={() => router.push({ pathname: '/new-thread', params: { automation: '1' } })} />}
    </TabHeader>
    <FlatList data={rows} keyExtractor={row => row.key} contentContainerStyle={[s.list, { paddingBottom: tabListBottomPadding(insets.bottom) }]}
      refreshing={false} onRefresh={() => void load()} onEndReachedThreshold={0.5} onEndReached={() => void loadMore()}
      renderItem={({ item }) => <AutomationCard job={item.job} connectionName={multiple ? item.connectionName : undefined}
        onPress={() => router.push({ pathname: '/automations/[automationId]', params: { automationId: item.job.id, connection: item.slot } })} />}
      ListHeaderComponent={loading ? <ActivityIndicator style={s.spinner} /> : null}
      ListFooterComponent={<>
        {more && <ActivityIndicator style={s.spinner} />}
        {notes.length > 0 && <View style={s.notes}>{notes.map(note =>
          <Text key={note.key} style={s.note}>{multiple ? `${note.connectionName}: ${note.text}` : note.text}</Text>)}</View>}
      </>}
      ListEmptyComponent={loading || notes.length ? null : <Text style={s.empty}>{canCreate
        ? 'No automations yet. Tap + to describe something that should run on a schedule.'
        : 'No automations yet. Ask the agent in any conversation to run something on a schedule.'}</Text>} />
  </SafeAreaView>;
}

const s = StyleSheet.create({
  fill: { flex: 1 }, list: { paddingHorizontal: 12, paddingTop: 12 },
  spinner: { marginVertical: 12 }, notes: { marginTop: 8, gap: 6, paddingHorizontal: 6 }, note: { fontSize: 13, color: '#607187' },
  empty: { color: '#65758b', textAlign: 'center', padding: 24 },
});
