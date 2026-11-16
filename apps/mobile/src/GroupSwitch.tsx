import React, { useState } from 'react';
import { ActionSheetIOS, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { useConnections, type ConnectionRuntime } from './connections';
import { Text } from './FontSize';
import { activeGroupName, groupChoices, otherGroupUnread } from '../../../packages/client/src/connectionGroups';

/** Connections with a completed result that is not read yet. */
export function unreadSlots(connections: readonly ConnectionRuntime[]): Set<string> {
  return new Set(connections.filter(runtime => runtime.client && [...runtime.client.threads.values()]
    .some(thread => thread.completed_unread && !thread.archived)).map(runtime => runtime.slot));
}

/**
 * Connection group switcher of the tab headers (docs/connection-groups.md). Shown only when
 * this device has groups. The tabs list only the active group's connections. A dot marks
 * an unread result in another group.
 */
export function GroupSwitch() {
  const { groups, groupsError, connections, setActiveGroup, revision } = useConnections();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  void revision;  // unread marks follow directory changes
  if (!groups.groups.length || groupsError) return null;
  const unread = unreadSlots(connections), choices = groupChoices(groups, unread);
  const name = activeGroupName(groups), dot = otherGroupUnread(groups, unread);
  const choose = (id: string | null) => { setOpen(false); void setActiveGroup(id).catch(() => {}); };
  const edit = () => { setOpen(false); router.push('/settings/groups'); };
  const show = () => {
    if (Platform.OS !== 'ios') { setOpen(true); return; }
    const labels = choices.map(choice => `${choice.active ? '✓ ' : ''}${choice.name}${choice.unread ? ' •' : ''}`);
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Show group', options: [...labels, 'Edit Groups…', 'Cancel'], cancelButtonIndex: labels.length + 1 }, index => {
      if (index < labels.length) choose(choices[index].id); else if (index === labels.length) edit();
    });
  };
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`Group: ${name}${dot ? ', another group has unread results' : ''}`} hitSlop={6} onPress={show}
      style={({ pressed }) => [s.pill, pressed && s.pressed]}>
      <Text numberOfLines={1} style={s.name}>{name}</Text>
      <SymbolView name={{ ios: 'chevron.down', android: 'expand_more' }} size={12} tintColor="#2b4e81" weight="semibold" fallback={<Text style={s.name}>▾</Text>} />
      {dot && <View style={s.dot} />}
    </Pressable>
    {Platform.OS !== 'ios' && <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
      <Pressable style={s.backdrop} accessibilityLabel="Close" onPress={() => setOpen(false)}>
        <View style={s.sheet}>
          <Text style={s.title}>Show group</Text>
          {choices.map(choice => <Pressable key={choice.id ?? 'all'} accessibilityRole="radio" accessibilityState={{ checked: choice.active }} onPress={() => choose(choice.id)} style={s.row}>
            <Text style={[s.rowText, choice.active && s.active]}>{choice.name}</Text>{choice.unread && <View style={s.dot} />}
          </Pressable>)}
          <Pressable accessibilityRole="button" onPress={edit} style={s.row}><Text style={s.rowText}>Edit Groups…</Text></Pressable>
        </View>
      </Pressable>
    </Modal>}
  </>;
}

const s = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 150, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: '#eaf0f7' },
  pressed: { opacity: 0.6 },
  name: { flexShrink: 1, fontSize: 15, fontWeight: '600', color: '#2b4e81' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4DA3FF' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: { backgroundColor: '#fff', paddingBottom: 24, borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  title: { padding: 16, fontSize: 13, color: '#607187' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#e2e8f0' },
  rowText: { fontSize: 17, color: '#14283e' },
  active: { fontWeight: '700' },
});
