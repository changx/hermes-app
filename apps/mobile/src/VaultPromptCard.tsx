import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './FontSize';
import type { VaultPrompt, VaultPromptAnswer } from '../../../packages/client/src/index';

/**
 * In-chat vault prompt (docs/vault.md): Hermes waits for a login to save or a
 * one-time code. Values stay in this component until sent once, then are cleared.
 */
export function VaultPromptCard({ prompt, busy, onAnswer, onFocusChange }: {
  prompt: VaultPrompt; busy: boolean;
  onAnswer(prompt: VaultPrompt, answer: VaultPromptAnswer): Promise<void>;
  onFocusChange(key: string, focused: boolean): void;
}) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const focus = (field: string) => ({
    onFocus: () => onFocusChange(`vault:${prompt.id}:${field}`, true),
    onBlur: () => onFocusChange(`vault:${prompt.id}:${field}`, false),
  });
  const send = async (answer: VaultPromptAnswer) => {
    if (sending) return;
    setSending(true);
    try { await onAnswer(prompt, answer); }
    finally { setIdentifier(''); setPassword(''); setCode(''); setSending(false); }
  };
  const disabled = busy || sending;
  const button = (title: string, onPress: () => void, off: boolean, primary = false) =>
    <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={off} onPress={onPress}
      style={[styles.button, primary ? styles.primary : styles.secondary, off && styles.disabled]}>
      <Text style={[styles.buttonText, primary && styles.primaryText]}>{title}</Text>
    </Pressable>;
  if (prompt.kind === 'save_login') {
    const ready = !!identifier.trim() && !!password;
    return <View style={styles.card} accessibilityLabel={`Save your ${prompt.site} login`}>
      <Text style={styles.title}>Save your {prompt.site} login?</Text>
      <Text style={styles.hint}>Hermes signs in for you. The password is saved encrypted on your Hermes and the Agent never sees it.</Text>
      <TextInput accessibilityLabel="Email or username" placeholder="Email or username" value={identifier} onChangeText={setIdentifier}
        autoCapitalize="none" autoCorrect={false} textContentType="username" autoComplete="username" maxLength={320}
        editable={!disabled} style={styles.input} {...focus('identifier')} />
      <TextInput accessibilityLabel="Password" placeholder="Password" value={password} onChangeText={setPassword}
        secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="password" autoComplete="current-password" maxLength={1024}
        editable={!disabled} style={styles.input} {...focus('password')} />
      <View style={styles.row}>
        {button("Don't save", () => { void send({ decision: 'decline' }); }, disabled)}
        {button('Save & sign in', () => { void send({ decision: 'submit', identifier: identifier.trim(), password }); }, disabled || !ready, true)}
      </View>
    </View>;
  }
  const clean = code.replace(/[\s-]/g, '');
  return <View style={styles.card} accessibilityLabel={`Verification code for ${prompt.site}`}>
    <Text style={styles.title}>Verification code for {prompt.site}</Text>
    <Text style={styles.hint}>{prompt.hint ? `${prompt.hint} ` : ''}Hermes enters the code on the page. The Agent never sees it.</Text>
    <TextInput accessibilityLabel="Verification code" placeholder="Code" value={code} onChangeText={setCode}
      keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" autoCorrect={false} maxLength={16}
      editable={!disabled} style={styles.input} {...focus('code')} />
    <View style={styles.row}>
      {button('Cancel', () => { void send({ decision: 'decline' }); }, disabled)}
      {button('Enter code', () => { void send({ decision: 'submit', code: clean }); }, disabled || !/^[0-9A-Za-z]{3,12}$/.test(clean), true)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#eef4ff', paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderColor: '#cfdcf3', gap: 7 },
  title: { fontSize: 15, fontWeight: '600', color: '#172a40' },
  hint: { fontSize: 13, lineHeight: 18, color: '#4d5f75' },
  input: { fontSize: 16, minHeight: 42, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 9, color: '#172a40', backgroundColor: '#fff' },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  button: { minHeight: 38, paddingHorizontal: 14, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: '#2960ad' }, secondary: { backgroundColor: '#e1e8f2' },
  buttonText: { fontSize: 14, fontWeight: '600', color: '#2b4e81' }, primaryText: { color: '#fff' },
  disabled: { opacity: 0.5 },
});
