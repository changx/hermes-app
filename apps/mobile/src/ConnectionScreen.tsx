import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

interface Props {
  base: string;
  onBase(value: string): void;
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
    <Text style={styles.heading}>{props.connected ? '连接设置' : '连接你的 Hermes'}</Text>
    {!showPairing ? <>
      <Text selectable style={styles.text}>{props.base}</Text>
      <Text style={styles.text}>此设备已保存连接。断网或重新打开后会自动恢复。</Text>
      <Action title="返回聊天" onPress={props.onBack} />
      <Action title="配对其他连接" onPress={() => setReplacing(true)} secondary />
      <Action title="移除此设备的本机连接" onPress={props.onForget} secondary />
    </> : <>
      <Text style={styles.caption}>服务器地址</Text>
      <TextInput accessibilityLabel="服务器地址" style={styles.input} autoCapitalize="none" autoCorrect={false}
        keyboardType="url" value={props.base} onChangeText={props.onBase} editable={!props.busy} />
      <Text style={styles.caption}>一次性配对码</Text>
      <TextInput accessibilityLabel="一次性配对码" style={styles.input} autoCapitalize="characters" autoCorrect={false}
        value={props.code} onChangeText={props.onCode} editable={!props.busy} placeholder="输入管理员提供的配对码" />
      <Text style={styles.text}>首次连接需要管理员授权。配对后，此设备会安全保存连接，日常使用无需重复输入。</Text>
      <Action title={props.busy ? '正在配对…' : '配对并连接'} disabled={props.busy || !props.code.trim()} onPress={props.onPair} />
      {props.connected && <Action title="返回原连接" onPress={props.onBack} secondary disabled={props.busy} />}
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
