import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './FontSize';
import { SettingsBlock, SettingsPage, SettingsSection } from './SettingsUI';
import type { EnvKey, EnvKeys, EnvKeySuggestion } from '../../../packages/client/src/index';
import { ENV_KEY_MAX_VALUE, ENV_KEY_NAME } from '../../../packages/client/src/envKeys';

export type EnvKeysApi = {
  envKeys(signal?: AbortSignal): Promise<EnvKeys>;
  setEnvKey(name: string, value: string): Promise<EnvKey>;
  removeEnvKey(name: string): Promise<boolean>;
};

const status = (error: unknown) => typeof error === 'object' && error !== null && 'status' in error ? (error as { status?: unknown }).status : undefined;
const saveError = (error: unknown) => status(error) === 403 ? 'Your administrator manages this key.' : 'Could not save this key. Check the connection and try again.';

/**
 * Settings > API keys of one connection (docs/env-keys.md). The server hides the keys that the
 * administrator manages. A value is sent once and is never shown again.
 */
export function EnvKeysSettings({ client }: { client: EnvKeysApi }) {
  const [keys, setKeys] = useState<EnvKey[] | null>(null);
  const [suggestions, setSuggestions] = useState<EnvKeySuggestion[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const alive = useRef(true);
  const load = useCallback(async () => {
    setError('');
    try { const result = await client.envKeys(); if (alive.current) { setKeys(result.keys); setSuggestions(result.suggestions); } }
    catch { if (alive.current) setError('Could not load API keys. Check the connection and try again.'); }
  }, [client]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);

  const reset = () => { setEditing(null); setAdding(false); setName(''); setValue(''); };
  const save = async (target: string) => {
    if (busy || !ENV_KEY_NAME.test(target) || !value.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await client.setEnvKey(target, value);
      if (!alive.current) return;
      reset(); setNotice(`${target} saved. Hermes uses it from your next message.`); await load();
    } catch (failure) { if (alive.current) setError(saveError(failure)); }
    finally { if (alive.current) setBusy(false); }
  };
  const remove = (key: EnvKey) => Alert.alert(`Remove ${key.name}?`, 'Hermes and your scripts can no longer use this key.', [
    { text: 'Keep', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: async () => {
      setBusy(true); setError(''); setNotice('');
      try { await client.removeEnvKey(key.name); if (alive.current) { setNotice(`${key.name} removed.`); await load(); } }
      catch { if (alive.current) setError('Could not confirm the removal. Reload the list before trying again.'); }
      finally { if (alive.current) setBusy(false); }
    } },
  ]);

  const button = (label: string, onPress: () => void, disabled = busy, danger = false, accessibilityLabel = label) =>
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.button, danger && styles.dangerButton, pressed && styles.pressed, disabled && styles.disabled]}>
      <Text style={[styles.buttonText, danger && styles.dangerText]}>{label}</Text>
    </Pressable>;
  const valueField = (label: string) => <TextInput accessibilityLabel={label} placeholder={label} value={value} secureTextEntry
    onChangeText={text => setValue(text.replace(/[\r\n]/g, ''))} autoCapitalize="none" autoCorrect={false} autoComplete="off"
    textContentType="none" editable={!busy} maxLength={ENV_KEY_MAX_VALUE} style={styles.input} />;
  const validName = ENV_KEY_NAME.test(name);
  const hint = suggestions.find(row => row.name === name)?.description;
  const replacing = keys?.some(key => key.name === name) === true;
  const open = suggestions.filter(row => !name || row.name.startsWith(name)).slice(0, 6);

  return <SettingsPage>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {!!notice && <Text accessibilityLiveRegion="polite" style={styles.hint}>{notice}</Text>}
    <SettingsSection title="API keys" footer="Keys that Hermes uses on this Hermes, for example for search or for your own scripts. Keys that your administrator manages are not shown.">
      {keys === null && !error && <SettingsBlock first><Text accessibilityLiveRegion="polite" style={styles.hint}>Loading…</Text></SettingsBlock>}
      {keys !== null && !keys.length && <SettingsBlock first><Text style={styles.hint}>No API keys.</Text></SettingsBlock>}
      {keys?.map((key, index) => <SettingsBlock key={key.name} first={index === 0}>
        <View style={styles.itemRow}>
          <View style={styles.itemText}>
            <Text numberOfLines={1} style={styles.itemTitle}>{key.name}</Text>
            <Text numberOfLines={2} style={styles.hint}>{[key.description, key.preview ? `Ends in ${key.preview.replace('…', '')}` : 'Set'].filter(Boolean).join(' · ')}</Text>
            {key.sandbox && <Text style={styles.badge}>Commands can read it</Text>}
          </View>
          {button('Change', () => { reset(); setNotice(''); setEditing(key.name); }, busy || editing === key.name, false, `Change ${key.name}`)}
          {button('Remove', () => remove(key), busy, true, `Remove ${key.name}`)}
        </View>
      </SettingsBlock>)}
    </SettingsSection>
    {editing ? <SettingsSection title={`Change ${editing}`} footer="Hermes uses the new value from your next message.">
      <SettingsBlock first>
        {valueField('New value')}
        <View style={styles.actions}>
          {button('Cancel', reset)}
          {button(busy ? 'Saving…' : 'Save', () => { void save(editing); }, busy || !value.trim())}
        </View>
      </SettingsBlock>
    </SettingsSection> : adding ? <SettingsSection title="Add API key" footer={replacing ? `${name} is already set. Saving replaces its value.` : 'Use capital letters, digits and _ for the name.'}>
      <SettingsBlock first>
        <TextInput accessibilityLabel="Name" placeholder="Name, for example MY_SERVICE_API_KEY" value={name}
          onChangeText={text => setName(text.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))} autoCapitalize="characters" autoCorrect={false}
          autoComplete="off" editable={!busy} maxLength={128} style={styles.input} />
        {!!hint && <Text style={styles.hint}>{hint}</Text>}
        {!!name && !validName && <Text style={styles.hint}>Start with a letter or _.</Text>}
        {!validName && open.length > 0 && <View style={styles.suggestions}>
          {open.map(row => <React.Fragment key={row.name}>{button(row.name, () => setName(row.name), busy, false, `Use ${row.name}`)}</React.Fragment>)}
        </View>}
        {valueField('Value')}
        <View style={styles.actions}>
          {button('Cancel', reset)}
          {button(busy ? 'Saving…' : 'Save key', () => { void save(name); }, busy || !validName || !value.trim())}
        </View>
      </SettingsBlock>
    </SettingsSection> : <SettingsSection>
      <SettingsBlock first>
        <View style={styles.actions}>
          {button('Add API key', () => { reset(); setNotice(''); setAdding(true); }, busy || keys === null)}
        </View>
      </SettingsBlock>
    </SettingsSection>}
    {!!error && keys === null && button('Reload', () => { void load(); })}
  </SettingsPage>;
}

const styles = StyleSheet.create({
  error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10, borderRadius: 8 },
  hint: { fontSize: 13, lineHeight: 19, color: '#607187' },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemText: { flex: 1, minWidth: 0 },
  itemTitle: { fontSize: 16, color: '#172a40' },
  badge: { fontSize: 12, color: '#2b6b3f', marginTop: 2 },
  input: { fontSize: 16, minHeight: 44, padding: 12, borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 9, color: '#172a40', backgroundColor: '#fff' },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' },
  button: { minHeight: 40, paddingHorizontal: 14, borderRadius: 9, backgroundColor: '#e6edf7', alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 14, color: '#2b4e81', fontWeight: '600' },
  dangerButton: { backgroundColor: '#fff0f2' }, dangerText: { color: '#b42335' },
  pressed: { opacity: 0.8 }, disabled: { opacity: 0.5 },
});
