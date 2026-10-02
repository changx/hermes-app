import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import type { Channel } from '../../../packages/client/src/index';
import type { LiveSessionClient } from '../../../packages/client/src/liveClient';
import { Text, TextInput } from './FontSize';
import { MessageContent } from './MessageContent';

function Action({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={[s.action, disabled && s.disabled]}><Text style={s.actionText}>{label}</Text></Pressable>;
}

/** Detail belongs to this route only; the catalogue remains name-only. */
export function ChannelContextScreen({ client, channelId }: { client: LiveSessionClient; channelId: string }) {
  const [detail, setDetail] = useState<Channel | null>(null);
  const [draft, setDraft] = useState(''), [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const editingRef = useRef(false), working = useRef(false), generation = useRef(0), focused = useRef(false);
  const navigation = useNavigation();
  const dirty = editing && draft !== (detail?.description || '');

  useFocusEffect(useCallback(() => {
    focused.current = true;
    const version = ++generation.current;
    const controller = new AbortController();
    // A temporary navigation interruption must not overwrite an unsaved draft.
    if (!editingRef.current) {
      setLoading(true); setError('');
      void client.getChannelInfo(channelId, controller.signal).then(value => {
        if (!focused.current || generation.current !== version) return;
        setDetail(value); setDraft(value.description || '');
      }).catch(() => {
        if (focused.current && generation.current === version) setError('Could not load channel context. Try again.');
      }).finally(() => {
        if (focused.current && generation.current === version) setLoading(false);
      });
    }
    return () => { focused.current = false; generation.current++; controller.abort(); };
  }, [client, channelId, retry]));

  const discard = () => { editingRef.current = false; setEditing(false); setDraft(detail?.description || ''); setError(''); };
  const cancel = () => {
    if (!dirty) { discard(); return; }
    Alert.alert('Discard changes?', 'Your channel context has not been saved.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: discard },
    ]);
  };
  usePreventRemove(dirty || busy, ({ data }) => {
    if (working.current) return;
    Alert.alert('Discard changes?', 'Your channel context has not been saved.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => { discard(); navigation.dispatch(data.action); } },
    ]);
  });

  const save = async () => {
    if (working.current || !focused.current || !detail || draft.length > 4000) return;
    working.current = true; setBusy(true); setError('');
    const version = generation.current, description = draft.trim();
    try {
      // Do not send a name: editing the summary must not undo another device's rename.
      await client.updateChannel(channelId, { description });
      const saved = await client.getChannelInfo(channelId);
      if ((saved.description || '') !== description) throw new Error('Context changed before verification');
      if (!focused.current || generation.current !== version) return;
      setDetail(saved); setDraft(saved.description || ''); editingRef.current = false; setEditing(false);
    } catch {
      if (focused.current && generation.current === version)
        setError('Could not confirm your changes were saved. Keep your text and try again.');
    } finally { working.current = false; setBusy(false); }
  };

  return <View style={s.page}>
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {loading ? <ActivityIndicator style={s.spinner} /> : !detail ? <Action label="Try again" onPress={() => setRetry(value => value + 1)} /> : <>
      <View style={s.toolbar}>
        <Text style={s.hint}>A short summary of this channel and its goals.</Text>
        {!editing && <Action label={detail.description ? 'Edit' : 'Add context'} onPress={() => { editingRef.current = true; setEditing(true); setError(''); }} />}
      </View>
      {editing ? <>
        <TextInput accessibilityLabel="Channel context" placeholder="What is this channel for?" placeholderTextColor="#65758b"
          value={draft} onChangeText={setDraft} multiline maxLength={4000} editable={!busy} style={s.editor} />
        <Text style={s.hint}>New sessions use this context. Existing conversations do not change.</Text>
        <View style={s.actions}>
          <Action label="Cancel" disabled={busy} onPress={cancel} />
          <Action label={busy ? 'Saving…' : 'Save'} disabled={busy || !dirty || draft.length > 4000} onPress={() => void save()} />
        </View>
      </> : <ScrollView style={s.fill} contentContainerStyle={s.content}>
        {detail.description ? <MessageContent text={detail.description} /> : <Text style={s.empty}>No channel context yet.</Text>}
      </ScrollView>}
      {!!error && !editing && <Action label="Try again" onPress={() => setRetry(value => value + 1)} />}
    </>}
  </View>;
}

const s = StyleSheet.create({
  page: { flex: 1, padding: 16, gap: 12 }, fill: { flex: 1 }, spinner: { marginTop: 24 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  hint: { flexShrink: 1, color: '#65758b', fontSize: 13, lineHeight: 19 },
  editor: { flex: 1, minHeight: 0, backgroundColor: '#fff', borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 9,
    paddingHorizontal: 12, paddingVertical: 12, color: '#172a40', textAlignVertical: 'top' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }, content: { paddingBottom: 32 },
  action: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 10, justifyContent: 'center', borderRadius: 9, backgroundColor: '#e7eef8' },
  actionText: { color: '#2b4e81', fontWeight: '600' }, disabled: { opacity: 0.5 },
  error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10, borderRadius: 8 },
  empty: { color: '#65758b', paddingVertical: 12 },
});
