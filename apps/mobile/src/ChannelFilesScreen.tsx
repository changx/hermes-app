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
  const cursors = useRef(new Set<string>()), refreshing = useRef(false);
  const scene = useRef<{ client: LiveSessionClient; channelId: string; directory: string; mode: string; rows: Row[]; state: WorkspaceState } | null>(null);
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
    const previous = scene.current;
    const retained = supported && previous?.client === client && previous.channelId === channelId && previous.directory === directory && previous.mode === mode ? previous : null;
    refreshing.current = supported;
    setLoading(supported && !retained); setError('');
    if (!retained) { scene.current = null; setWorkspace(null); setItems([]); setAfter(null); cursors.current.clear(); }
    if (supported) void (async () => {
      const state = await client.workspace.getState(channelId, controller.signal);
      if (!current(version)) return;
      const rows: Row[] = [], seen = new Set<string>(), readCursors = new Set<string>();
      let next: string | null = null;
      if (state.initialized || mode === 'attachments') do {
        const result = await page(next, controller.signal);
        if (!current(version)) return;
        for (const row of result.rows) {
          if (seen.has(row.key)) throw new Error('Listing changed');
          seen.add(row.key); rows.push(row);
        }
        next = result.next;
        if (next !== null && readCursors.has(next)) throw new Error('Listing changed');
        if (next !== null) readCursors.add(next);
      } while (next !== null && rows.length < (retained?.rows.length ?? 0));
      if (!current(version)) return;
      // Publish atomically after re-reading the loaded window. Unchanged rows and
      // the list stay mounted; focus/refresh must not reset the reading position.
      const old = new Map(retained?.rows.map(row => [row.key, row]));
      const stable = rows.map(row => { const prior = old.get(row.key); return prior && JSON.stringify(prior) === JSON.stringify(row) ? prior : row; });
      const unchanged = retained && stable.length === retained.rows.length && stable.every((row, index) => row === retained.rows[index]);
      const resultRows = unchanged ? retained.rows : stable;
      scene.current = { client, channelId, directory, mode, rows: resultRows, state };
      cursors.current = readCursors;
      // The next cursor has not been consumed yet.
      if (next !== null) cursors.current.delete(next);
      setWorkspace(retained && JSON.stringify(retained.state) === JSON.stringify(state) ? retained.state : state);
      setItems(resultRows); setAfter(next);
    })().catch(() => { if (current(version)) setError(retained ? 'Could not refresh channel files. Showing the previous list.' : 'Could not load channel files. Try again.'); })
      .finally(() => { if (current(version)) { refreshing.current = false; setLoading(false); } });
    return () => { focused.current = false; generation.current++; refreshing.current = false; controller.abort(); };
  }, [client, channelId, directory, mode, supported, retry]));

  const setup = async () => {
    if (working.current || !focused.current || !supported || !online) return;
    const version = generation.current; working.current = true; setBusy(true); setError('');
    try { await client.workspace.initialize(channelId); if (current(version)) setRetry(value => value + 1); }
    catch { if (current(version)) setError('Could not set up channel files. Try again.'); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  const more = async () => {
    if (working.current || refreshing.current || !focused.current || !after || !online) return;
    const version = generation.current, cursor = after; working.current = true; setBusy(true); setError('');
    try {
      if (cursors.current.has(cursor)) throw new Error('Listing changed');
      const result = await page(cursor, readController.current?.signal);
      if (!current(version)) return;
      const keys = new Set(items.map(item => item.key));
      if (result.rows.some(row => keys.has(row.key)) || result.next === cursor) throw new Error('Listing changed');
      const rows = [...items, ...result.rows];
      if (scene.current) scene.current.rows = rows;
      cursors.current.add(cursor); setItems(rows); setAfter(result.next);
    } catch { if (current(version)) setError('Could not load more files. Refresh or try again.'); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  usePreventRemove(busy, () => { /* let the bounded setup/pagination action settle before leaving */ });
  const open = useCallback((row: Row) => {
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
  }, [busy, supported, client, channelId, onDirectory, onAgents, openViewer]);
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
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          renderItem={({ item }) => <FileRow row={item} busy={busy} onOpen={open} />}
          ListEmptyComponent={error ? null : <Text style={s.hint}>{mode === 'attachments' ? 'No shared attachments yet.' : 'No files in this folder yet.'}</Text>}
          ListFooterComponent={after ? <Action label={busy ? 'Loading…' : 'Load more'} disabled={busy || !online} onPress={() => void more()} /> : null} />
      </> : null}
      {!!error && !loading && <Action label="Try again" disabled={busy || !online} onPress={() => setRetry(value => value + 1)} />}
    </>}
  </View>;
}
const FileRow = React.memo(function FileRow({ row, busy, onOpen }: { row: Row; busy: boolean; onOpen: (row: Row) => void }) {
  const name = row.source === 'workspace' ? row.file.name : row.attachment.name || 'Unnamed attachment';
  const unavailable = row.source === 'workspace' ? row.file.kind === 'unavailable' : row.attachment.state !== 'available';
  const detail = unavailable ? 'Unavailable' : row.source === 'workspace' && row.file.kind === 'directory' ? 'Folder' : 'File';
  return <Pressable accessibilityRole="button" accessibilityLabel={name} disabled={busy || unavailable} onPress={() => onOpen(row)}
    style={({ pressed }) => [f.row, pressed && f.pressed, unavailable && s.disabled]}>
    <Text style={[s.heading, s.fill]}>{name}</Text><Text style={s.hint}>{detail} {unavailable ? '' : '›'}</Text>
  </Pressable>;
});
const f = StyleSheet.create({ row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#e2e8f0' }, pressed: { backgroundColor: '#edf3fc' } });
