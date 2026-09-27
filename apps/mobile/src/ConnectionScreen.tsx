import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

interface Props {

  code: string;
  onCode(value: string): void;
  connected: boolean;
  pairing?: boolean;
  busy: boolean;
  status?: string;
  error?: string;
  onPair(): void;
  onBack(): void;
  onForget(): void;
}

/** Pairing is an explicit first-time authorization, never a network-retry step. */
export function ConnectionScreen(props: Props) {
  const [replacing, setReplacing] = useState(false);
  const showPairing = !props.connected || replacing || props.pairing;
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
    <Text style={styles.brand}>Hermes App</Text>
    <Text style={styles.heading}>{props.connected ? 'Connection settings' : 'Connect to Hermes'}</Text>
    {!showPairing ? <>
      <Text style={styles.text}>This device is connected. It will reconnect automatically if the network drops.</Text>
      <Action title="Back to chat" onPress={props.onBack} />
      <Action title="Pair again" onPress={() => setReplacing(true)} secondary />
      <Action title="Disconnect and forget this connection" onPress={props.onForget} secondary />
    </> : <>
      <Text style={styles.caption}>One-time pairing code</Text>
      <TextInput accessibilityLabel="One-time pairing code" style={styles.input} autoCapitalize="characters" autoCorrect={false}
        value={props.code} onChangeText={props.onCode} editable={!props.busy} placeholder="Enter the code from your admin" />
      <Text style={styles.text}>Your admin must approve your first connection. This device securely saves it, so you won't need to enter the code again.</Text>
      <Action title={props.busy ? 'Pairing…' : 'Pair and connect'} disabled={props.busy || !props.code.trim()} onPress={props.onPair} />
      {props.connected && <Action title="Back to previous connection" onPress={props.onBack} secondary disabled={props.busy} />}
    </>}
    {!!props.status && <Text accessibilityLiveRegion="polite" style={styles.text}>{props.status}</Text>}
    {!!props.error && <Text accessibilityLiveRegion="polite" style={styles.error}>{props.error}</Text>}
  </ScrollView>;
}

function Action({ title, onPress, secondary = false, disabled = false }: { title: string; onPress(): void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={[styles.button, secondary && styles.secondary, disabled && styles.disabled]}>
    <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{title}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({
  form: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 14 },
  brand: { fontSize: 30, fontWeight: '700', color: '#14283e' },
  heading: { fontSize: 18, fontWeight: '600', color: '#172a40' },
  text: { color: '#607187', fontSize: 14, lineHeight: 21 }, caption: { color: '#607187', fontSize: 13 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 10, minHeight: 44, padding: 12, color: '#172a40' },
  button: { backgroundColor: '#2960ad', borderRadius: 9, padding: 13, alignItems: 'center' },
  secondary: { backgroundColor: '#e6edf7' }, disabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14 }, secondaryText: { color: '#2b4e81' },
  error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10 }
});
