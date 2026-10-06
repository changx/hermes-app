import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './FontSize';
import type { AgentModelSettings as ModelPreferences, ModelSelectionConfirmation } from '../../../packages/client/src/index';
export type ModelSettingsApi = {
  getModelSettings(signal?: AbortSignal): Promise<ModelPreferences>;
  setModelSettings(provider: string, model: string, signal?: AbortSignal, confirmSelection?: boolean): Promise<ModelPreferences | ModelSelectionConfirmation>;
};

/** The parent keys this component by connection. Never persists a local model override. */
export function ModelSettings({ client }: { client: ModelSettingsApi }) {
  const [current, setCurrent] = useState<ModelPreferences | null>(null);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<ModelSelectionConfirmation | null>(null);
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState<'provider' | 'model' | null>(null);
  const [modelQuery, setModelQuery] = useState('');
  const request = useRef<AbortController | null>(null);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    request.current?.abort(); request.current = controller;
    setCurrent(null); setProvider(''); setModel(''); setError(''); setNotice(''); setConfirmation(null); setBusy(true);
    client.getModelSettings(controller.signal).then(value => {
      if (!alive.current || controller.signal.aborted) return;
      setCurrent(value); setProvider(value.provider); setModel(value.model);
    }).catch(() => {
      if (alive.current && !controller.signal.aborted) setError('Could not load model settings. Try again.');
    }).finally(() => { if (alive.current && !controller.signal.aborted) { request.current = null; setBusy(false); } });
    return () => { alive.current = false; controller.abort(); request.current?.abort(); };
  }, [client, reload]);
  const save = async (confirmSelection = false) => {
    if (!alive.current || !current || busy || error || request.current || !provider || !model.trim()) return;
    if (confirmSelection && (!confirmation || confirmation.provider !== provider || confirmation.model !== model.trim())) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(''); setNotice(''); setOpen(null);
    try {
      const value = await client.setModelSettings(provider, model.trim(), controller.signal, confirmSelection);
      if (!alive.current || controller.signal.aborted) return;
      if ('confirmation_required' in value) { setConfirmation(value); return; }
      setConfirmation(null);
      setCurrent(value); setProvider(value.provider); setModel(value.model);
      setNotice('Model settings saved.');
    } catch {
      if (alive.current && !controller.signal.aborted)
        setError('Could not confirm the change. Reload settings before trying again.');
    } finally {
      if (alive.current && !controller.signal.aborted) { request.current = null; setBusy(false); }
    }
  };
  const selected = current?.providers.find(p => p.id === provider);
  const matchingModels = selected?.models.filter(id => id.toLowerCase().includes(modelQuery.trim().toLowerCase())) ?? [];
  const button = (label: string, onPress: () => void, disabled = busy, selectedOption = false) =>
    <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected: selectedOption }}
      disabled={disabled} onPress={onPress} style={[styles.button, selectedOption && styles.selected, disabled && styles.disabled]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>;
  return <View style={styles.section}>
    {!current && busy && <Text accessibilityLiveRegion="polite">Loading model settings…</Text>}
    {current && <>
      <Text style={styles.label}>Provider</Text>
      {button(selected?.name || provider || 'Choose provider', () => setOpen(open === 'provider' ? null : 'provider'))}
      {open === 'provider' && <View style={styles.options}>{current.providers.map(p => button(p.name, () => {
        setProvider(p.id); setModel(p.id === current.provider ? current.model : ''); setNotice(''); setConfirmation(null); setOpen(null);
      }, busy, p.id === provider))}</View>}
      <Text style={styles.label}>Model</Text>
      <TextInput accessibilityLabel="Model" value={model} onChangeText={value => { setModel(value); setNotice(''); setConfirmation(null); }}
        placeholder="Model name" autoCapitalize="none" autoCorrect={false} maxLength={256} editable={!busy} style={styles.input} />
      {!!selected?.models.length && button('Choose model', () => { setModelQuery(''); setOpen(open === 'model' ? null : 'model'); })}
      {open === 'model' && <View style={styles.options}>
        <TextInput accessibilityLabel="Search models" placeholder="Search models" value={modelQuery} onChangeText={setModelQuery} autoCapitalize="none" autoCorrect={false} style={styles.input} />
        {matchingModels.slice(0, 60).map(id => button(id, () => { setModel(id); setNotice(''); setConfirmation(null); setOpen(null); }, busy, id === model))}
        {matchingModels.length > 60 && <Text style={styles.hint}>Type to narrow the list.</Text>}
        {!matchingModels.length && <Text style={styles.hint}>No matching models. You can enter a model name above.</Text>}
      </View>}
      {confirmation ? <View style={styles.options}>
        <Text accessibilityLiveRegion="polite">{confirmation.warning}</Text>
        {button('Confirm model selection', () => { void save(true); }, busy || !!error)}
        {button('Cancel model selection', () => setConfirmation(null))}
      </View> : button(busy ? 'Saving model…' : 'Save model', () => { void save(); }, busy || !!error || !provider || !model.trim() || (provider === current.provider && model.trim() === current.model))}
    </>}
    {!!error && <><Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>{button('Reload model settings', () => setReload(n => n + 1))}</>}
    {!!notice && <Text accessibilityLiveRegion="polite" style={styles.hint}>{notice}</Text>}
  </View>;
}
const styles = StyleSheet.create({
  section: { gap: 10 },
  heading: { fontSize: 18, fontWeight: '600', color: '#172a40' }, label: { fontSize: 14, color: '#172a40' },
  hint: { fontSize: 13, lineHeight: 20, color: '#607187' },
  input: { fontSize: 16, minHeight: 44, padding: 12, borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 9, color: '#172a40', backgroundColor: '#fff' },
  button: { padding: 12, minHeight: 44, borderRadius: 9, backgroundColor: '#e6edf7' },
  buttonText: { fontSize: 14, color: '#2b4e81' }, selected: { borderWidth: 1, borderColor: '#2960ad' },
  disabled: { opacity: 0.5 }, options: { gap: 6 }, error: { color: '#9d1b32', padding: 10, backgroundColor: '#fff0f2' },
});
