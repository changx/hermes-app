import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './FontSize';

export function WorkspaceAction({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={[workspaceStyles.action, disabled && workspaceStyles.disabled]}><Text style={workspaceStyles.actionText}>{label}</Text></Pressable>;
}
export function WorkspaceSetup({ busy, disabled = false, onSetup }: { busy: boolean; disabled?: boolean; onSetup: () => void }) {
  return <View style={workspaceStyles.setup}>
    <Text style={workspaceStyles.heading}>A shared space for this channel</Text>
    <Text style={workspaceStyles.hint}>Keep reference files and AGENTS.md guidelines here. Existing files elsewhere will not be moved.</Text>
    <WorkspaceAction label={busy ? 'Setting up…' : 'Set up channel files'} disabled={busy || disabled} onPress={onSetup} />
  </View>;
}
export const workspaceStyles = StyleSheet.create({
  page: { flex: 1, padding: 16, gap: 12 }, fill: { flex: 1 }, toolbar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heading: { color: '#172a40', fontSize: 17, fontWeight: '600' }, hint: { color: '#65758b', fontSize: 13, lineHeight: 19, flexShrink: 1 },
  action: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 10, justifyContent: 'center', borderRadius: 9, backgroundColor: '#e7eef8' },
  actionText: { color: '#2b4e81', fontWeight: '600' }, disabled: { opacity: 0.5 },
  error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10, borderRadius: 8 },
  setup: { gap: 16, paddingVertical: 16 }, actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' },
  editor: { flex: 1, minHeight: 0, backgroundColor: '#fff', borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 9,
    paddingHorizontal: 12, paddingVertical: 12, color: '#172a40', textAlignVertical: 'top' },
  content: { paddingBottom: 32 },
});
