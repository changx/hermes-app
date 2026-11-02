import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import type { SessionFile, SessionFileList } from '../../../packages/client/src/index';
import type { LiveSessionClient } from '../../../packages/client/src/liveClient';
import { Text } from './FontSize';
import { useViewer } from './Viewers';
import { SessionFilePreview } from './SessionFilePreview';
import { WorkspaceAction as Action, workspaceStyles as s } from './WorkspaceUI';

const TABS: readonly { list: SessionFileList; title: string; empty: string }[] = [
  { list: 'delivered', title: 'Files', empty: 'The Agent has not delivered files in this session.' },
  { list: 'uploaded', title: 'Attachments', empty: 'You have not sent files in this session.' },
];
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const date = (seconds: number) => new Date(seconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * Session files: what the Agent delivered (MEDIA:) and what the user sent in this Session.
 * Newest first. A tap previews an available file; a missing file stays listed with its name.
 */
export function SessionFilesScreen({ client, threadId }: { client: LiveSessionClient; threadId: string }) {
  const [list, setList] = useState<SessionFileList>('delivered');
  const [items, setItems] = useState<SessionFile[]>([]), [after, setAfter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const { openViewer } = useViewer();
  const online = client.connectionState === 'online';
  useEffect(() => {
    const version = ++generation.current, controller = new AbortController();
    setLoading(true); setError(''); setItems([]); setAfter(null);
    void client.files.list(threadId, list, null, controller.signal)
      .then(page => { if (version === generation.current) { setItems(page.items); setAfter(page.nextAfter); } })
      .catch(() => { if (version === generation.current) setError('Could not load the files. Try again.'); })
      .finally(() => { if (version === generation.current) setLoading(false); });
    return () => { generation.current++; controller.abort(); };
  }, [client, threadId, list, retry]);
  const more = async () => {
    if (busy || !after) return;
    const version = generation.current; setBusy(true); setError('');
    try {
      const page = await client.files.list(threadId, list, after);
      if (version !== generation.current) return;
      const seen = new Set(items.map(item => item.id));
      if (page.items.some(item => seen.has(item.id))) throw new Error('Listing changed');
      setItems([...items, ...page.items]); setAfter(page.nextAfter);
    } catch { if (version === generation.current) setError('Could not load more files. Try again.'); }
    finally { setBusy(false); }
  };
  const open = useCallback((file: SessionFile) => {
    if (file.state !== 'available') return;
    openViewer(file.name || 'File', <SessionFilePreview client={client} attachment={file} refSeq={file.ref_seq} />);
  }, [client, openViewer]);
  const tab = TABS.find(t => t.list === list)!;
  return <View style={s.page}>
    <View style={s.toolbar} accessibilityRole="tablist">
      {TABS.map(t => <Action key={t.list} label={t.title} disabled={loading || busy || t.list === list} onPress={() => setList(t.list)} />)}
    </View>
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {loading ? <ActivityIndicator /> : <FlatList style={s.fill} data={items} keyExtractor={item => item.id} contentContainerStyle={s.content}
      renderItem={({ item }) => <FileRow file={item} onOpen={open} />}
      ListEmptyComponent={error ? undefined : <Text style={s.hint}>{tab.empty}</Text>}
      ListFooterComponent={after ? <Action label={busy ? 'Loading…' : 'Load more'} disabled={busy || !online} onPress={() => void more()} /> : undefined} />}
    {!!error && !loading && <Action label="Try again" disabled={busy} onPress={() => setRetry(value => value + 1)} />}
  </View>;
}

const FileRow = React.memo(function FileRow({ file, onOpen }: { file: SessionFile; onOpen: (file: SessionFile) => void }) {
  const missing = file.state !== 'available', name = file.name || 'Unnamed file';
  const detail = missing ? 'No longer available' : `${size(file.size ?? 0)} · ${date(file.created_at)}`;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${name}, ${detail}`} disabled={missing} onPress={() => onOpen(file)}
    style={({ pressed }) => [f.row, pressed && f.pressed, missing && s.disabled]}>
    <View style={s.fill}>
      <Text numberOfLines={2} style={s.heading}>{name}</Text>
      {!!file.caption && <Text numberOfLines={2} style={s.hint}>{file.caption}</Text>}
      <Text style={s.hint}>{detail}</Text>
    </View>
    {!missing && <Text style={s.hint}>›</Text>}
  </Pressable>;
});
const f = StyleSheet.create({ row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#e2e8f0' }, pressed: { backgroundColor: '#edf3fc' } });
