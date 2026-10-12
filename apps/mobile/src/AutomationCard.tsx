import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './FontSize';
import { automationStatus, automationTiming, scheduleLabel } from './automationText';
import { unreadCountLabel } from '../../../packages/client/src/projectDirectory';
import type { Automation } from '../../../packages/client/src/automations';

/** One job in an Automations list: name, status, schedule and the unread result count. */
export function AutomationCard({ job, connectionName, onPress }: { job: Automation; connectionName?: string; onPress: () => void }) {
  const status = automationStatus(job);
  const details = [scheduleLabel(job.schedule), automationTiming(job), connectionName].filter(Boolean).join(' · ');
  return <Pressable accessibilityRole="button"
    accessibilityLabel={[job.name, status, details, job.unreadCount ? `${job.unreadCount} unread` : undefined].filter(Boolean).join(', ')}
    onPress={onPress} style={({ pressed }) => [s.card, pressed && s.pressed]}>
    <View style={s.fill}>
      <Text numberOfLines={2} style={s.heading}>{job.name}</Text>
      <View style={s.meta}>
        <Text style={[s.status, job.running && s.running, job.failed && !job.running && s.failed]}>{status}</Text>
        <Text numberOfLines={1} style={s.details}>{details}</Text>
      </View>
    </View>
    {job.unreadCount > 0 && <View style={s.badge}><Text style={s.badgeText}>{unreadCountLabel(job.unreadCount)}</Text></View>}
  </Pressable>;
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 14, marginBottom: 8 },
  pressed: { backgroundColor: '#eef3fa' },
  heading: { fontSize: 17, fontWeight: '600', color: '#172a40' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  status: { fontSize: 13, fontWeight: '600', color: '#42566f' }, running: { color: '#237a35' }, failed: { color: '#9d1b32' },
  details: { flexShrink: 1, fontSize: 13, color: '#607187' },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a66c9' },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
