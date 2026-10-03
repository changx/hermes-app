import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import type { Attachment, WorkspaceEntry, WorkspaceState } from '../../../packages/client/src/index';
import type { LiveSessionClient } from '../../../packages/client/src/liveClient';
import { Text } from './FontSize';
import { useViewer } from './Viewers';
import { WorkspaceFilePreview } from './WorkspaceFilePreview';
import { WorkspaceAction as Action, WorkspaceSetup, workspaceStyles as s } from './WorkspaceUI';

type Row = { key: string; source: 'workspace'; file: WorkspaceEntry } | { key: string; source: 'attachment'; attachment: Attachment };
export function ChannelFilesScreen({ client, channelId, directory, onDirectory, onAgents }: {
  client: LiveSessionClient; channelId: string; directory: string; onDirectory: (path: string) => void; onAgents: () => void;
}) {
  const [mode, setMode] = useState<'workspace' | 'attachments'>('workspace');
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null), [items, setItems] = useState<Row[]>([]);
  const [after, setAfter] = useState<string | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const generation = useRef(0), focused = useRef(false), mounted = useRef(true), working = useRef(false), readController = useRef<AbortController | null>(null);
  const cursors = useRef(new Set<string>());
  const { openViewer } = useViewer();
  const supported = client.supportsChannelWorkspace === true, online = client.connectionState === 'online';
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = (version: number) => mounted.current && focused.current && generation.current === version;
  const page = async (cursor: string | null, signal?: AbortSignal) => {
    if (mode === 'attachments') {
      const result = await client.workspace.attachments(channelId, cursor, signal);
      return { rows: result.items.map(attachment => ({ key: 'attachment:' + attachment.id, source: 'attachment' as const, attachment })), next: result.nextAfter };
    }
    const result = await client.workspace.list(channelId, directory, cursor, signal);
    return { rows: result.items.map(file => ({ key: 'file:' + file.path, source: 'workspace' as const, file })), next: result.nextAfter };
  };
  useFocusEffect(useCallback(() => {
    focused.current = true;
    const version = ++generation.current, controller = new AbortController();
    readController.current = controller;
    setLoading(supported); setError(''); setWorkspace(null); setItems([]); setAfter(null); cursors.current.clear();
    if (supported) void (async () => {
      const state = await client.workspace.getState(channelId, controller.signal);
      if (!current(version)) return;
      const result = state.initialized || mode === 'attachments' ? await page(null, controller.signal) : { rows: [], next: null };
      if (!current(version)) return;
      setWorkspace(state); setItems(result.rows); setAfter(result.next);
    })().catch(() => { if (current(version)) setError('Could not load channel files. Try again.'); })
      .finally(() => { if (current(version)) setLoading(false); });
    return () => { focused.current = false; generation.current++; controller.abort(); };
  }, [client, channelId, directory, mode, supported, retry]));

  const setup = async () => {
    if (working.current || !focused.current || !supported || !online) return;
    const version = generation.current; working.current = true; setBusy(true); setError('');
    try { await client.workspace.initialize(channelId); if (current(version)) setRetry(value => value + 1); }
    catch { if (current(version)) setError('Could not set up channel files. Try again.'); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  const more = async () => {
    if (working.current || !focused.current || !after || !online) return;
    const version = generation.current, cursor = after; working.current = true; setBusy(true); setError('');
    try {
      if (cursors.current.has(cursor)) throw new Error('Listing changed');
      const result = await page(cursor, readController.current?.signal);
      if (!current(version)) return;
      const keys = new Set(items.map(item => item.key));
      if (result.rows.some(row => keys.has(row.key)) || result.next === cursor) throw new Error('Listing changed');
      cursors.current.add(cursor); setItems(old => [...old, ...result.rows]); setAfter(result.next);
    } catch { if (current(version)) setError('Could not load more files. Refresh or try again.'); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  usePreventRemove(busy, () => { /* let the bounded setup/pagination action settle before leaving */ });
  const open = (row: Row) => {
    if (busy || !focused.current || !supported) return;
    if (row.source === 'workspace') {
      const file = row.file;
      if (file.kind === 'unavailable') return;
      if (file.kind === 'directory') { onDirectory(file.path); return; }
      if (file.path === 'AGENTS.md') { onAgents(); return; }
      openViewer(file.name, <WorkspaceFilePreview client={client} channelId={channelId} path={file.path} name={file.name} size={file.size!} />);
    } else {
      const attachment = row.attachment;
      if (attachment.state !== 'available') return;
      openViewer(attachment.name || 'Attachment', <WorkspaceFilePreview client={client} channelId={channelId} attachment={attachment}
        name={attachment.name || 'Attachment'} size={attachment.size || 0} />);
    }
  };
  return <View style={s.page}>
    {!supported ? <Text style={s.hint}>Channel files are not available on this connection yet.</Text> : <>
      {!directory && <View style={s.toolbar}>
        <Action label="Workspace" disabled={loading || busy || mode === 'workspace'} onPress={() => setMode('workspace')} />
        <Action label="Attachments" disabled={loading || busy || mode === 'attachments'} onPress={() => setMode('attachments')} />
        <View style={s.fill} /><Action label="Refresh" disabled={loading || busy || !online} onPress={() => setRetry(value => value + 1)} />
      </View>}
      {!!directory && <Text selectable style={s.hint}>{directory}</Text>}
      {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      {loading ? <ActivityIndicator /> : workspace && mode === 'workspace' && !workspace.initialized ? <WorkspaceSetup busy={busy} disabled={!online} onSetup={() => void setup()} /> : workspace ? <>
        <Text style={s.hint}>{mode === 'attachments' ? 'Files shared in this channel’s conversations.' : 'Reference files and work saved in this channel’s workspace.'}</Text>
        <FlatList style={s.fill} data={items} keyExtractor={row => row.key} contentContainerStyle={s.content}
          renderItem={({ item }) => {
            const name = item.source === 'workspace' ? item.file.name : item.attachment.name || 'Unnamed attachment';
            const unavailable = item.source === 'workspace' ? item.file.kind === 'unavailable' : item.attachment.state !== 'available';
            const detail = unavailable ? 'Unavailable' : item.source === 'workspace' && item.file.kind === 'directory' ? 'Folder' : 'File';
            return <Pressable accessibilityRole="button" accessibilityLabel={name} disabled={busy || unavailable} onPress={() => open(item)}
              style={({ pressed }) => [f.row, pressed && f.pressed, unavailable && s.disabled]}>
              <Text style={[s.heading, s.fill]}>{name}</Text><Text style={s.hint}>{detail} {unavailable ? '' : '›'}</Text>
            </Pressable>;
          }} ListEmptyComponent={error ? null : <Text style={s.hint}>{mode === 'attachments' ? 'No shared attachments yet.' : 'No files in this folder yet.'}</Text>}
          ListFooterComponent={after ? <Action label={busy ? 'Loading…' : 'Load more'} disabled={busy || !online} onPress={() => void more()} /> : null} />
      </> : null}
      {!!error && !loading && <Action label="Try again" disabled={busy || !online} onPress={() => setRetry(value => value + 1)} />}
    </>}
  </View>;
}
const f = StyleSheet.create({ row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#e2e8f0' }, pressed: { backgroundColor: '#edf3fc' } });
