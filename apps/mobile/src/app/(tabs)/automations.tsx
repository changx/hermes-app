import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Notice, useConnections } from '../../App';
import { Text } from '../../FontSize';
import { TabHeader } from '../../TabHeader';
import { tabListBottomPadding } from '../../tabInsets';
import { automationStatus, automationTiming, scheduleLabel } from '../../automationText';
import { unreadCountLabel } from '../../../../../packages/client/src/projectDirectory';
import type { Automation } from '../../../../../packages/client/src/automations';

type Row = { key: string; slot: string; connectionName: string; job: Automation };
type Note = { key: string; connectionName: string; text: string };

/** Automations tab: scheduled jobs of every saved connection, read-only. */
export default function Automations() {
  const { ready, connections, revision } = useConnections();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<Row[]>([]), [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const focused = useRef(false), generation = useRef(0);
  const load = useCallback(async () => {
    const version = ++generation.current;
    const found: Row[] = [], missing: Note[] = [];
    await Promise.all(connections.map(async runtime => {
      const client = runtime.client;
      if (!client?.hasCapabilities) { missing.push({ key: runtime.slot, connectionName: runtime.name, text: 'Connecting…' }); return; }
      if (!client.supportsAutomations) { missing.push({ key: runtime.slot, connectionName: runtime.name, text: 'Automations are not available on this connection yet.' }); return; }
      try {
        for (const job of await client.automations())
          found.push({ key: `${runtime.slot}:${job.id}`, slot: runtime.slot, connectionName: runtime.name, job });
      } catch { missing.push({ key: runtime.slot, connectionName: runtime.name, text: 'Could not load automations. Pull down to try again.' }); }
    }));
    if (version !== generation.current) return;
    found.sort((a, b) => Number(b.job.running) - Number(a.job.running) || (b.job.lastRunAt ?? '').localeCompare(a.job.lastRunAt ?? '') || a.job.name.localeCompare(b.job.name));
    setRows(found); setNotes(missing); setLoading(false);
  }, [connections]);
  useFocusEffect(useCallback(() => { focused.current = true; void load(); return () => { focused.current = false; }; }, [load]));
  // New results change the directory; refresh counts while the tab is visible.
  useEffect(() => { if (focused.current) void load(); }, [revision, load]);
  if (!ready) return <Notice text="" />;
  const multiple = connections.length > 1;
  return <SafeAreaView style={s.fill} edges={['top', 'left', 'right']}>
    <TabHeader title="Automations" />
    <FlatList data={rows} keyExtractor={row => row.key} contentContainerStyle={[s.list, { paddingBottom: tabListBottomPadding(insets.bottom) }]}
      refreshing={false} onRefresh={() => void load()}
      renderItem={({ item }) => {
        const { job } = item, status = automationStatus(job);
        const details = [scheduleLabel(job.schedule), automationTiming(job), multiple ? item.connectionName : undefined].filter(Boolean).join(' · ');
        return <Pressable accessibilityRole="button"
          accessibilityLabel={[job.name, status, details, job.unreadCount ? `${job.unreadCount} unread` : undefined].filter(Boolean).join(', ')}
          onPress={() => router.push({ pathname: '/automations/[automationId]', params: { automationId: job.id, connection: item.slot } })}
          style={({ pressed }) => [s.card, pressed && s.pressed]}>
          <View style={s.fill}>
            <Text numberOfLines={2} style={s.heading}>{job.name}</Text>
            <View style={s.meta}>
              <Text style={[s.status, job.running && s.running, job.failed && !job.running && s.failed]}>{status}</Text>
              <Text numberOfLines={1} style={s.details}>{details}</Text>
            </View>
          </View>
          {job.unreadCount > 0 && <View style={s.badge}><Text style={s.badgeText}>{unreadCountLabel(job.unreadCount)}</Text></View>}
        </Pressable>;
      }}
      ListHeaderComponent={loading ? <ActivityIndicator style={s.spinner} /> : null}
      ListFooterComponent={notes.length ? <View style={s.notes}>{notes.map(note =>
        <Text key={note.key} style={s.note}>{multiple ? `${note.connectionName}: ${note.text}` : note.text}</Text>)}</View> : null}
      ListEmptyComponent={loading || notes.length ? null : <Text style={s.empty}>No automations yet. Ask the agent in any conversation to run something on a schedule.</Text>} />
  </SafeAreaView>;
}

const s = StyleSheet.create({
  fill: { flex: 1 }, list: { paddingHorizontal: 12, paddingTop: 12 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 14, marginBottom: 8 },
  pressed: { backgroundColor: '#eef3fa' },
  heading: { fontSize: 17, fontWeight: '600', color: '#172a40' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  status: { fontSize: 13, fontWeight: '600', color: '#42566f' }, running: { color: '#237a35' }, failed: { color: '#9d1b32' },
  details: { flexShrink: 1, fontSize: 13, color: '#607187' },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a66c9' },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  spinner: { marginVertical: 12 }, notes: { marginTop: 8, gap: 6, paddingHorizontal: 6 }, note: { fontSize: 13, color: '#607187' },
  empty: { color: '#65758b', textAlign: 'center', padding: 24 },
});
