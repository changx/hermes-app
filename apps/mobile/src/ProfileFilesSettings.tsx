import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { Text, TextInput } from './FontSize';
import { SettingsBlock, SettingsPage, SettingsRow, SettingsSection } from './SettingsUI';
import type { ProfileFile, ProfileFileKind } from '../../../packages/client/src/index';
import { PROFILE_FILE_MAX_CHARS, memoryUsed, profileFileSaveError } from '../../../packages/client/src/profileFiles';

export type ProfileFilesApi = {
  profileFiles(signal?: AbortSignal): Promise<ProfileFile[]>;
  saveProfileFile(kind: ProfileFileKind, content: string, version: string): Promise<ProfileFile>;
};

export const PROFILE_FILE_ABOUT: Record<ProfileFileKind, string> = {
  soul: 'How Hermes speaks and acts.',
  user: 'What Hermes knows about you.',
  memory: 'Notes that Hermes keeps for itself.',
};
const count = (value: number) => value.toLocaleString('en-US');
const errorOf = (error: unknown) => typeof error === 'object' && error !== null
  ? error as { status?: number; code?: string } : {};

/** Size of one file against its limit, or why Hermes does not use it. */
export function profileFileStatus(file: ProfileFile, text: string): string {
  if (file.kind === 'soul') return file.exists || text ? `${count(text.length)} characters` : 'Not created yet';
  const parts = [file.limit ? `${count(memoryUsed(text))} of ${count(file.limit)} characters` : `${count(memoryUsed(text))} characters`];
  if (file.enabled === false) parts.push('Turned off on this Hermes');
  return parts.join(' · ');
}

/** Settings > Persona & memory of one connection (docs/profile-files.md): the three files. */
export function ProfileFilesSettings({ client, onOpen, refresh = 0 }: { client: ProfileFilesApi; onOpen: (kind: ProfileFileKind) => void; refresh?: number }) {
  const [files, setFiles] = useState<ProfileFile[] | null>(null);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const load = useCallback(async () => {
    setError('');
    try { const result = await client.profileFiles(); if (alive.current) setFiles(result); }
    catch { if (alive.current) setError('Could not load these files. Check the connection and try again.'); }
  }, [client]);
  // `refresh` changes when the page is shown again, for example after a save in the editor.
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load, refresh]);
  return <SettingsPage>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <SettingsSection title="Persona & memory" footer="Hermes reads these files when a conversation starts. Changes apply to new conversations.">
      {files === null && !error && <SettingsBlock first><Text accessibilityLiveRegion="polite" style={styles.hint}>Loading…</Text></SettingsBlock>}
      {files?.map((file, index) => <SettingsRow key={file.kind} first={index === 0} title={file.name}
        detail={`${PROFILE_FILE_ABOUT[file.kind]} ${profileFileStatus(file, file.content)}`} onPress={() => onOpen(file.kind)} />)}
    </SettingsSection>
    {!!error && files === null && <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.button}><Text style={styles.buttonText}>Reload</Text></Pressable>}
  </SettingsPage>;
}

/**
 * Editor of one file. The text field fills the page and scrolls by itself, so the caret stays
 * above the keyboard. Save sends the version that was loaded; a change made meanwhile by the
 * agent or another device is refused, and the draft stays until the user loads the latest version.
 */
export function ProfileFileEditor({ client, kind }: { client: ProfileFilesApi; kind: ProfileFileKind }) {
  const [file, setFile] = useState<ProfileFile | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const load = useCallback(async () => {
    setError(''); setConflict(false);
    try {
      const found = (await client.profileFiles()).find(row => row.kind === kind) ?? null;
      if (!alive.current) return;
      setFile(found); setDraft(null);
      if (!found) setError('This file is not available on this Hermes.');
    } catch { if (alive.current) setError('Could not load this file. Check the connection and try again.'); }
  }, [client, kind]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);

  const text = draft ?? file?.content ?? '';
  const changed = file !== null && draft !== null && draft !== file.content;
  const over = file !== null && file.kind !== 'soul' && !!file.limit && memoryUsed(text) > file.limit && memoryUsed(text) > memoryUsed(file.content);
  const enabled = changed && !over && !busy;
  const save = async () => {
    if (!file || !enabled) return;
    setBusy(true); setError(''); setConflict(false); setNotice('');
    try {
      const saved = await client.saveProfileFile(file.kind, text, file.version);
      if (!alive.current) return;
      setFile(saved); setDraft(null); setNotice(`${file.name} saved. Hermes uses it in new conversations.`);
    } catch (failure) {
      if (!alive.current) return;
      const { status, code } = errorOf(failure);
      setError(profileFileSaveError(code, status, file.name, file.limit)); setConflict(status === 409);
    } finally { if (alive.current) setBusy(false); }
  };

  return <View style={styles.editorPage}>
    <Stack.Screen options={{ title: file?.name ?? '', gestureEnabled: !busy, headerBackVisible: !busy,
      headerRight: () => <Pressable accessibilityRole="button" accessibilityLabel={`Save ${file?.name ?? 'file'}`} accessibilityState={{ disabled: !enabled, busy }}
        disabled={!enabled} hitSlop={8} onPress={() => void save()} style={({ pressed }) => [styles.headerSave, pressed && styles.pressed]}>
        <Text style={[styles.headerSaveText, !enabled && styles.disabled]}>{busy ? 'Saving…' : 'Save'}</Text>
      </Pressable> }} />
    <View style={styles.editorHead}>
      {file && <Text style={styles.hint}>{PROFILE_FILE_ABOUT[file.kind]} {profileFileStatus(file, text)}{file.kind !== 'soul' ? '. Put § on its own line between two entries.' : ''}</Text>}
      {over && <Text accessibilityRole="alert" style={styles.error}>{file?.name} can hold {count(file?.limit ?? 0)} characters. Make the text shorter.</Text>}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {!!notice && <Text accessibilityLiveRegion="polite" style={styles.hint}>{notice}</Text>}
      {(conflict || (!file && !!error) || changed) && <View style={styles.actions}>
        {changed && <Pressable accessibilityRole="button" accessibilityLabel="Discard changes" disabled={busy} onPress={() => { setDraft(null); setError(''); setConflict(false); }}
          style={({ pressed }) => [styles.button, pressed && styles.pressed, busy && styles.disabled]}><Text style={styles.buttonText}>Discard changes</Text></Pressable>}
        {(conflict || !file) && <Pressable accessibilityRole="button" accessibilityLabel={file ? 'Load latest version' : 'Reload'} disabled={busy} onPress={() => void load()}
          style={({ pressed }) => [styles.button, pressed && styles.pressed, busy && styles.disabled]}><Text style={styles.buttonText}>{file ? 'Load latest version' : 'Reload'}</Text></Pressable>}
      </View>}
    </View>
    {file && <TextInput accessibilityLabel={file.name} value={text} multiline scrollEnabled textAlignVertical="top" editable={!busy}
      maxLength={PROFILE_FILE_MAX_CHARS} autoCapitalize="sentences" autoCorrect={file.kind !== 'soul'} smartInsertDelete={false}
      placeholder={file.kind === 'soul' ? 'Describe how Hermes should speak and act.' : 'One fact per entry. Put § on its own line between entries.'}
      placeholderTextColor="#8a98aa" onChangeText={value => { setDraft(value); setNotice(''); }} style={styles.editor} />}
  </View>;
}

const styles = StyleSheet.create({
  error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10, borderRadius: 8 },
  hint: { fontSize: 13, lineHeight: 19, color: '#607187' },
  editorPage: { flex: 1, backgroundColor: '#f2f5f9' },
  editorHead: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 8 },
  editor: { flex: 1, marginHorizontal: 12, marginBottom: 12, padding: 12, fontSize: 16, lineHeight: 22, color: '#172a40', backgroundColor: '#fff',
    borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: '#d5dde8' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' },
  button: { minHeight: 40, paddingHorizontal: 14, borderRadius: 9, backgroundColor: '#e6edf7', alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 14, color: '#2b4e81', fontWeight: '600' },
  headerSave: { minHeight: 36, paddingHorizontal: 8, borderRadius: 8, justifyContent: 'center' },
  headerSaveText: { color: '#2b4e81', fontSize: 17, fontWeight: '600' },
  pressed: { opacity: 0.8 }, disabled: { opacity: 0.45 },
});
