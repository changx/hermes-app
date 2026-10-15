import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './FontSize';
import * as SecureStore from 'expo-secure-store';

const DEFAULT_NAME = 'Agent';
const READ_ERROR = 'Could not read the display name on this device. Enter a new name to save it.';
const WRITE_ERROR = 'Could not save the name. Nothing changed. Try again.';
const INVALID_ERROR = 'Name contains unsupported characters.';
const LONG_ERROR = 'Display name must be 40 characters or fewer.';

// Hex-encode UTF-16 code units: injective for every JS connection ID, and SecureStore-safe.
const nameKey = (id: string) => `hermes.agent-name.${Array.from({ length: id.length }, (_, i) => id.charCodeAt(i).toString(16).padStart(4, '0')).join('')}`;
const forbidden = /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u206f]/u;
function normalize(value: string): string {
  if (forbidden.test(value)) throw new Error(INVALID_ERROR);
  const trimmed = value.trim();
  if (Array.from(trimmed).length > 40) throw new Error(LONG_ERROR);
  return trimmed;
}

type NameState = { id: string | null; name: string; ready: boolean; error: string; saving: boolean };
const empty = (id: string | null): NameState => ({ id, name: DEFAULT_NAME, ready: false, error: '', saving: false });

/** Local display preference only; does not change connection or server configuration. */
export function useAgentName(connectionId: string | null): {
  name: string; ready: boolean; error: string; saving: boolean; save: (value: string) => Promise<boolean>;
  reload: () => void;
} {
  const [state, setState] = useState<NameState>(() => empty(connectionId));
  const [retry, setRetry] = useState(0);
  const scope = useRef({ id: connectionId, epoch: 0, generation: 0 });
  const live = useRef(false);
  const readVersion = useRef(0);
  const pending = useRef<{ id: string; epoch: number; done: Promise<void>; finish: () => void } | null>(null);
  if (scope.current.id !== connectionId) {
    scope.current = { id: connectionId, epoch: scope.current.epoch + 1, generation: scope.current.generation + 1 };
    readVersion.current++;
  }
  // Mask the previous connection synchronously, before its load effect runs.
  const shown = state.id === connectionId ? state : empty(connectionId);
  const renderedGeneration = scope.current.generation;

  useEffect(() => {
    live.current = true;
    const id = connectionId;
    const epoch = scope.current.epoch;
    const version = ++readVersion.current;
    let active = true;
    setState(empty(id));
    if (id !== null) {
      // A quick A → B → A switch waits for A's in-flight write before reloading it.
      const prior = pending.current?.id === id ? pending.current.done : Promise.resolve();
      prior.then(() => active && scope.current.id === id && scope.current.epoch === epoch && readVersion.current === version
        ? SecureStore.getItemAsync(nameKey(id)) : null).then(value => {
        if (!active || scope.current.id !== id || scope.current.epoch !== epoch || readVersion.current !== version) return;
        const name = normalize(value ?? '') || DEFAULT_NAME;
        setState({ id, name, ready: true, error: '', saving: false });
      }).catch(() => {
        if (active && scope.current.id === id && scope.current.epoch === epoch && readVersion.current === version)
          setState({ id, name: DEFAULT_NAME, ready: false, error: READ_ERROR, saving: false });
      });
    }
    return () => {
      active = false;
      live.current = false;
      if (scope.current.id === id && scope.current.epoch === epoch) scope.current.epoch++;
      readVersion.current++;
    };
  }, [connectionId, retry]);

  const reload = () => {
    if (connectionId !== null && live.current && scope.current.generation === renderedGeneration && pending.current?.id !== connectionId)
      setRetry(n => n + 1);
  };
  const save = async (value: string): Promise<boolean> => {
    const id = connectionId;
    const epoch = scope.current.epoch;
    if (id === null || !live.current || scope.current.id !== id || scope.current.generation !== renderedGeneration || pending.current?.id === id) return false;
    let normalized: string;
    try { normalized = normalize(value); }
    catch (e) {
      setState(s => s.id === id ? { ...s, error: (e as Error).message } : s);
      return false;
    }
    ++readVersion.current; // A late cold read cannot overwrite a successful or failed edit.
    let finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    pending.current = { id, epoch, done, finish };
    setState(s => s.id === id ? { ...s, saving: true, error: '' } : { ...empty(id), saving: true });
    try {
      await SecureStore.setItemAsync(nameKey(id), normalized);
      if (scope.current.id !== id || scope.current.epoch !== epoch) return false;
      setState({ id, name: normalized || DEFAULT_NAME, ready: true, error: '', saving: false });
      return true;
    } catch {
      if (scope.current.id === id && scope.current.epoch === epoch)
        setState(s => s.id === id ? { ...s, saving: false, error: WRITE_ERROR } : s);
      return false;
    } finally {
      if (pending.current?.id === id && pending.current.epoch === epoch) pending.current = null;
      finish();
    }
  };
  // A stable object keeps connection-scope contexts unchanged between renders.
  // save/reload read only connectionId, renderedGeneration, refs and state setters.
  return useMemo(() => ({ name: shown.name, ready: shown.ready, error: shown.error, saving: shown.saving, save, reload }),
    [shown.name, shown.ready, shown.error, shown.saving, connectionId, renderedGeneration]);
}

type Props = {
  name: string; ready: boolean; error: string; saving: boolean;
  onSave(value: string): Promise<boolean>; onRetry?(): void;
};

/** Display name of one connection's Agent; a section inside that connection's settings. */
export function AgentNameSettings({ name, ready, error, saving, onSave, onRetry }: Props) {
  const [draft, setDraft] = useState(name === DEFAULT_NAME ? '' : name);
  const [saved, setSaved] = useState(false);
  const edited = useRef(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!edited.current && ready) setDraft(name === DEFAULT_NAME ? '' : name);
  }, [name, ready]);
  const submit = async () => {
    if (inFlight.current || saving || (!ready && !error) || (!ready && !edited.current)) return;
    inFlight.current = true; setSaved(false);
    try {
      if (await onSave(draft) && mounted.current) { edited.current = false; setSaved(true); }
    } finally { inFlight.current = false; }
  };
  const unchanged = ready && draft.trim() === (name === DEFAULT_NAME ? '' : name);
  const blocked = saving || unchanged || (!ready && (!error || !edited.current));
  return <View style={styles.section}>
    <Text style={styles.label}>Display name</Text>
    <TextInput accessibilityLabel="Display name" value={draft} onChangeText={value => { edited.current = true; setSaved(false); setDraft(value); }}
      placeholder="Agent" maxLength={80} autoCorrect={false} style={styles.input} editable={!saving} />
    <Text style={styles.hint}>Only changes how the Agent appears on this device for this connection. Leave blank to use Agent.</Text>
    {!!error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
    {!!error && !ready && onRetry && <Pressable accessibilityRole="button" accessibilityLabel="Retry loading" disabled={saving}
      onPress={onRetry} style={[styles.button, styles.secondary]}><Text style={styles.secondaryText}>Retry loading</Text></Pressable>}
    <Pressable accessibilityRole="button" accessibilityLabel="Save display name" accessibilityState={{ disabled: blocked }}
      disabled={blocked} onPress={() => { void submit(); }} style={[styles.button, blocked && styles.disabled]}>
      <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save name'}</Text>
    </Pressable>
    {saved && <Text accessibilityLiveRegion="polite" style={styles.hint}>Saved.</Text>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  label: { fontSize: 14, color: '#172a40' },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 10, minHeight: 44, padding: 12, color: '#172a40' },
  hint: { color: '#607187', fontSize: 13, lineHeight: 20 },
  error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10 },
  button: { backgroundColor: '#2960ad', borderRadius: 9, padding: 13, alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  secondary: { backgroundColor: '#e6edf7' }, disabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600' }, secondaryText: { color: '#2b4e81', fontWeight: '600' }
});
