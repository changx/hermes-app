import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, TextInput } from './FontSize';
import { emptyLabelFilter, labelCandidates, labelFilterActive, labelPillLayout, validateLabels, type LabelFilter } from '../../../packages/client/src/sessionLabels';
import type { LiveSessionClient } from '../../../packages/client/src/liveClient';
import type { ThreadSummary } from '../../../packages/client/src/index';
import { SymbolView } from 'expo-symbols';

function Button({ label, text, onPress, disabled = false }: { label: string; text?: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={[s.button, disabled && s.disabled]}><Text style={s.buttonText}>{text ?? label}</Text></Pressable>;
}

export function LabelPills({ markers = [] }: { markers?: readonly string[] }) {
  const [width, setWidth] = useState(0), [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const keys = markers.flatMap((label, i) => ['label:' + label, 'more:' + (i + 1)]);
  const recordLayout = (key: string, layout: { width: number; height: number }) => setMeasured(old => old[key]?.width === layout.width && old[key]?.height === layout.height ? old : { ...Object.fromEntries(Object.entries(old).filter(([key]) => keys.includes(key))), [key]: { width: layout.width, height: layout.height } });
  const natural = markers.map(label => measured['label:' + label]?.width ?? Infinity);
  const overflow = [0, ...markers.map((_, i) => measured['more:' + (i + 1)]?.width ?? Infinity)];
  const height = Math.max(24, ...keys.map(key => measured[key]?.height ?? 0));
  const layout = labelPillLayout(width, natural, overflow);
  if (!markers.length) return null;
  return <View pointerEvents="none" accessible accessibilityLabel={`Labels: ${markers.join(', ')}`} onLayout={event => setWidth(event.nativeEvent.layout.width)} style={[s.pills, { height }]}>
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.measure}>
      {markers.map(label => <Text key={label} style={s.pill} onLayout={event => recordLayout('label:' + label, event.nativeEvent.layout)}>{label}</Text>)}
      {markers.map((_, i) => <Text key={i} style={s.pill} onLayout={event => recordLayout('more:' + (i + 1), event.nativeEvent.layout)}>+{i + 1}</Text>)}
    </View>
    <View style={s.pillsVisible} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {layout.widths.map((size, i) => <Text key={markers[i]} numberOfLines={1} ellipsizeMode="tail" style={[s.pill, { width: size }]}>{markers[i]}</Text>)}
      {layout.hidden > 0 && <Text numberOfLines={1} style={s.pill}>+{layout.hidden}</Text>}
    </View>
  </View>;
}

export function LabelsFilter({ rows, value, onChange }: { rows: readonly ThreadSummary[]; value: LabelFilter; onChange: (filter: LabelFilter) => void }) {
  const [open, setOpen] = useState(false), [search, setSearch] = useState('');
  const insets = useSafeAreaInsets();
  const candidates = labelCandidates(rows).filter(label => label.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const count = value.labels.length + Number(value.noLabels);
  return <View style={s.filter}>
    <Text style={s.filterText}>Filters:</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterScroll} contentContainerStyle={s.filterItems} keyboardShouldPersistTaps="handled">
      {!count && <Text style={s.filterText}>All sessions</Text>}
      {value.labels.map(label => <View key={'label:' + label} style={s.filterChip}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Edit filter label ${label}`} onPress={() => setOpen(true)} style={s.filterChipTextTarget}><Text style={s.filterChipText}>{label}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove filter label ${label}`} onPress={() => onChange({ ...value, labels: value.labels.filter(item => item !== label) })} style={s.filterRemove}>
          <SymbolView name={{ ios: 'xmark', android: 'close' }} size={12} tintColor="#42566f" fallback={<Text>×</Text>} />
        </Pressable>
      </View>)}
      {value.noLabels && <View style={s.filterChip}>
        <Pressable accessibilityRole="button" accessibilityLabel="Edit no-label filter" onPress={() => setOpen(true)} style={s.filterChipTextTarget}><Text style={s.filterChipText}>No labels</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Remove no-label filter" onPress={() => onChange({ ...value, noLabels: false })} style={s.filterRemove}>
          <SymbolView name={{ ios: 'xmark', android: 'close' }} size={12} tintColor="#42566f" fallback={<Text>×</Text>} />
        </Pressable>
      </View>}
      <Pressable accessibilityRole="button" accessibilityLabel="Add label filter" onPress={() => setOpen(true)} style={({ pressed }) => [s.filterControl, pressed && s.filterPressed]}>
        <SymbolView name={{ ios: 'plus', android: 'add' }} size={18} tintColor="#65758b" fallback={<Text>＋</Text>} />
      </Pressable>
    </ScrollView>
    {!!count && <Pressable accessibilityRole="button" accessibilityLabel="Clear all filters" onPress={() => { onChange(emptyLabelFilter()); setSearch(''); }} style={({ pressed }) => [s.filterControl, pressed && s.filterPressed]}><Text style={s.filterText}>Clear</Text></Pressable>}
    <Modal transparent visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.backdrop}><View style={[s.sheet, { paddingBottom: Math.max(16, insets.bottom) }]} accessibilityViewIsModal>
        <Text accessibilityRole="header" style={s.heading}>Labels</Text>
        <TextInput accessibilityLabel="Search labels" placeholder="Search labels" value={search} onChangeText={setSearch} style={s.input} />
        <ScrollView keyboardShouldPersistTaps="handled">
          <Pressable accessibilityRole="checkbox" accessibilityLabel="No labels" accessibilityState={{ checked: value.noLabels }} onPress={() => onChange({ ...value, noLabels: !value.noLabels })} style={s.choice}><Text>{value.noLabels ? '☑' : '☐'}  No labels</Text></Pressable>
          {candidates.map(label => <Pressable key={label} accessibilityRole="checkbox" accessibilityLabel={`Label: ${label}`} accessibilityState={{ checked: value.labels.includes(label) }} onPress={() => onChange({ ...value, labels: value.labels.includes(label) ? value.labels.filter(s => s !== label) : [...value.labels, label] })} style={s.choice}><Text numberOfLines={1}>{value.labels.includes(label) ? '☑' : '☐'}  {label}</Text></Pressable>)}
          {!candidates.length && <Text style={s.hint}>No matching labels</Text>}
        </ScrollView>
        <View style={s.actions}><Button label="Clear filters" disabled={!labelFilterActive(value)} onPress={() => { onChange(emptyLabelFilter()); setSearch(''); }} /><Button label="Done" onPress={() => setOpen(false)} /></View>
      </View></KeyboardAvoidingView>
    </Modal>
  </View>;
}

export function LabelsEditor({ client, threadId, onClose, visible = true }: { client: LiveSessionClient; threadId: string; onClose: () => void; visible?: boolean }) {
  const thread = client.threads.get(threadId), [draft, setDraft] = useState(() => [...(thread?.markers ?? [])]);
  const [entry, setEntry] = useState(''), [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const working = useRef(false), alive = useRef(true), controller = useRef(new AbortController());
  const input = useRef<React.ElementRef<typeof TextInput>>(null), insets = useSafeAreaInsets();
  useEffect(() => { alive.current = true; controller.current = new AbortController(); return () => { alive.current = false; controller.current.abort(); }; }, []);
  const online = client.connectionState === 'online', available = client.isThreadAvailable(threadId);
  const enabled = online && available && client.supportsSessionLabels && !busy && visible;
  const add = (label = entry) => {
    if (!enabled) return;
    try {
      const next = [...draft]; if (editing === null) next.push(label); else next[editing] = label;
      setDraft(validateLabels(next)); setEntry(''); setEditing(null); setError(''); input.current?.focus();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Check this label.'); }
  };
  const save = async () => {
    if (working.current || !enabled) return;
    if (entry || editing !== null) { setError('Add or update the label before saving.'); input.current?.focus(); return; }
    working.current = true; setBusy(true); setError('');
    try {
      const saved = await client.saveThreadLabels(threadId, validateLabels(draft), Date.now(), controller.current.signal);
      if (!alive.current) return;
      if (JSON.stringify(saved.markers) !== JSON.stringify(draft)) setError('Labels changed on another device. Your draft is still here. Try saving again.');
      else onClose();
    } catch { if (alive.current) setError('Could not confirm the save. Your draft is still here. Try again when connected.'); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  };
  const candidates = labelCandidates([...client.threads.values()].filter(t => client.isThreadAvailable(t.id))).filter(label => !draft.includes(label) && label.toLocaleLowerCase().includes(entry.toLocaleLowerCase()));
  return <Modal transparent visible={visible} animationType="slide" onRequestClose={() => { if (!working.current) onClose(); }}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.backdrop}><View style={[s.sheet, { paddingBottom: Math.max(16, insets.bottom) }]} accessibilityViewIsModal accessibilityLabel="Edit labels">
      <Text accessibilityRole="header" style={s.heading}>Edit labels</Text><Text numberOfLines={2} style={s.hint}>{thread?.title}</Text>
      <Text style={s.hint}>Up to 10 labels, 30 characters each.</Text>
      {!online && <Text>Connect to edit labels. Your draft is still here.</Text>}
      {!available && <Text accessibilityRole="alert">This session is unavailable. Your draft is still here.</Text>}
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {draft.map((label, i) => <View key={i} style={s.draftRow}><Text numberOfLines={1} style={s.draftLabel}>{label}</Text><Button label={`Edit label ${label}`} text="Edit" disabled={!enabled} onPress={() => { setEditing(i); setEntry(label); setError(''); input.current?.focus(); }} /><Button label={`Remove label ${label}`} text="Remove" disabled={!enabled} onPress={() => { setDraft(draft.filter((_, n) => n !== i)); setEntry(''); setEditing(null); setError(''); }} /></View>)}
        <TextInput ref={input} accessibilityLabel="Label text" placeholder="Add a label" value={entry} editable={enabled} autoCapitalize="none" onChangeText={setEntry} style={s.input} onSubmitEditing={() => add()} />
        <View style={s.actions}><Button label={editing === null ? 'Add' : 'Update'} disabled={!enabled} onPress={() => add()} />{editing !== null && <Button label="Cancel edit" disabled={!enabled} onPress={() => { setEditing(null); setEntry(''); }} />}</View>
        {candidates.length > 0 && <View style={s.reuse}><Text style={s.hint}>Reuse an existing label</Text>{candidates.map(label => <Pressable key={label} accessibilityRole="button" accessibilityLabel={`Reuse label ${label}`} disabled={!enabled} onPress={() => add(label)} style={s.choice}><Text numberOfLines={1}>{label}</Text></Pressable>)}</View>}
      </ScrollView>
      {error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      <View style={s.actions}><Button label="Clear labels" disabled={!enabled || !draft.length} onPress={() => { setDraft([]); setEntry(''); setEditing(null); setError(''); }} /><Button label="Cancel" disabled={busy} onPress={onClose} /><Button label={busy ? 'Saving…' : 'Save'} disabled={!enabled} onPress={() => void save()} /></View>
    </View></KeyboardAvoidingView>
  </Modal>;
}

const s = StyleSheet.create({
  pills: { height: 24, minWidth: 0, overflow: 'hidden', marginTop: 6 }, pillsVisible: { flexDirection: 'row', gap: 4 },
  pill: { backgroundColor: '#edf2f7', color: '#42566f', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, fontSize: 11, alignSelf: 'flex-start' },
  measure: { position: 'absolute', width: 10000, opacity: 0, alignItems: 'flex-start' },
  filter: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 6, minHeight: 44 },
  filterText: { color: '#65758b', fontSize: 13 }, filterScroll: { flex: 1, minWidth: 0 }, filterItems: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  filterChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#edf2f7', borderRadius: 6 },
  filterChipTextTarget: { minHeight: 44, paddingLeft: 8, justifyContent: 'center' }, filterChipText: { color: '#42566f', fontSize: 13 },
  filterRemove: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  filterControl: { minWidth: 44, minHeight: 44, borderRadius: 6, alignItems: 'center', justifyContent: 'center' }, filterPressed: { backgroundColor: '#edf2f7' },
  backdrop: { flex: 1, backgroundColor: '#0005', justifyContent: 'flex-end' }, sheet: { maxHeight: '85%', padding: 16, backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, gap: 10 },
  heading: { fontSize: 20, fontWeight: '600', color: '#172a40' }, hint: { color: '#65758b', fontSize: 13 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 9, minHeight: 44, paddingHorizontal: 12, paddingVertical: 9, color: '#172a40' },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 8 }, button: { backgroundColor: '#e7eef8', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 9, minHeight: 44, justifyContent: 'center' }, buttonText: { color: '#2b4e81', fontWeight: '600' }, disabled: { opacity: 0.5 },
  choice: { minHeight: 44, padding: 10 }, reuse: { marginTop: 12 },
  draftRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }, draftLabel: { flex: 1, minWidth: 0, color: '#172a40' },
  error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10, borderRadius: 8 },
});
