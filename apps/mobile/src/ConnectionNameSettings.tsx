import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './FontSize';
import { CONNECTION_NAME_INVALID, CONNECTION_NAME_TOO_LONG } from '../../../packages/client/src/connectionName';

type Props = {
  /** Name chosen on this device, or null when the host name is used. */
  customName: string | null;
  /** Host name; used when the field is blank. */
  defaultName: string;
  onSave(value: string): Promise<void>;
};

/** This device's name for one connection. Blank restores the server's host name. */
export function ConnectionNameSettings({ customName, defaultName, onSave }: Props) {
  const saved = customName ?? '';
  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const edited = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // A rename from another page updates the field until the user starts typing.
  useEffect(() => { if (!edited.current) setDraft(saved); }, [saved]);
  const unchanged = draft.trim() === saved;
  const submit = async () => {
    if (saving || unchanged) return;
    setSaving(true); setMessage(null);
    try {
      await onSave(draft);
      if (!mounted.current) return;
      edited.current = false; setDraft(draft.trim()); setMessage({ error: false, text: 'Saved.' });
    } catch (failure) {
      if (!mounted.current) return;
      const reason = failure instanceof Error ? failure.message : '';
      setMessage({ error: true, text: reason === CONNECTION_NAME_INVALID || reason === CONNECTION_NAME_TOO_LONG ? reason : 'Could not save the name. Nothing changed. Try again.' });
    } finally { if (mounted.current) setSaving(false); }
  };
  const blocked = saving || unchanged;
  return <View style={styles.section}>
    <Text style={styles.label}>Connection name</Text>
    <TextInput accessibilityLabel="Connection name" value={draft} placeholder={defaultName} maxLength={80} autoCorrect={false}
      editable={!saving} style={styles.input} onChangeText={value => { edited.current = true; setMessage(null); setDraft(value); }} />
    <Text style={styles.hint}>Shown in lists and titles on this device. Leave blank to use {defaultName}.</Text>
    {message && <Text accessibilityLiveRegion="polite" style={message.error ? styles.error : styles.hint}>{message.text}</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel="Save connection name" accessibilityState={{ disabled: blocked }}
      disabled={blocked} onPress={() => { void submit(); }} style={[styles.button, blocked && styles.disabled]}>
      <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save name'}</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  label: { fontSize: 14, color: '#172a40' },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 10, minHeight: 44, padding: 12, color: '#172a40' },
  hint: { color: '#607187', fontSize: 13, lineHeight: 20 },
  error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10 },
  button: { backgroundColor: '#2960ad', borderRadius: 9, padding: 13, alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600' },
});
