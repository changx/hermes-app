import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, TextInput } from './FontSize';
import { threadModelKey, threadModelOptions, type AgentModelSettings, type ThreadModelChoice } from '../../../packages/client/src/index';

/** Model list for one new conversation. The parent loads `settings` from the Channel's own connection. */
export function ThreadModelPicker({ visible, settings, failed, selected, onClose, onPick, onRetry }: {
  visible: boolean; settings: AgentModelSettings | null; failed: boolean; selected: ThreadModelChoice | null;
  onClose: () => void; onPick: (choice: ThreadModelChoice | null) => void; onRetry: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const rows = useMemo(() => settings ? threadModelOptions(settings, query) : [], [settings, query]);
  const current = threadModelKey(selected);
  const close = () => { setQuery(''); onClose(); };
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
    <View style={[s.sheet, { paddingBottom: insets.bottom }]}>
      <View style={s.header}>
        <Text accessibilityRole="header" style={s.title}>Choose a model</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel" hitSlop={8} onPress={close}><Text style={s.action}>Cancel</Text></Pressable>
      </View>
      <Text style={s.hint}>Applies to this conversation only.</Text>
      {!settings && !failed && <Text accessibilityLiveRegion="polite" style={s.hint}>Loading models…</Text>}
      {!settings && failed && <View style={s.list}>
        <Text accessibilityRole="alert" style={s.error}>Could not load the models. The conversation can still use the default model.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Try again" onPress={onRetry} style={({ pressed }) => [s.option, pressed && s.pressed]}>
          <Text style={s.action}>Try again</Text>
        </Pressable>
      </View>}
      {!!settings && <>
        {settings.providers.reduce((n, p) => n + p.models.length, 0) > 12 &&
          <TextInput accessibilityLabel="Search models" placeholder="Search models" value={query} onChangeText={setQuery}
            autoCapitalize="none" autoCorrect={false} placeholderTextColor="#8e8e93" style={s.search} />}
        <FlatList data={rows} keyExtractor={row => row.key} contentContainerStyle={s.list} keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityState={{ selected: item.key === current }}
            accessibilityLabel={`${item.label}, ${item.detail}`} onPress={() => { setQuery(''); onPick(item.choice); }}
            style={({ pressed }) => [s.option, item.key === current && s.selected, pressed && s.pressed]}>
            <View style={s.fill}>
              <Text numberOfLines={1} style={s.value}>{item.label}</Text>
              <Text numberOfLines={1} style={s.detail}>{item.detail}</Text>
            </View>
            {item.key === current && <Text style={s.check}>✓</Text>}
          </Pressable>}
          ListEmptyComponent={<Text style={s.hint}>No matching models.</Text>} />
      </>}
    </View>
  </Modal>;
}

/** Quiet pill above the first-message field. */
export function ThreadModelButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return <View style={s.row}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Model: ${label}`} accessibilityHint="Choose the model for this conversation"
      accessibilityState={{ disabled }} disabled={disabled} hitSlop={8} onPress={onPress}
      style={({ pressed }) => [s.pill, pressed && s.pressed, disabled && s.disabled]}>
      <Text numberOfLines={1} style={s.pillText}>{label}</Text>
    </Pressable>
  </View>;
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  sheet: { flex: 1, backgroundColor: '#f8fafc' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  title: { fontSize: 17, fontWeight: '700', color: '#14283e' },
  action: { fontSize: 15, fontWeight: '600', color: '#2b4e81' },
  hint: { fontSize: 13, color: '#607187', paddingHorizontal: 16, paddingTop: 10 },
  error: { color: '#9d1b32', marginBottom: 8 },
  search: { fontSize: 16, minHeight: 40, marginHorizontal: 12, marginTop: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 10, color: '#172a40', backgroundColor: '#fff' },
  list: { padding: 12 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 8 },
  selected: { borderColor: '#2960ad' },
  value: { fontSize: 16, fontWeight: '600', color: '#172a40' },
  detail: { fontSize: 13, color: '#607187', marginTop: 2 },
  check: { fontSize: 17, fontWeight: '700', color: '#2960ad' },
  pressed: { backgroundColor: '#eef3fa' }, disabled: { opacity: 0.5 },
  row: { flexDirection: 'row', paddingHorizontal: 14, paddingTop: 8 },
  pill: { maxWidth: '100%', minHeight: 28, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: '#d9dee5' },
  pillText: { fontSize: 13, color: '#44546a' },
});
