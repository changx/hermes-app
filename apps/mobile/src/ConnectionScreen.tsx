import React, { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { Text, TextInput } from './FontSize';
import type { ConnectionRuntime } from './connections';

const labels: Record<ConnectionRuntime['status'], string> = { online: 'Online', connecting: 'Connecting', syncing: 'Syncing', retrying: 'Reconnecting', suspended: 'Offline', blocked: 'Needs attention', pairing: 'Pairing' };
export const connectionStateLabel = (row: ConnectionRuntime) => row.damaged ? 'Needs attention' : labels[row.status];
export const connectionNeedsAttention = (row: ConnectionRuntime) => row.damaged || row.status === 'blocked';
/** Safe user-facing detail for a connection, if any. */
export const connectionDetail = (row: ConnectionRuntime) => row.pairingStatus || ((connectionNeedsAttention(row) || row.pairing) ? row.error : '') || '';

/**
 * Pairing form for one new Hermes. Adding never replaces a saved connection.
 * With no saved connection it is also the first-run screen.
 */
export function AddConnectionForm({ first, onAdd, onCancel, limitReached = false }: {
  first: boolean; onAdd(server: string, code: string): Promise<unknown>; onCancel?(): void; limitReached?: boolean;
}) {
  const [server, setServer] = useState(''), [code, setCode] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const working = useRef(false);
  const add = async () => {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try { await onAdd(server.trim(), code); setCode(''); setServer(''); }
    catch (failure) {
      setError(failure instanceof Error && /already saved|eight connections|list/.test(failure.message) ? failure.message
        : 'Could not add the connection. Check the HTTPS address and pairing code, then try again.');
    } finally { working.current = false; setBusy(false); }
  };
  const locked = busy || limitReached;
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.form, first && styles.centered]}>
    {first && <Text style={styles.brand}>Hermes App</Text>}
    {first && <Text style={styles.heading}>Connect to Hermes</Text>}
    <Text style={styles.caption}>Server address</Text>
    <TextInput accessibilityLabel="Server address" style={styles.input} autoCapitalize="none" autoCorrect={false} keyboardType="url" textContentType="URL"
      value={server} onChangeText={setServer} editable={!locked} placeholder="https://your-hermes.example" />
    <Text style={styles.caption}>One-time pairing code</Text>
    <TextInput accessibilityLabel="One-time pairing code" style={styles.input} autoCapitalize="characters" autoCorrect={false} textContentType="oneTimeCode"
      value={code} onChangeText={setCode} editable={!locked} placeholder="Enter the code from your admin" />
    <Text style={styles.text}>Your admin must approve this connection. This device saves it securely, so you won't need the code again.{first ? '' : ' Your existing connections stay connected.'}</Text>
    {limitReached && <Text style={styles.text}>This version supports eight connections. Remove one before adding another.</Text>}
    <Action title={busy ? 'Pairing…' : 'Pair connection'} disabled={locked || !server.trim() || !code.trim()} onPress={() => { void add(); }} />
    {onCancel && <Action title="Cancel" secondary disabled={busy} onPress={onCancel} />}
    {!!error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
  </ScrollView>;
}

export function Action({ title, label, onPress, secondary = false, disabled = false }: { title: string; label?: string; onPress(): void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label ?? title} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={[styles.button, secondary && styles.secondary, disabled && styles.disabled]}>
    <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{title}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({
  form: { flexGrow: 1, padding: 20, gap: 12 }, centered: { justifyContent: 'center', padding: 24 },
  brand: { fontSize: 30, fontWeight: '700', color: '#14283e' },
  heading: { fontSize: 20, fontWeight: '700', color: '#172a40' },
  text: { color: '#607187', fontSize: 14, lineHeight: 21 }, caption: { color: '#607187', fontSize: 13 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 10, minHeight: 44, padding: 12, color: '#172a40' },
  button: { backgroundColor: '#2960ad', borderRadius: 9, paddingVertical: 12, paddingHorizontal: 14, alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  secondary: { backgroundColor: '#e6edf7' }, disabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14 }, secondaryText: { color: '#2b4e81' },
  error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10 },
});
