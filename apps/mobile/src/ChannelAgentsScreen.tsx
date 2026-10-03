import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { useFocusEffect, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { HttpError, utf8Size, type AgentsDocument, type WorkspaceState } from '../../../packages/client/src/index';
import type { LiveSessionClient } from '../../../packages/client/src/liveClient';
import { Text, TextInput } from './FontSize';
import { MessageContent } from './MessageContent';
import { useViewer } from './Viewers';
import { WorkspaceAction as Action, WorkspaceSetup, workspaceStyles as s } from './WorkspaceUI';

const missing = (error: unknown) => error instanceof HttpError && error.status === 404;
export function ChannelAgentsScreen({ client, channelId }: { client: LiveSessionClient; channelId: string }) {
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [document, setDocument] = useState<AgentsDocument | null>(null), [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [conflict, setConflict] = useState(false), [retry, setRetry] = useState(0);
  const editingRef = useRef(false), working = useRef(false), focused = useRef(false), mounted = useRef(true), generation = useRef(0);
  const pending = useRef<{ content: string; previous: string | null } | null>(null);
  const navigation = useNavigation(), { openViewer } = useViewer();
  const supported = client.supportsChannelWorkspace === true, online = client.connectionState === 'online';
  const dirty = editing && draft !== (document?.content || '');
  let tooLong = false;
  try { tooLong = utf8Size(draft) > (workspace?.agentsBytes ?? 10 * 1024 * 1024); } catch { tooLong = true; }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const readDocument = async (signal?: AbortSignal): Promise<AgentsDocument | null> => {
    try { return await client.workspace.getAgents(channelId, signal); }
    catch (reason) { if (missing(reason)) return null; throw reason; }
  };
  useFocusEffect(useCallback(() => {
    focused.current = true;
    const version = ++generation.current, controller = new AbortController();
    if (!editingRef.current) {
      setLoading(supported); setError('');
      if (supported) void (async () => {
        const state = await client.workspace.getState(channelId, controller.signal);
        if (!focused.current || generation.current !== version) return;
        const saved = (state.agentsAvailable ?? state.initialized) ? await readDocument(controller.signal) : null;
        if (!focused.current || generation.current !== version) return;
        setWorkspace(state); setDocument(saved); setDraft(saved?.content || '');
      })().catch(() => {
        if (focused.current && generation.current === version) setError('Could not open the channel guidelines. Try again.');
      }).finally(() => { if (focused.current && generation.current === version) setLoading(false); });
    }
    return () => { focused.current = false; generation.current++; controller.abort(); };
  }, [client, channelId, supported, retry]));

  const current = (version: number) => mounted.current && focused.current && generation.current === version;
  const accept = (saved: AgentsDocument) => {
    setDocument(saved); setDraft(saved.content); setEditing(false); editingRef.current = false;
    pending.current = null; setConflict(false); setError('');
  };
  const setup = async () => {
    if (working.current || !focused.current || !supported || !online) return;
    const version = generation.current; working.current = true; setBusy(true); setError('');
    try {
      const state = await client.workspace.initialize(channelId);
      const saved = await readDocument();
      if (current(version)) { setWorkspace(state); setDocument(saved); setDraft(saved?.content || ''); }
    } catch { if (current(version)) setError('Could not set up channel files. Try again.'); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  const save = async () => {
    if (working.current || !focused.current || !supported || !online || !(workspace?.agentsAvailable ?? workspace?.initialized) || tooLong || !dirty || conflict) return;
    const version = generation.current, content = draft, previous = document?.etag ?? null;
    working.current = true; setBusy(true); setError('');
    try {
      if (pending.current) {
        // Lost response: verify the old attempted bytes first. Never replace
        // another writer by automatically fetching and using a newer ETag.
        const saved = await readDocument();
        if (!current(version)) return;
        if (saved?.content === pending.current.content) {
          pending.current = null;
          if (content === saved.content) { accept(saved); return; }
          setDocument(saved); // confirmed prior save, but a newer local draft stays editable
          setError('Your earlier changes were saved. Save again to keep your latest edits.');
          return;
        }
        if ((saved?.etag ?? null) !== pending.current.previous) {
          setConflict(true); setError('The saved guidelines have changed. Your text is kept. Review the saved version.'); return;
        }
        pending.current = null;
      }
      pending.current = { content, previous };
      const saved = await client.workspace.saveAgents(channelId, content, previous);
      if (current(version)) accept(saved);
    } catch (reason) {
      if (!current(version)) return;
      if (reason instanceof HttpError && reason.status === 412) {
        setConflict(true); setError('The saved guidelines have changed. Your text is kept. Review the saved version.');
      } else setError('Could not confirm your changes were saved. Your text is kept. Try again when connected.');
    } finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  const discard = () => {
    setDraft(document?.content || ''); setEditing(false); editingRef.current = false;
    pending.current = null; setConflict(false); setError('');
    setRetry(value => value + 1);
  };
  const cancel = () => {
    if (!dirty) { discard(); return; }
    Alert.alert('Discard changes?', 'Your guidelines have not been saved.', [
      { text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: discard },
    ]);
  };
  usePreventRemove(dirty || busy, ({ data }) => {
    if (working.current) return;
    Alert.alert('Discard changes?', 'Your guidelines have not been saved.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => { discard(); navigation.dispatch(data.action); } },
    ]);
  });
  const review = async () => {
    if (working.current || !focused.current || !supported || !online) return;
    const version = generation.current; working.current = true; setBusy(true);
    try {
      const saved = await readDocument();
      if (current(version)) openViewer('Saved AGENTS.md', <ScrollView contentContainerStyle={{ padding: 16 }}>
        {saved?.content ? <MessageContent text={saved.content} /> : <Text>No saved guidelines.</Text>}
      </ScrollView>);
    } catch { if (current(version)) setError('Could not read the saved guidelines. Your draft is kept.'); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  const useSaved = () => Alert.alert('Replace your draft?', 'Your unsaved text will be replaced with the saved guidelines.', [
    { text: 'Keep editing', style: 'cancel' }, { text: 'Use saved version', style: 'destructive', onPress: () => void (async () => {
      if (working.current || !focused.current || !supported || !online) return;
      const version = generation.current; working.current = true; setBusy(true);
      try { const saved = await readDocument(); if (current(version)) { setDocument(saved); setDraft(saved?.content || ''); pending.current = null; setConflict(false); setError(''); } }
      catch { if (current(version)) setError('Could not read the saved guidelines. Your draft is kept.'); }
      finally { working.current = false; if (mounted.current) setBusy(false); }
    })() },
  ]);

  return <View style={s.page}>
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {!supported && <Text style={s.hint}>Channel files are not available on this connection yet.</Text>}
    {loading ? <ActivityIndicator /> : editing ? <>
      <Text style={s.hint}>Working guidelines for this channel.</Text>
      <TextInput accessibilityLabel="AGENTS.md guidelines" placeholder="How should work in this channel be done?" value={draft} onChangeText={setDraft}
        multiline editable={!busy} style={s.editor} />
      <Text style={s.hint}>Saved guidelines are available to new sessions. Existing conversations do not change.</Text>
      {tooLong && <Text accessibilityRole="alert" style={s.error}>These guidelines are too long or contain an unsupported character. Shorten them before saving.</Text>}
      {!online && <Text style={s.hint}>Your draft is kept while the connection recovers.</Text>}
      {conflict && <View style={s.actions}><Action label="Review saved version" disabled={busy || !online || !supported} onPress={() => void review()} />
        <Action label="Use saved version" disabled={busy || !online || !supported} onPress={useSaved} /></View>}
      <View style={s.actions}><Action label="Cancel" disabled={busy} onPress={cancel} />
        <Action label={busy ? 'Saving…' : 'Save'} disabled={busy || !online || !supported || tooLong || !dirty || conflict} onPress={() => void save()} /></View>
    </> : supported && workspace ? !(workspace.agentsAvailable ?? workspace.initialized) ? <WorkspaceSetup busy={busy} disabled={!online} onSetup={() => void setup()} /> : <>
      <View style={s.toolbar}><Text style={[s.hint, s.fill]}>Long-term working guidelines, separate from channel context.</Text>
        <Action label={document ? 'Edit' : 'Add guidelines'} disabled={busy || !online} onPress={() => { editingRef.current = true; setEditing(true); setError(''); }} /></View>
      <ScrollView style={s.fill} contentContainerStyle={s.content}>
        {document?.content ? <MessageContent text={document.content} /> : <Text style={s.hint}>{document ? 'These guidelines are empty.' : 'No channel guidelines yet.'}</Text>}
      </ScrollView>
      <Text style={s.hint}>Saved guidelines are available to new sessions. Existing conversations do not change.</Text>
    </> : null}
    {!!error && !editing && !loading && <Action label="Try again" disabled={busy} onPress={() => setRetry(value => value + 1)} />}
  </View>;
}
