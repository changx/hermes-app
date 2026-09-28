import React, { useEffect, useRef, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from './FontSize';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import { toByteArray } from 'base64-js';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Attachment, HermesClient } from '../../../packages/client/src/index';
import { chooseAttachments, draftBusy, isImage, MAX_ATTACHMENT_BYTES, readableText, uploadedInOrder } from './attachmentHelpers';
import type { DraftAttachment, PickedAttachment } from './attachmentHelpers';
import { useViewer } from './Viewers';

const friendlyFailure = 'Upload failed. The file is still here. Retry or remove it.';
let fileSequence = 0;
function ownedFile(): File { return new File(Paths.cache, `hermes-attachment-${Date.now()}-${++fileSequence}`); }
function forgetFile(file: File) { try { if (file.exists) file.delete(); } catch { /* cache cleanup is best effort */ } }
function Action({ label, title = label, onPress, disabled = false }: { label: string; title?: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={[styles.action, disabled && styles.disabled]}><Text style={styles.actionText}>{title}</Text></Pressable>;
}

function ImageViewer({ uri }: { uri: string }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [scale, setScale] = useState(1);
  return <View style={styles.viewer}>
    <ScrollView style={styles.zoom} contentContainerStyle={styles.zoomContent} minimumZoomScale={1} maximumZoomScale={4} centerContent>
      <Image source={{ uri }} resizeMode="contain" style={{ width: width * scale, height: (height - insets.top - insets.bottom - 70) * scale }} />
    </ScrollView>
    {Platform.OS !== 'ios' && <View style={styles.controls}>
      <Action label="Zoom out" onPress={() => setScale(Math.max(1, scale / 1.5))} />
      <Action label="Zoom in" onPress={() => setScale(Math.min(4, scale * 1.5))} />
    </View>}
  </View>;
}

// Row-owned files can disappear while a Stack route is still visible. Copy on
// demand and transfer only this copy's lifecycle to the viewer's onClose.
async function openImage(uri: string, title: string, openViewer: ReturnType<typeof useViewer>['openViewer'], stillValid: () => boolean) {
  const file = ownedFile();
  try {
    await new File(uri).copy(file);
    if (!stillValid()) { forgetFile(file); return; }
    openViewer(title, <ImageViewer uri={file.uri} />, () => forgetFile(file));
  } catch (error) { forgetFile(file); throw error; }
}

export type AttachmentComposerHandle = {
  uploadTo: (threadId: string) => Promise<Attachment[]>;
  discardFrom: (threadId: string) => Promise<void>;
};

/** Ready server metadata reaches onChange. With no threadId, files stay local until uploadTo(). */
export function AttachmentComposer({ client, threadId, onChange, onPasteText, clearKey, children, onComposerHeight, onSelectionChange, handleRef, disabled = false }: {
  client: HermesClient; threadId: string | null; onChange: (attachments: Attachment[], busy: boolean) => void; onPasteText: (text: string) => void; clearKey: number; children?: React.ReactNode; onComposerHeight?: (height: number) => void; onSelectionChange?: (count: number) => void; handleRef?: React.MutableRefObject<AttachmentComposerHandle | null>; disabled?: boolean;
}) {
  const [items, setItems] = useState<DraftAttachment[]>([]);
  const [notice, setNotice] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const { openViewer } = useViewer();
  const itemsRef = useRef(items), callbacks = useRef(onChange), selectionCallback = useRef(onSelectionChange), epoch = useRef(0), nextKey = useRef(0);
  const controllers = useRef(new Map<number, AbortController>()), owned = useRef(new Map<number, File>());
  const identity = useRef({ client, threadId, clearKey });
  callbacks.current = onChange;
  selectionCallback.current = onSelectionChange;
  const update = (next: DraftAttachment[]) => {
    itemsRef.current = next; setItems(next);
    callbacks.current(uploadedInOrder(next), draftBusy(next));
    selectionCallback.current?.(next.length);
  };
  const cleanup = () => {
    ++epoch.current;
    controllers.current.forEach(controller => controller.abort()); controllers.current.clear();
    owned.current.forEach(forgetFile); owned.current.clear();
    // Never delete uploads here: after durable enqueue but before clearKey commits, they may belong to an outbox record.
  };
  useEffect(() => {
    if (identity.current.client !== client || identity.current.threadId !== threadId || identity.current.clearKey !== clearKey) {
      cleanup(); identity.current = { client, threadId, clearKey }; update([]); setNotice(''); setMenuOpen(false);
    }
  }, [client, threadId, clearKey]);
  useEffect(() => { callbacks.current([], false); }, []);
  useEffect(() => () => cleanup(), []);

  const upload = async (key: number, source: PickedAttachment, generation: number) => {
    const controller = new AbortController(); controllers.current.set(key, controller);
    let release: (() => void) | undefined;
    try {
      release = await attachmentSlot(controller.signal);
      const bytes = source.data ?? await new File(source.uri!).bytes();
      if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('invalid size');
      if (generation !== epoch.current || controller.signal.aborted) return;
      // Actual SDK signature is upload(threadId, name, Uint8Array, signal).
      if (!threadId) throw new Error('thread required');
      const attachment = await client.upload(threadId, source.name, bytes, controller.signal);
      if (generation !== epoch.current || controller.signal.aborted) return;
      const current = itemsRef.current;
      if (current.some(item => item.key === key)) update(current.map(item => item.key === key ? { ...item, status: 'ready', attachment, error: undefined } : item));
      // A late response after explicit removal cannot be attributed safely to an outbox; no background delete.
    } catch {
      if (generation === epoch.current && !controller.signal.aborted) {
        update(itemsRef.current.map(item => item.key === key ? { ...item, status: 'failed', error: friendlyFailure } : item));
      }
    } finally { release?.(); if (controllers.current.get(key) === controller) controllers.current.delete(key); }
  };
  const add = (sources: PickedAttachment[], file?: File) => {
    const generation = epoch.current;
    const { accepted, error } = chooseAttachments(itemsRef.current.length, sources);
    setNotice(error || '');
    if (!accepted.length) { if (file) forgetFile(file); return; }
    const created: DraftAttachment[] = accepted.map(source => ({ key: ++nextKey.current, source, status: threadId ? 'uploading' : 'ready' }));
    if (file) owned.current.set(created[0].key, file);
    update([...itemsRef.current, ...created]);
    if (threadId) created.forEach(item => { void upload(item.key, item.source, generation); });
  };
  const images = async () => {
    if (disabled) return;
    const generation = epoch.current;
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: Math.max(1, 8 - itemsRef.current.length), quality: 1 });
      if (picked.canceled || epoch.current !== generation) return;
      const sources = picked.assets.map(asset => ({ uri: asset.uri, name: asset.fileName || `image.${asset.mimeType === 'image/png' ? 'png' : 'jpg'}`, mime: asset.mimeType, size: asset.fileSize ?? new File(asset.uri).size }));
      add(sources);
    } catch { if (epoch.current === generation) setNotice('Could not select images. Please try again.'); }
  };
  const files = async () => {
    if (disabled) return;
    const generation = epoch.current;
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
      if (picked.canceled || epoch.current !== generation) return;
      add(picked.assets.map(asset => ({ uri: asset.uri, name: asset.name, mime: asset.mimeType, size: asset.size ?? new File(asset.uri).size })));
    } catch { if (epoch.current === generation) setNotice('Could not select files. Please try again.'); }
  };

  const camera = async () => {
    if (disabled || itemsRef.current.length >= 8) return;
    const generation = epoch.current;
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (epoch.current !== generation) return;
      if (!permission.granted) { setNotice('Allow camera access to take a photo, or choose one from your library.'); return; }
      const picked = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
      if (picked.canceled || epoch.current !== generation) return;
      add(picked.assets.map(asset => ({ uri: asset.uri, name: asset.fileName || `photo.${asset.mimeType === 'image/png' ? 'png' : 'jpg'}`, mime: asset.mimeType, size: asset.fileSize ?? new File(asset.uri).size })));
    } catch { if (epoch.current === generation) setNotice('Could not open the camera. Try again or choose a photo from your library.'); }
  };

  const paste = (data: { type: string; data?: string }) => {
    if (disabled || data.type !== 'image' || !data.data) { if (!disabled) setNotice('There is no image to paste from the clipboard.'); return; }
    let file: File | undefined;
    try {
      const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(data.data);
      if (!match || match[2].length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 4) throw new Error('invalid clipboard image');
      const bytes = toByteArray(match[2]);
      const name = match[1] === 'png' ? 'pasted-image.png' : 'pasted-image.jpg';
      const checked = chooseAttachments(itemsRef.current.length, [{ name, mime: `image/${match[1]}`, data: bytes }]);
      if (!checked.accepted.length) { setNotice(checked.error || 'Could not paste the image.'); return; }
      file = ownedFile(); file.create(); file.write(bytes);
      add([{ uri: file.uri, name, mime: `image/${match[1]}`, size: bytes.length }], file);
    } catch { if (file) forgetFile(file); setNotice('Could not paste the image. Please select it again.'); }
  };
  const pasteOnDemand = async () => {
    if (disabled) return;
    const generation = epoch.current;
    try {
      const hasImage = await Clipboard.hasImageAsync();
      if (generation !== epoch.current) return;
      if (hasImage) {
        const image = await Clipboard.getImageAsync({ format: 'png' });
        if (generation === epoch.current) {
          if (image) paste({ type: 'image', data: image.data });
          else setNotice('Could not paste. Check that paste access is allowed.');
        }
        return;
      }
      // Plain-text conversion also covers rich text. URL-only pasteboards are iOS-specific.
      let text = await Clipboard.getStringAsync();
      if (generation !== epoch.current) return;
      if (!text && Platform.OS === 'ios') text = await Clipboard.getUrlAsync() || '';
      if (generation !== epoch.current) return;
      if (text) { onPasteText(text); setNotice(''); }
      else setNotice('Could not paste. Allow paste access, or use Choose file to add a file.');
    } catch { if (generation === epoch.current) setNotice('Could not read the clipboard. Please try again.'); }
  };
  const remove = (key: number) => {
    if (disabled) return;
    const item = itemsRef.current.find(entry => entry.key === key);
    if (!item) return;
    controllers.current.get(key)?.abort(); controllers.current.delete(key);
    update(itemsRef.current.filter(entry => entry.key !== key));
    const file = owned.current.get(key); if (file) { forgetFile(file); owned.current.delete(key); }
    if (item.attachment?.state === 'available' && item.attachment.receipt_id == null) {
      // Only explicit removal deletes an upload this instance owns. The server refuses already-attached IDs.
      if (threadId) void client.deleteUnattached(threadId, item.attachment.id).catch(() => {});
    }
  };
  const retry = (key: number) => {
    if (disabled) return;
    const item = itemsRef.current.find(entry => entry.key === key);
    if (!item || item.status !== 'failed' || !threadId) return;
    update(itemsRef.current.map(entry => entry.key === key ? { ...entry, status: 'uploading', error: undefined } : entry));
    void upload(key, item.source, epoch.current);
  };
  const previewImage = (item: DraftAttachment) => {
    if (!item.source.uri) return;
    const generation = epoch.current;
    void openImage(item.source.uri, item.source.name, openViewer,
      () => generation === epoch.current && itemsRef.current.some(entry => entry.key === item.key))
      .catch(() => { if (generation === epoch.current) setNotice('Could not open the image. Please try again.'); });
  };
  const uploadTo = async (targetThreadId: string) => {
    if (threadId) return uploadedInOrder(itemsRef.current);
    const generation = epoch.current, snapshot = [...itemsRef.current];
    if (snapshot.some(item => item.status === 'failed')) throw new Error('attachment unavailable');
    update(snapshot.map(item => item.attachment ? item : { ...item, status: 'uploading', error: undefined }));
    const uploaded: Attachment[] = snapshot.flatMap(item => item.attachment ? [item.attachment] : []);
    try {
      for (const item of snapshot) {
        if (item.attachment) continue;
        const controller = new AbortController(); controllers.current.set(item.key, controller);
        let release: (() => void) | undefined;
        try {
          release = await attachmentSlot(controller.signal);
          const bytes = item.source.data ?? await new File(item.source.uri!).bytes();
          if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES || generation !== epoch.current) throw new Error('invalid attachment');
          const attachment = await client.upload(targetThreadId, item.source.name, bytes, controller.signal);
          if (generation !== epoch.current) throw new Error('stale attachment');
          uploaded.push(attachment);
          update(itemsRef.current.map(entry => entry.key === item.key ? { ...entry, status: 'ready', attachment } : entry));
        } finally {
          release?.();
          if (controllers.current.get(item.key) === controller) controllers.current.delete(item.key);
        }
      }
      return uploaded;
    } catch (error) {
      if (generation === epoch.current) update(itemsRef.current.map(item => item.attachment ? item : { ...item, status: 'failed', error: friendlyFailure }));
      throw error;
    }
  };
  const discardFrom = async (targetThreadId: string) => {
    const uploads = itemsRef.current.flatMap(item => item.attachment?.state === 'available' && item.attachment.receipt_id == null ? [item.attachment.id] : []);
    await Promise.all(uploads.map(id => client.deleteUnattached(targetThreadId, id)));
  };
  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = { uploadTo, discardFrom };
    return () => { handleRef.current = null; };
  }, [client, threadId, handleRef]);
  return <View style={styles.composerRoot}>
      {menuOpen && <View style={[styles.controls, styles.menu]}>
        <Action label="Choose file" onPress={() => { setMenuOpen(false); void files(); }} disabled={disabled || items.length >= 8} />
        <Action label="Photo library" onPress={() => { setMenuOpen(false); void images(); }} disabled={disabled || items.length >= 8} />
        <Action label="Take photo" onPress={() => { setMenuOpen(false); void camera(); }} disabled={disabled || items.length >= 8} />
        <Action label="Paste" onPress={() => { setMenuOpen(false); void pasteOnDemand(); }} disabled={disabled} />
      </View>}
    {!!notice && <Text accessibilityRole="alert" style={styles.error}>{notice}</Text>}
    {!!items.length && <ScrollView horizontal keyboardShouldPersistTaps="always" style={styles.draftStrip}>
    {items.map(item => <View key={item.key} style={[styles.tile, styles.draftTile]}>
      {isImage(item.source.mime, item.source.name) && item.source.uri && <Pressable accessibilityRole="button" accessibilityLabel={`View image: ${item.source.name}`} onPress={() => previewImage(item)}>
        <Image source={{ uri: item.source.uri }} style={styles.thumb} />
      </Pressable>}
      <View style={styles.fileText}>
        <Text numberOfLines={2} style={styles.title}>{item.source.name}</Text>
        <Text style={styles.detail}>{item.status === 'uploading' ? 'Uploading…' : item.status === 'failed' ? item.error : item.source.mime || 'File'}</Text>
      </View>
      {item.status === 'failed' && <Action label={`Retry: ${item.source.name}`} title="Retry" onPress={() => retry(item.key)} disabled={disabled} />}
      <Action label={`Remove: ${item.source.name}`} title="×" onPress={() => remove(item.key)} disabled={disabled} />
    </View>)}</ScrollView>}
    <View style={styles.composerRow} onLayout={event => onComposerHeight?.(event.nativeEvent.layout.height)}>
      <Pressable accessibilityRole="button" accessibilityLabel="Add attachment" accessibilityState={{ expanded: menuOpen }}
        disabled={disabled} onPress={() => setMenuOpen(open => !open)} style={[styles.add, disabled && styles.disabled]}>
        <Text style={styles.addText}>{menuOpen ? '×' : '＋'}</Text>
      </Pressable>
      {children}
    </View>
  </View>;
}

let activeDownloads = 0;
const downloadWaiters: Array<() => void> = [];
async function attachmentSlot(signal: AbortSignal): Promise<() => void> {
  if (signal.aborted) throw new Error('aborted');
  const release = () => { const next = downloadWaiters.shift(); if (next) next(); else activeDownloads--; };
  if (activeDownloads >= 3) await new Promise<void>((resolve, reject) => {
    const resume = () => { signal.removeEventListener('abort', abort); resolve(); };
    const abort = () => { const index = downloadWaiters.indexOf(resume); if (index >= 0) downloadWaiters.splice(index, 1); reject(new Error('aborted')); };
    if (signal.aborted) { reject(new Error('aborted')); return; }
    signal.addEventListener('abort', abort, { once: true }); downloadWaiters.push(resume);
  });
  else activeDownloads++;
  if (signal.aborted) { release(); throw new Error('aborted'); }
  return release;
}

/** Authenticated SDK bytes only; no token-bearing image URLs, external viewers, or eager non-image downloads. */
export function MessageAttachments({ client, threadId, attachments }: { client: HermesClient; threadId: string; attachments: Attachment[] }) {
  const [loaded, setLoaded] = useState<Record<string, { uri?: string; text?: string; status: 'loading' | 'ready' | 'error' }>>({});
  const { openViewer } = useViewer();
  const cache = useRef(new Map<string, File>()), pending = useRef(new Map<string, AbortController>()), generation = useRef(0);
  const load = async (attachment: Attachment) => {
    if (attachment.state !== 'available' || pending.current.has(attachment.id) || loaded[attachment.id]?.status === 'ready') return;
    const controller = new AbortController(), current = generation.current;
    pending.current.set(attachment.id, controller);
    setLoaded(old => ({ ...old, [attachment.id]: { status: 'loading' } }));
    let release: (() => void) | undefined;
    try {
      release = await attachmentSlot(controller.signal);
      if (attachment.size && attachment.size > MAX_ATTACHMENT_BYTES) throw new Error('too large');
      const bytes = await client.download(threadId, attachment.id, controller.signal);
      if (bytes.length > MAX_ATTACHMENT_BYTES || !bytes.length || (attachment.size !== undefined && attachment.size !== bytes.length)) throw new Error('invalid body');
      if (controller.signal.aborted || current !== generation.current) return;
      const file = ownedFile(); file.create();
      try { file.write(bytes); } catch (error) { forgetFile(file); throw error; }
      cache.current.set(attachment.id, file);
      const text = readableText(attachment.mime, attachment.name) && bytes.length <= 64 * 1024 ? await file.text() : undefined;
      if (controller.signal.aborted || current !== generation.current) return;
      setLoaded(old => ({ ...old, [attachment.id]: { status: 'ready', uri: file.uri, text } }));
    } catch {
      if (!controller.signal.aborted && current === generation.current) setLoaded(old => ({ ...old, [attachment.id]: { status: 'error' } }));
    } finally {
      release?.();
      if (pending.current.get(attachment.id) === controller) pending.current.delete(attachment.id);
    }
  };
  useEffect(() => {
    setLoaded({});
    return () => {
      generation.current++; pending.current.forEach(controller => controller.abort()); pending.current.clear();
      cache.current.forEach(forgetFile); cache.current.clear();
    };
  }, [client, threadId]);
  useEffect(() => {
    for (const attachment of attachments) if (attachment.state === 'available' && isImage(attachment.mime, attachment.name)) void load(attachment);
  }, [attachments, client, threadId]);
  const open = (attachment: Attachment) => {
    const entry = loaded[attachment.id];
    if (entry?.status === 'ready') {
      if (isImage(attachment.mime, attachment.name)) {
        if (!entry.uri) return;
        const current = generation.current;
        void openImage(entry.uri, attachment.name || 'Image', openViewer, () => current === generation.current)
          .catch(() => { if (current === generation.current) setLoaded(old => ({ ...old, [attachment.id]: { status: 'error' } })); });
      } else openViewer(attachment.name || 'Attachment', <View style={styles.viewer}>
        <ScrollView><Text selectable style={styles.previewText}>{entry.text || 'File downloaded. This format cannot be opened in the app yet.'}</Text></ScrollView>
      </View>);
    } else void load(attachment);
  };
  return <View style={styles.root}>{attachments.map(attachment => {
    const entry = loaded[attachment.id];
    const image = isImage(attachment.mime, attachment.name);
    const label = attachment.name || 'Unnamed attachment';
    return <Pressable key={attachment.id} accessibilityRole="button" accessibilityLabel={`View attachment: ${label}`} style={styles.tile}
      disabled={attachment.state !== 'available'} onPress={() => open(attachment)}>
      {image && entry?.uri && <Image source={{ uri: entry.uri }} style={styles.thumb} />}
      <View style={styles.fileText}><Text style={styles.title} numberOfLines={2}>{label}</Text>
        <Text style={styles.detail}>{attachment.state !== 'available' ? 'Attachment unavailable for now' : entry?.status === 'loading' ? 'Loading…' : entry?.status === 'error' ? 'Failed to load. Tap to retry' : attachment.mime || 'File'}</Text>
      </View>
    </Pressable>;
  })}
  </View>;
}

const styles = StyleSheet.create({
  composerRoot: { backgroundColor: '#fff' },
  menu: { paddingHorizontal: 10, paddingVertical: 6 },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderTopWidth: 1, borderColor: '#e2e8f0' },
  draftStrip: { maxHeight: 112 }, draftTile: { width: 250, marginRight: 6 },
  root: { marginVertical: 4 }, controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, alignItems: 'center' },
  action: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: '#e6f0ff' }, actionText: { color: '#215ca7', fontSize: 12 }, disabled: { opacity: 0.45 },
  add: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 }, addText: { color: '#215ca7', fontSize: 28 },
  tile: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 6, padding: 6, borderRadius: 10, backgroundColor: '#f1f5fa' },
  thumb: { width: 62, height: 62, borderRadius: 6 }, fileText: { flex: 1, minWidth: 0 }, title: { color: '#172a40', fontSize: 12 },
  detail: { color: '#50647b', fontSize: 11, marginTop: 3 }, error: { color: '#a53238', fontSize: 12, marginTop: 5 },
  viewer: { flex: 1, backgroundColor: '#101722', padding: 12 }, zoom: { flex: 1 }, zoomContent: { alignItems: 'center', justifyContent: 'center', flexGrow: 1 }, previewText: { color: '#fff', fontSize: 15, paddingTop: 18 }
});
