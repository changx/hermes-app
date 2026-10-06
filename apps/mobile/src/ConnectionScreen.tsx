import React, { useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './FontSize';
import type { ConnectionRuntime } from './connections';

const labels: Record<ConnectionRuntime['status'], string> = { online: 'Online', connecting: 'Connecting', syncing: 'Syncing', retrying: 'Reconnecting', suspended: 'Offline', blocked: 'Needs attention', pairing: 'Pairing' };
const stateLabel = (row: ConnectionRuntime) => row.damaged ? 'Needs attention' : labels[row.status];

type Props = {
  ready: boolean; listError: string; connections: readonly ConnectionRuntime[]; max: number;
  onAdd(server: string, code: string): Promise<unknown>;
  onRemove(slot: string): Promise<void>;
  onDone?(): void;
};

/**
 * Saved Hermes connections on this device. Adding never replaces a saved
 * connection. Removing deletes only that connection's local credential,
 * drafts and queued messages; server conversations are unchanged.
 */
export function ConnectionManager({ ready, listError, connections, max, onAdd, onRemove, onDone }: Props) {
  const empty = !connections.length;
  const [adding, setAdding] = useState(empty);
  const [server, setServer] = useState(''), [code, setCode] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const working = useRef(false);
  const run = async (work: () => Promise<void>, fallback: string) => {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try { await work(); }
    catch (failure) { setError(failure instanceof Error && /already saved|eight connections|list/.test(failure.message) ? failure.message : fallback); }
    finally { working.current = false; setBusy(false); }
  };
  const add = () => run(async () => {
    await onAdd(server.trim(), code);
    setCode(''); setServer(''); setAdding(false);
  }, 'Could not add the connection. Check the HTTPS address and pairing code, then try again.');
  const remove = (row: ConnectionRuntime) => Alert.alert(`Remove ${row.name}?`,
    'This removes this connection, its local drafts and queued messages from this device. Other connections and server conversations are unchanged.', [
      { text: 'Keep connection', style: 'cancel' },
      { text: row.status === 'pairing' ? 'Cancel pairing' : 'Remove connection', style: 'destructive', onPress: () => { void run(() => onRemove(row.slot), 'Could not confirm removal. Check the connection list before trying again.'); } },
    ]);
  if (!ready) return null;
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.form, empty && styles.centered]}>
    {empty && <Text style={styles.brand}>Hermes App</Text>}
    <Text style={styles.heading}>{empty ? 'Connect to Hermes' : 'Connections'}</Text>
    {!empty && <Text style={styles.text}>Projects from all connections appear on the home screen.</Text>}
    {!!listError && <Text accessibilityRole="alert" style={styles.error}>{listError}</Text>}
    {connections.map(row => <View key={row.slot} style={styles.row} accessible={false}>
      <View style={styles.fill}>
        <Text style={styles.name} numberOfLines={1}>{row.name}</Text>
        <Text style={styles.address} numberOfLines={1}>{row.server ?? 'Saved server address unavailable'}</Text>
        <Text style={[styles.state, (row.status === 'blocked' || row.damaged) && styles.stateIssue]} accessibilityLiveRegion="polite">{stateLabel(row)}</Text>
        {!!(row.pairingStatus || (row.status === 'blocked' || row.damaged || row.pairing) && row.error) && <Text style={styles.detail}>{row.pairingStatus || row.error}</Text>}
      </View>
      <Action title={row.status === 'pairing' ? 'Cancel' : 'Remove'} secondary disabled={busy || !!listError}
        label={`${row.status === 'pairing' ? 'Cancel pairing' : 'Remove connection'} ${row.name}`} onPress={() => remove(row)} />
    </View>)}
    {adding ? <View style={styles.addForm}>
      {!empty && <Text style={styles.subheading}>Add connection</Text>}
      <Text style={styles.caption}>Server address</Text>
      <TextInput accessibilityLabel="Server address" style={styles.input} autoCapitalize="none" autoCorrect={false} keyboardType="url" textContentType="URL"
        value={server} onChangeText={setServer} editable={!busy} placeholder="https://your-hermes.example" />
      <Text style={styles.caption}>One-time pairing code</Text>
      <TextInput accessibilityLabel="One-time pairing code" style={styles.input} autoCapitalize="characters" autoCorrect={false} textContentType="oneTimeCode"
        value={code} onChangeText={setCode} editable={!busy} placeholder="Enter the code from your admin" />
      <Text style={styles.text}>Your admin must approve this connection. This device saves it securely, so you won't need the code again.{empty ? '' : ' Your existing connections stay connected.'}</Text>
      <Action title={busy ? 'Pairing…' : 'Pair connection'} disabled={busy || !server.trim() || !code.trim()} onPress={() => { void add(); }} />
      {!empty && <Action title="Cancel" secondary disabled={busy} onPress={() => { setAdding(false); setCode(''); setError(''); }} />}
    </View> : <Action title="Add connection" disabled={busy || !!listError || connections.length >= max} onPress={() => { setAdding(true); setError(''); }} />}
    {connections.length >= max && <Text style={styles.text}>This version supports eight connections. Remove one before adding another.</Text>}
    {!!error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
    {!empty && onDone && <Action title="Done" secondary onPress={onDone} />}
  </ScrollView>;
}

function Action({ title, label, onPress, secondary = false, disabled = false }: { title: string; label?: string; onPress(): void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label ?? title} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={[styles.button, secondary && styles.secondary, disabled && styles.disabled]}>
    <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{title}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({
  fill: { flex: 1 },
  form: { flexGrow: 1, padding: 20, gap: 12 }, centered: { justifyContent: 'center', padding: 24 },
  brand: { fontSize: 30, fontWeight: '700', color: '#14283e' },
  heading: { fontSize: 20, fontWeight: '700', color: '#172a40' }, subheading: { fontSize: 17, fontWeight: '600', color: '#172a40' },
  text: { color: '#607187', fontSize: 14, lineHeight: 21 }, caption: { color: '#607187', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 12 },
  name: { fontSize: 16, fontWeight: '600', color: '#172a40' }, address: { fontSize: 13, color: '#607187' },
  state: { fontSize: 13, color: '#237a35', fontWeight: '600', marginTop: 2 }, stateIssue: { color: '#8a5300' },
  detail: { fontSize: 13, color: '#607187', marginTop: 2 },
  addForm: { gap: 10, marginTop: 4 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 10, minHeight: 44, padding: 12, color: '#172a40' },
  button: { backgroundColor: '#2960ad', borderRadius: 9, paddingVertical: 12, paddingHorizontal: 14, alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  secondary: { backgroundColor: '#e6edf7' }, disabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14 }, secondaryText: { color: '#2b4e81' },
  error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10 },
});
