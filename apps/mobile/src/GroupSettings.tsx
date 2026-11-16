import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { Text, TextInput } from './FontSize';
import { SettingsPage, SettingsRow, SettingsSection, SettingsBlock } from './SettingsUI';
import { useConnections } from './connections';
import { GROUP_NAME_MAX, MAX_GROUPS, groupOf } from '../../../packages/client/src/connectionGroups';

/** Route of one group's page. */
export const groupSettingsRoute = (group: string) => ({ pathname: '/settings/group' as const, params: { group } });

/** Messages from the shared rules (connectionGroups.ts) are written for the user; others are replaced. */
const userMessage = (failure: unknown, fallback: string): string => {
  const reason = failure instanceof Error ? failure.message : '';
  return /^(Enter a group name|A group with this name|This version supports|Name )/.test(reason) ? reason : fallback;
};
const count = (n: number) => n === 1 ? '1 connection' : `${n} connections`;

/**
 * Settings > Groups (docs/connection-groups.md): the groups of this device, then a field
 * that adds one. A group opens its own page: name, connections and deletion.
 */
export function GroupsPage() {
  const router = useRouter();
  const { groups, groupsError, addGroup } = useConnections();
  const [name, setName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const full = groups.groups.length >= MAX_GROUPS, blocked = busy || groupsError || full || !name.trim();
  const add = async () => {
    if (blocked) return;
    setBusy(true); setError('');
    try { await addGroup(name); setName(''); }
    catch (failure) { setError(userMessage(failure, 'Could not add the group. Nothing changed. Try again.')); }
    finally { setBusy(false); }
  };
  const size = (id: string) => Object.values(groups.members).filter(group => group === id).length;
  return <SettingsPage>
    {groupsError && <Text accessibilityRole="alert" style={s.error}>Saved groups could not be read. Hermes shows every connection. Reopen Hermes to try again.</Text>}
    <SettingsSection title="Groups" footer="Groups keep connections apart, for example Work and Home. The tabs show one group at a time; All shows every connection. Every connection stays connected. Groups apply only on this device.">
      {groups.groups.map((group, index) => <SettingsRow key={group.id} first={index === 0} title={group.name} value={count(size(group.id))}
        onPress={() => router.push(groupSettingsRoute(group.id))} />)}
      <SettingsBlock first={!groups.groups.length}>
        <View style={s.addRow}>
          <TextInput accessibilityLabel="New group name" value={name} placeholder={full ? `Limit of ${MAX_GROUPS} groups reached` : 'New group, for example Work'}
            maxLength={GROUP_NAME_MAX * 2} autoCorrect={false} editable={!busy && !groupsError && !full} returnKeyType="done" onSubmitEditing={() => void add()}
            style={s.input} onChangeText={value => { setError(''); setName(value); }} />
          <Pressable accessibilityRole="button" accessibilityLabel="Add group" accessibilityState={{ disabled: blocked }} disabled={blocked}
            onPress={() => void add()} style={[s.button, blocked && s.disabled]}><Text style={s.buttonText}>Add</Text></Pressable>
        </View>
        {!!error && <Text accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
      </SettingsBlock>
    </SettingsSection>
  </SettingsPage>;
}

/** Settings > Groups > one group: its name, which connections it contains, and Delete. */
export function GroupPage({ id }: { id: string }) {
  const router = useRouter();
  const { groups, groupsError, connections, renameGroup, removeGroup, assignGroup } = useConnections();
  const group = groups.groups.find(item => item.id === id);
  const [draft, setDraft] = useState(group?.name ?? ''), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const edited = useRef(false);
  useEffect(() => { if (group && !edited.current) setDraft(group.name); }, [group?.name]);
  if (!group) return <SettingsPage><Text style={s.hint}>This group was deleted.</Text></SettingsPage>;
  const run = async (work: () => Promise<void>, done: string, fallback: string) => {
    if (busy) return;
    setBusy(true); setMessage(null);
    try { await work(); setMessage({ error: false, text: done }); }
    catch (failure) { setMessage({ error: true, text: userMessage(failure, fallback) }); }
    finally { setBusy(false); }
  };
  const unchanged = draft.trim() === group.name, blocked = busy || groupsError;
  const rename = () => { if (!unchanged && draft.trim()) void run(async () => { await renameGroup(id, draft); edited.current = false; }, 'Saved.', 'Could not rename the group. Nothing changed. Try again.'); };
  const toggle = (slot: string, member: boolean) => void run(() => assignGroup(slot, member ? null : id), 'Saved.', 'Could not change the group. Nothing changed. Try again.');
  const remove = () => Alert.alert(`Delete ${group.name}?`, 'Its connections stay saved and connected. They then show only in All.', [
    { text: 'Keep group', style: 'cancel' },
    { text: 'Delete group', style: 'destructive', onPress: () => { removeGroup(id).then(() => router.back(), () => Alert.alert('Could not delete the group.', 'Nothing changed. Try again.')); } },
  ]);
  return <SettingsPage>
    <SettingsSection title="Name">
      <SettingsBlock first>
        <TextInput accessibilityLabel="Group name" value={draft} maxLength={GROUP_NAME_MAX * 2} autoCorrect={false} editable={!blocked} returnKeyType="done"
          onSubmitEditing={rename} style={s.input} onChangeText={value => { edited.current = true; setMessage(null); setDraft(value); }} />
        <Pressable accessibilityRole="button" accessibilityLabel="Save group name" accessibilityState={{ disabled: blocked || unchanged || !draft.trim() }}
          disabled={blocked || unchanged || !draft.trim()} onPress={rename} style={[s.button, (blocked || unchanged || !draft.trim()) && s.disabled]}>
          <Text style={s.buttonText}>Save name</Text></Pressable>
      </SettingsBlock>
    </SettingsSection>
    <SettingsSection title="Connections" footer="A connection belongs to one group. Choosing a connection of another group moves it here.">
      {connections.map((row, index) => {
        const other = groupOf(groups, row.slot), member = other?.id === id;
        return <Pressable key={row.slot} accessibilityRole="checkbox" accessibilityState={{ checked: member, disabled: blocked }} disabled={blocked}
          accessibilityLabel={`${row.name}${other && !member ? `, in ${other.name}` : ''}`} onPress={() => toggle(row.slot, member)}
          style={({ pressed }) => [s.row, index > 0 && s.divider, pressed && s.pressed]}>
          <View style={s.rowText}>
            <Text numberOfLines={1} style={s.rowTitle}>{row.name}</Text>
            {other && !member && <Text numberOfLines={1} style={s.hint}>In {other.name}</Text>}
          </View>
          {member && <SymbolView name={{ ios: 'checkmark', android: 'check' }} size={16} tintColor="#2960ad" weight="semibold" fallback={<Text style={s.check}>✓</Text>} />}
        </Pressable>;
      })}
    </SettingsSection>
    {message && <Text accessibilityLiveRegion="polite" style={message.error ? s.error : s.hint}>{message.text}</Text>}
    <SettingsSection>
      <Pressable accessibilityRole="button" accessibilityLabel={`Delete group ${group.name}`} disabled={blocked} onPress={remove}
        style={({ pressed }) => [s.danger, pressed && s.dangerPressed]}><Text style={s.dangerText}>Delete group</Text></Pressable>
    </SettingsSection>
  </SettingsPage>;
}

const s = StyleSheet.create({
  addRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 10, minHeight: 44, padding: 12, color: '#172a40' },
  button: { backgroundColor: '#2960ad', borderRadius: 9, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', minHeight: 44, justifyContent: 'center', marginTop: 8 },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600' },
  hint: { fontSize: 13, lineHeight: 19, color: '#607187' },
  error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10, borderRadius: 8, marginTop: 8 },
  row: { minHeight: 52, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff' },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#d5dde8' },
  pressed: { backgroundColor: '#eef3fa' },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 16, color: '#172a40' },
  check: { fontSize: 16, color: '#2960ad' },
  danger: { minHeight: 50, borderRadius: 12, backgroundColor: '#fff', borderWidth: StyleSheet.hairlineWidth, borderColor: '#d5dde8', alignItems: 'center', justifyContent: 'center' },
  dangerPressed: { backgroundColor: '#fff0f2' },
  dangerText: { fontSize: 16, color: '#b42335', fontWeight: '600' },
});
