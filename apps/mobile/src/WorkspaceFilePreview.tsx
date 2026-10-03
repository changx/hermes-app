import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import type { Attachment } from '../../../packages/client/src/index';
import type { LiveSessionClient } from '../../../packages/client/src/liveClient';
import { Text } from './FontSize';
import { ImageViewer } from './Attachments';
import { MessageContent } from './MessageContent';
import { WorkspaceAction as Action, workspaceStyles as s } from './WorkspaceUI';

const textName = (name: string) => /\.(txt|md|csv|json|log|ya?ml|toml|py|[cm]?jsx?|tsx?|css|html?|sh)$/i.test(name);
const imageName = (name: string) => /\.(png|jpe?g|gif|webp)$/i.test(name);
function raster(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, i) => bytes[i] === value) ||
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ||
    ['GIF87a', 'GIF89a'].includes(String.fromCharCode(...bytes.slice(0, 6))) ||
    bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP');
}
export function WorkspaceFilePreview({ client, channelId, path, attachment, name, size }: {
  client: LiveSessionClient; channelId: string; path?: string; attachment?: Attachment; name: string; size: number;
}) {
  const [text, setText] = useState<string | null>(null), [uri, setUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const cache = useRef<File | null>(null);
  const image = imageName(name), readable = textName(name), allowed = image ? size <= 10 * 1024 * 1024 : readable && size <= 64 * 1024;
  useFocusEffect(useCallback(() => {
    let active = true;
    const controller = new AbortController();
    if (allowed) {
      setLoading(true); setError(''); setText(null); setUri(null);
      void (async () => {
        const bytes = attachment ? await client.download(attachment.thread_id, attachment.id, controller.signal)
          : await client.workspace.readFile(channelId, path!, controller.signal);
        if (!active) return;
        if (bytes.byteLength > (image ? 10 * 1024 * 1024 : 64 * 1024) || image && !raster(bytes)) throw new Error('Preview unavailable');
        const file = new File(Paths.cache, 'hermes-workspace-' + Crypto.randomUUID());
        cache.current = file; file.create(); file.write(bytes);
        if (image) setUri(file.uri);
        else { const value = await file.text(); if (active) setText(value); }
      })().catch(() => { if (active) setError('Could not preview this file. Refresh or try again.'); })
        .finally(() => { if (active) setLoading(false); });
    }
    return () => {
      active = false; controller.abort();
      const file = cache.current; cache.current = null;
      try { if (file?.exists) file.delete(); } catch { /* only this preview's private cache */ }
    };
  }, [client, channelId, path, attachment?.id, name, size, allowed, image, retry]));
  if (!allowed) return <View style={s.page}><Text style={s.hint}>This file is listed, but its format or size cannot be previewed in the app yet.</Text></View>;
  if (uri && image) return <ImageViewer uri={uri} />;
  return <View style={s.page}>
    {loading && <ActivityIndicator />}
    {!!error && <><Text accessibilityRole="alert" style={s.error}>{error}</Text><Action label="Try again" onPress={() => setRetry(value => value + 1)} /></>}
    {text !== null && <ScrollView contentContainerStyle={s.content}>
      {text && name.toLowerCase().endsWith('.md') ? <MessageContent text={text} /> : <Text selectable style={{ color: '#172a40', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 15, lineHeight: 22 }}>{text || 'This file is empty.'}</Text>}
    </ScrollView>}
  </View>;
}
