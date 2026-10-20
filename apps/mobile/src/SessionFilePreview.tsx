import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import type { Attachment } from '../../../packages/client/src/index';
import type { LiveSessionClient } from '../../../packages/client/src/liveClient';
import { useSessionNavigation } from './sessionNavigation';
import { Text } from './FontSize';
import { FilePreview } from './FilePreview';
import { PREVIEW_MAX_BYTES, previewKind, previewSuffix, type PreviewKind } from './filePreviewKind';
import { WorkspaceAction as Action, workspaceStyles as s } from './WorkspaceUI';

// Only these image types are checked against their signature before display.
const rasterName = (name: string) => /\.(png|jpe?g|gif|webp)$/i.test(name);
function raster(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, i) => bytes[i] === value) ||
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ||
    ['GIF87a', 'GIF89a'].includes(String.fromCharCode(...bytes.slice(0, 6))) ||
    bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP');
}

/**
 * Preview of one Session file (a delivered file or an uploaded attachment). The bytes go to a
 * private cache file that is deleted when the viewer closes. `refSeq` is the message that
 * delivered or sent the file; "View in conversation" opens the Session there.
 */
export function SessionFilePreview({ client, attachment, refSeq }: { client: LiveSessionClient; attachment: Attachment; refSeq: number | null }) {
  const [preview, setPreview] = useState<{ uri: string; kind: PreviewKind } | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const cache = useRef<File | null>(null);
  const navigation = useSessionNavigation();
  const name = attachment.name || 'Attachment', size = attachment.size || 0;
  const origin = refSeq !== null
    ? <View style={s.toolbar}><Action label="View in conversation" onPress={() => navigation.thread(attachment.thread_id, refSeq)} /></View> : null;
  const declared = previewKind(name, attachment.mime), allowed = declared !== 'other' && size <= PREVIEW_MAX_BYTES;
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (allowed) {
      setLoading(true); setError(''); setPreview(null);
      void (async () => {
        const bytes = await client.workspace.readAttachment(attachment, controller.signal);
        if (!active) return;
        const kind = previewKind(name, attachment.mime, bytes);
        if (bytes.byteLength > PREVIEW_MAX_BYTES || kind === 'other' || kind === 'image' && rasterName(name) && !raster(bytes)) throw new Error('Preview unavailable');
        const file = new File(Paths.cache, 'hermes-session-file-' + Crypto.randomUUID() + previewSuffix(name));
        cache.current = file; file.create(); file.write(bytes);
        setPreview({ uri: file.uri, kind });
      })().catch(() => { if (active) setError('Could not preview this file. Try again.'); })
        .finally(() => { if (active) setLoading(false); });
    }
    return () => {
      active = false; controller.abort();
      const file = cache.current; cache.current = null;
      try { if (file?.exists) file.delete(); } catch { /* only this preview's private cache */ }
    };
  }, [client, attachment.id, attachment.thread_id, name, size, allowed, retry]);
  if (!allowed) return <View style={s.page}>{origin}<Text style={s.hint}>{size > PREVIEW_MAX_BYTES ? 'This file is too large to preview in the app.' : 'This file type cannot be previewed in the app yet.'}</Text></View>;
  if (preview) return <View style={{ flex: 1 }}>{origin}<FilePreview uri={preview.uri} kind={preview.kind} /></View>;
  return <View style={s.page}>{origin}
    {loading && <ActivityIndicator />}
    {!!error && <><Text accessibilityRole="alert" style={s.error}>{error}</Text><Action label="Try again" onPress={() => setRetry(value => value + 1)} /></>}
  </View>;
}
