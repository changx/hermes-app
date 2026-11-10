import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './FontSize';
import type { VaultPrompt, VaultPromptAnswer } from '../../../packages/client/src/index';

/** ok: sent; invalid: the server rejected a value (the card stays open); failed: the prompt is gone. */
export type VaultAnswerResult = 'ok' | 'invalid' | 'failed';

const host = (origin: string) => origin.replace(/^https?:\/\//, '');

/**
 * In-chat vault prompt (docs/vault.md): Hermes waits for a login to save or a
 * one-time code. Values stay in this component until sent once, then are cleared.
 */
export function VaultPromptCard({ prompt, busy, onAnswer, onFocusChange }: {
  prompt: VaultPrompt; busy: boolean;
  onAnswer(prompt: VaultPrompt, answer: VaultPromptAnswer): Promise<VaultAnswerResult | void>;
  onFocusChange(key: string, focused: boolean): void;
}) {
  const [identifier, setIdentifier] = useState(prompt.identifier ?? '');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [showOtp, setShowOtp] = useState(false);
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const focus = (field: string) => ({
    onFocus: () => onFocusChange(`vault:${prompt.id}:${field}`, true),
    onBlur: () => onFocusChange(`vault:${prompt.id}:${field}`, false),
  });
  const send = async (answer: VaultPromptAnswer) => {
    if (sending) return;
    setSending(true); setInvalid(false);
    let result: VaultAnswerResult | void = 'failed';
    try { result = await onAnswer(prompt, answer); }
    finally {
      if (result === 'invalid') setInvalid(true);
      else { setIdentifier(''); setPassword(''); setOtp(''); setCode(''); }
      setSending(false);
    }
  };
  const disabled = busy || sending;
  const button = (title: string, onPress: () => void, off: boolean, primary = false, label = title) =>
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={off} onPress={onPress}
      style={[styles.button, primary ? styles.primary : styles.secondary, off && styles.disabled]}>
      <Text style={[styles.buttonText, primary && styles.primaryText]}>{title}</Text>
    </Pressable>;
  if (prompt.kind === 'save_login') {
    const ready = !!identifier.trim() && !!password;
    const matches = prompt.update ? [] : prompt.matches ?? [];
    return <View style={styles.card} accessibilityLabel={prompt.update ? `Update your ${prompt.site} login` : `Save your ${prompt.site} login`}>
      <Text style={styles.title}>{prompt.update ? `Update your ${prompt.site} login` : `Save your ${prompt.site} login?`}</Text>
      <Text style={styles.hint}>{prompt.update
        ? 'The saved password did not work. Enter the current one; it replaces the saved login.'
        : 'Hermes signs in for you. The password is saved encrypted on your Hermes and the Agent never sees it.'}</Text>
      {matches.map(match => <View key={match.id} style={styles.match}>
        <Text numberOfLines={1} style={[styles.hint, styles.matchText]}>{[match.identifier, host(match.origin)].filter(Boolean).join(' · ')}</Text>
        {button('Use', () => { void send({ decision: 'use', item_id: match.id }); }, disabled, true, `Use saved login ${match.identifier} for ${host(match.origin)}`)}
      </View>)}
      {matches.length > 0 && <Text style={styles.hint}>Or enter another login:</Text>}
      <TextInput accessibilityLabel="Email or username" placeholder="Email or username" value={identifier} onChangeText={setIdentifier}
        autoCapitalize="none" autoCorrect={false} textContentType="username" autoComplete="username" maxLength={320}
        editable={!disabled} style={styles.input} {...focus('identifier')} />
      <TextInput accessibilityLabel="Password" placeholder="Password" value={password} onChangeText={setPassword}
        secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="password" autoComplete="current-password" maxLength={1024}
        editable={!disabled} style={styles.input} {...focus('password')} />
      {showOtp ? <TextInput accessibilityLabel="Authenticator key (optional)" placeholder="Authenticator key (optional)" value={otp}
        onChangeText={value => { setOtp(value); setInvalid(false); }} secureTextEntry autoCapitalize="characters" autoCorrect={false} maxLength={512}
        editable={!disabled} style={[styles.input, invalid && styles.inputError]} {...focus('otp')} />
        : <Pressable accessibilityRole="button" accessibilityLabel="Add authenticator key" disabled={disabled} onPress={() => setShowOtp(true)}>
          <Text style={styles.link}>Add authenticator key</Text>
        </Pressable>}
      {invalid && <Text accessibilityRole="alert" style={styles.error}>This authenticator key cannot be used. Paste the setup key or otpauth:// link the website showed, or leave it empty.</Text>}
      <View style={styles.row}>
        {button("Don't save", () => { void send({ decision: 'decline' }); }, disabled)}
        {button(prompt.update ? 'Update & sign in' : 'Save & sign in', () => { void send({ decision: 'submit', identifier: identifier.trim(), password, ...(otp.trim() ? { otp_secret: otp.trim() } : {}) }); }, disabled || !ready, true)}
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
  inputError: { borderColor: '#b42335' },
  error: { fontSize: 13, lineHeight: 18, color: '#9d1b32' },
  link: { fontSize: 13, color: '#2960ad', fontWeight: '600', paddingVertical: 4 },
  match: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 9, paddingLeft: 12, paddingRight: 4, paddingVertical: 4 },
  matchText: { flex: 1, minWidth: 0, color: '#172a40' },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  button: { minHeight: 38, paddingHorizontal: 14, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: '#2960ad' }, secondary: { backgroundColor: '#e1e8f2' },
  buttonText: { fontSize: 14, fontWeight: '600', color: '#2b4e81' }, primaryText: { color: '#fff' },
  disabled: { opacity: 0.5 },
});
