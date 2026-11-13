import React, { useEffect, useRef, useState } from 'react';
import { Image, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './FontSize';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import { File } from 'expo-file-system';
import { toByteArray } from 'base64-js';
import { useIsFocused } from 'expo-router';
import type { Attachment, HermesClient } from '../../../packages/client/src/index';
import { attachmentPageUrl } from '../../../packages/client/src/attachmentPages';
import { appDownloadLimit, browserDownloadUrl, chooseAttachments, draftBusy, isImage, pickedMediaName, tooLargeForApp, MAX_CLIPBOARD_IMAGE_BYTES, MAX_THUMBNAIL_BYTES, uploadedInOrder } from './attachmentHelpers';
import type { DraftAttachment, PickedAttachment } from './attachmentHelpers';
import { useViewer } from './Viewers';
import { ComposerCard } from './ComposerCard';
import { AttachmentGallery, type GalleryItem } from './AttachmentGallery';
import { attachmentSlot, forgetFile, ownedFile, progressLabel, uploadSource, type AttachmentFiles } from './attachmentFiles';
import { gallerySequence } from './gallerySequence';
import { fileSize } from './nativeNumber';

const friendlyFailure = 'Upload failed. The file is still here. Retry or remove it.';
function Action({ label, title = label, onPress, disabled = false }: { label: string; title?: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={[styles.action, disabled && styles.disabled]}><Text style={styles.actionText}>{title}</Text></Pressable>;
}

export { ImageViewer } from './FilePreview';

export type AttachmentComposerHandle = {
  uploadTo: (threadId: string) => Promise<Attachment[]>;
  discardFrom: (threadId: string) => Promise<void>;
};
// User-selected, unsent files only. Never retain downloaded message media here.
export type ComposerDraft = { items: DraftAttachment[]; files: Array<[number, File]> };
export function releaseComposerDraft(draft: ComposerDraft) { draft.files.forEach(([, file]) => forgetFile(file)); }

/** Ready server metadata reaches onChange. With no threadId, files stay local until uploadTo(). */
export function AttachmentComposer({ client, threadId, onChange, onPasteText, clearKey, children, send, expanded = false, onPressField, onComposerHeight, onSelectionChange, handleRef, initialDraft, restoredAttachments, onDraftChange, disabled = false }: {
  client: HermesClient; threadId: string | null; onChange: (attachments: Attachment[], busy: boolean) => void; onPasteText: (text: string) => void; clearKey: number; children?: React.ReactNode; send?: React.ReactNode; expanded?: boolean; onPressField?: () => void; onComposerHeight?: (height: number) => void; onSelectionChange?: (count: number) => void; handleRef?: React.MutableRefObject<AttachmentComposerHandle | null>; disabled?: boolean;
  restoredAttachments?: Attachment[]; initialDraft?: ComposerDraft; onDraftChange?: (draft: ComposerDraft) => void;
}) {
  const [items, setItems] = useState<DraftAttachment[]>(() => initialDraft?.items ?? []);
  const [notice, setNotice] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const { openViewer } = useViewer();
  const itemsRef = useRef(items), callbacks = useRef(onChange), selectionCallback = useRef(onSelectionChange), epoch = useRef(0), nextKey = useRef(items.reduce((key, item) => Math.max(key, item.key), 0));
  const controllers = useRef(new Map<number, AbortController>()), owned = useRef(new Map<number, File>(initialDraft?.files));
  const draftCallback = useRef(onDraftChange); draftCallback.current = onDraftChange;
  const stagedThread = useRef<string | null>(null);
  const identity = useRef({ client, threadId, clearKey });
  callbacks.current = onChange;
  selectionCallback.current = onSelectionChange;
  const update = (next: DraftAttachment[]) => {
    itemsRef.current = next; setItems(next);
    callbacks.current(uploadedInOrder(next), threadId ? draftBusy(next) : next.some(item => item.status === 'uploading'));
    selectionCallback.current?.(next.length);
    draftCallback.current?.({ items: next, files: [...owned.current] });
  };
  const cleanup = () => {
    ++epoch.current;
    stagedThread.current = null;
    controllers.current.forEach(controller => controller.abort()); controllers.current.clear();
    owned.current.forEach(forgetFile); owned.current.clear();
    // Never delete uploads here: after durable enqueue but before clearKey commits, they may belong to an outbox record.
  };
  useEffect(() => {
    // Local first-message files belong to no server until uploadTo() stages
    // them, so a new client keeps an unstaged selection.
    const clientChanged = identity.current.client !== client &&
      (threadId !== null || identity.current.threadId !== null || stagedThread.current !== null);
    if (clientChanged || identity.current.threadId !== threadId || identity.current.clearKey !== clearKey) {
      cleanup(); identity.current = { client, threadId, clearKey }; update([]); setNotice(''); setMenuOpen(false);
    } else identity.current = { client, threadId, clearKey };
  }, [client, threadId, clearKey]);
  useEffect(() => { callbacks.current(uploadedInOrder(itemsRef.current), threadId ? draftBusy(itemsRef.current) : false); }, []);
  useEffect(() => {
    if (restoredAttachments?.length && !itemsRef.current.length) update(restoredAttachments.map(attachment => ({
      key: ++nextKey.current, source: { name: attachment.name ?? 'Attachment', mime: attachment.mime, size: attachment.size }, status: 'ready', attachment
    })));
  }, [restoredAttachments]);
  useEffect(() => () => {
    if (!draftCallback.current) { cleanup(); return; }
    ++epoch.current; controllers.current.forEach(controller => controller.abort()); controllers.current.clear();
    draftCallback.current({ items: itemsRef.current.map(item => item.status === 'uploading' ? { ...item, status: 'failed', error: friendlyFailure } : item), files: [...owned.current] });
    owned.current.clear();
  }, []);

  const upload = async (key: number, source: PickedAttachment, generation: number) => {
    const controller = new AbortController(); controllers.current.set(key, controller);
    let release: (() => void) | undefined;
    try {
      release = await attachmentSlot(controller.signal);
      if (!threadId) throw new Error('thread required');
      const attachment = await uploadSource(client, threadId, source, controller.signal, () => generation !== epoch.current || controller.signal.aborted);
      if (!attachment) return;
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
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, selectionLimit: Math.max(1, 8 - itemsRef.current.length), quality: 1, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current });
      if (picked.canceled || epoch.current !== generation) return;
      const sources = picked.assets.map(asset => ({ uri: asset.uri, name: pickedMediaName(asset.fileName, asset.mimeType, asset.type === 'video' ? 'video' : 'image'), mime: asset.mimeType, size: asset.fileSize ?? fileSize(new File(asset.uri)) }));
      add(sources);
    } catch { if (epoch.current === generation) setNotice('Could not select photos or videos. Please try again.'); }
  };
  const files = async () => {
    if (disabled) return;
    const generation = epoch.current;
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
      if (picked.canceled || epoch.current !== generation) return;
      add(picked.assets.map(asset => ({ uri: asset.uri, name: asset.name, mime: asset.mimeType, size: asset.size ?? fileSize(new File(asset.uri)) })));
    } catch { if (epoch.current === generation) setNotice('Could not select files. Please try again.'); }
  };

  // Android's system camera only takes photos when images and videos are mixed, so video is its own action.
  const camera = async (video = false) => {
    if (disabled || itemsRef.current.length >= 8) return;
    const generation = epoch.current;
    const what = video ? 'a video' : 'a photo';
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (epoch.current !== generation) return;
      if (!permission.granted) { setNotice(`Allow camera access to take ${what}, or choose one from your library.`); return; }
      const picked = await ImagePicker.launchCameraAsync({ mediaTypes: [video ? 'videos' : 'images'], quality: 1 });
      if (picked.canceled || epoch.current !== generation) return;
      add(picked.assets.map(asset => ({ uri: asset.uri, name: pickedMediaName(asset.fileName, asset.mimeType, video || asset.type === 'video' ? 'video' : 'photo'), mime: asset.mimeType, size: asset.fileSize ?? fileSize(new File(asset.uri)) })));
    } catch { if (epoch.current === generation) setNotice(`Could not open the camera. Try again or choose ${what} from your library.`); }
  };

  const paste = (data: { type: string; data?: string }) => {
    if (disabled || data.type !== 'image' || !data.data) { if (!disabled) setNotice('There is no image to paste from the clipboard.'); return; }
    let file: File | undefined;
    try {
      const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(data.data);
      if (!match || match[2].length > Math.ceil(MAX_CLIPBOARD_IMAGE_BYTES / 3) * 4 + 4) throw new Error('invalid clipboard image');
      const bytes = toByteArray(match[2]);
      const name = match[1] === 'png' ? 'pasted-image.png' : 'pasted-image.jpg';
      const checked = chooseAttachments(itemsRef.current.length, [{ name, mime: `image/${match[1]}`, data: bytes }]);
      if (!checked.accepted.length) { setNotice(checked.error || 'Could not paste the image.'); return; }
      file = ownedFile(); file.create(); file.writeSync(bytes);
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
      const ownerThread = threadId ?? item.attachment.thread_id;
      void client.deleteUnattached(ownerThread, item.attachment.id).catch(() => {});
    }
  };
  const retry = (key: number) => {
    if (disabled) return;
    const item = itemsRef.current.find(entry => entry.key === key);
    if (!item || item.status !== 'failed') return;
    if (!threadId) {
      if (stagedThread.current) void uploadTo(stagedThread.current).catch(() => {});
      return;
    }
    update(itemsRef.current.map(entry => entry.key === key ? { ...entry, status: 'uploading', error: undefined } : entry));
    void upload(key, item.source, epoch.current);
  };
  // Unsent images side by side, in composer order. Each page copies its source file.
  const previewImage = (item: DraftAttachment) => {
    const images = itemsRef.current.filter(entry => isImage(entry.source.mime, entry.source.name) && entry.source.uri);
    const index = images.findIndex(entry => entry.key === item.key);
    if (index < 0) return;
    const pages: GalleryItem[] = images.map(entry => ({ key: String(entry.key), title: entry.source.name, open: async () => ({ uri: entry.source.uri!, kind: 'image' as const }) }));
    try { openViewer(item.source.name, <AttachmentGallery items={pages} initialIndex={index} />); }
    catch { setNotice('Could not open the image. Please try again.'); }
  };
  const uploadTo = async (targetThreadId: string) => {
    if (threadId) return uploadedInOrder(itemsRef.current);
    if (stagedThread.current && stagedThread.current !== targetThreadId) throw new Error('attachment target changed');
    stagedThread.current = targetThreadId;
    const generation = epoch.current, snapshot = [...itemsRef.current];
    // A locally staged first-message upload may be retried after a network
    // failure. Keep successful uploads and retry only the remaining sources.
    update(snapshot.map(item => item.attachment ? item : { ...item, status: 'uploading', error: undefined }));
    const uploaded: Attachment[] = snapshot.flatMap(item => item.attachment ? [item.attachment] : []);
    try {
      for (const item of snapshot) {
        if (item.attachment) continue;
        const controller = new AbortController(); controllers.current.set(item.key, controller);
        let release: (() => void) | undefined;
        try {
          release = await attachmentSlot(controller.signal);
          const attachment = await uploadSource(client, targetThreadId, item.source, controller.signal, () => generation !== epoch.current);
          if (!attachment) throw new Error('stale attachment');
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
  const addButton = <Pressable accessibilityRole="button" accessibilityLabel="Add attachment" accessibilityState={{ expanded: menuOpen }} hitSlop={4}
    disabled={disabled} onPress={() => setMenuOpen(open => !open)} style={[styles.add, disabled && styles.disabled]}>
    <Text style={styles.addText}>{menuOpen ? '×' : '+'}</Text>
  </Pressable>;
  return <View style={styles.composerRoot}>
      {menuOpen && <View style={[styles.controls, styles.menu]}>
        <Action label="Choose file" onPress={() => { setMenuOpen(false); void files(); }} disabled={disabled || items.length >= 8} />
        <Action label="Photo library" onPress={() => { setMenuOpen(false); void images(); }} disabled={disabled || items.length >= 8} />
        <Action label="Take photo" onPress={() => { setMenuOpen(false); void camera(); }} disabled={disabled || items.length >= 8} />
        <Action label="Record video" onPress={() => { setMenuOpen(false); void camera(true); }} disabled={disabled || items.length >= 8} />
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
    {send !== undefined ? <ComposerCard expanded={expanded} send={send} onPressField={() => onPressField?.()}
      // Card height plus its 6pt/8pt outer margins.
      onLayout={event => onComposerHeight?.(event.nativeEvent.layout.height + 14)} leading={addButton}>
      {children}
    </ComposerCard>
      // Legacy full-screen editor: `+` followed by its own actions in one row.
      : <View style={styles.composerRow} onLayout={event => onComposerHeight?.(event.nativeEvent.layout.height)}>{addButton}{children}</View>}
  </View>;
}

/**
 * Images download eagerly into the Thread's shared files; other files download when opened.
 * A tap opens every available attachment of the Thread side by side, starting at the tapped one.
 */
type RowState = 'loading' | 'ready' | 'error';
export function MessageAttachments({ files, attachments, gallery, server }: { files: AttachmentFiles; attachments: Attachment[]; gallery?: () => ReadonlyArray<readonly Attachment[] | undefined>;
  /** The connection's server address: a published HTML page opens at its link there. */ server?: string | null }) {
  const [state, setState] = useState<Record<string, RowState>>({});
  // Redraw while a download of this message's files reports progress.
  const [, setProgressTick] = useState(0);
  useEffect(() => files.onProgress(() => setProgressTick(tick => tick + 1)), [files]);
  const { openViewer } = useViewer();
  // Native file transfer holds large files on disk, not in JS memory.
  const limit = appDownloadLimit(files.client.supportsFileTransfer);
  const focused = useIsFocused(), focusedRef = useRef(focused); focusedRef.current = focused;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setState({}); }, [files]);
  const load = (attachment: Attachment) => {
    if (files.peek(attachment.id)) return;
    setState(old => ({ ...old, [attachment.id]: 'loading' }));
    files.load(attachment).then(
      entry => { if (alive.current && entry) setState(old => ({ ...old, [attachment.id]: 'ready' })); },
      () => { if (alive.current) setState(old => ({ ...old, [attachment.id]: 'error' })); });
  };
  useEffect(() => {
    // Large images download only when tapped, so a 100 MB photo does not load on its own over cellular.
    for (const attachment of attachments) if (attachment.state === 'available' && isImage(attachment.mime, attachment.name)
      && (attachment.size ?? 0) <= MAX_THUMBNAIL_BYTES) load(attachment);
  }, [attachments, files]);
  const open = (attachment: Attachment) => {
    if (!focusedRef.current) return;
    // A published HTML page opens in the browser, where its images and videos load.
    const page = attachmentPageUrl(server, attachment);
    if (page) {
      setState(old => ({ ...old, [attachment.id]: 'ready' }));
      void Linking.openURL(page).catch(() => { if (alive.current) setState(old => ({ ...old, [attachment.id]: 'error' })); });
      return;
    }
    if (tooLargeForApp(attachment, limit)) {
      // The system browser downloads it from the public link; the app does not hold it in memory.
      const url = browserDownloadUrl(attachment, limit);
      if (url) void Linking.openURL(url).catch(() => { if (alive.current) setState(old => ({ ...old, [attachment.id]: 'error' })); });
      return;
    }
    // A failed thumbnail retries with the tap as well.
    if (state[attachment.id] === 'error' && isImage(attachment.mime, attachment.name)) load(attachment);
    const sequence = gallerySequence(gallery?.() ?? [attachments], attachment);
    const items = sequence.items.filter(item => item.id === attachment.id || (!tooLargeForApp(item, limit) && !attachmentPageUrl(server, item)));
    const index = Math.max(0, items.findIndex(item => item.id === attachment.id));
    const pages: GalleryItem[] = items.map(item => ({ key: item.id, title: item.name || 'Attachment', open: () => files.load(item),
      progress: () => { const value = files.downloadProgress(item.id); return value && progressLabel(value); }, onProgress: listener => files.onProgress(listener) }));
    try { openViewer(pages[index].title, <AttachmentGallery items={pages} initialIndex={index} />); }
    catch { setState(old => ({ ...old, [attachment.id]: 'error' })); }
  };
  return <View style={styles.root}>{attachments.map(attachment => {
    const ready = files.peek(attachment.id), status = ready ? 'ready' : state[attachment.id];
    const downloading = ready ? undefined : files.downloadProgress(attachment.id);
    const image = isImage(attachment.mime, attachment.name);
    const label = attachment.name || 'Unnamed attachment';
    return <Pressable key={attachment.id} accessibilityRole="button" accessibilityLabel={`View attachment: ${label}`} style={styles.tile}
      disabled={attachment.state !== 'available'} onPress={() => open(attachment)}>
      {image && <View style={styles.thumb}>
        {ready && <Image source={{ uri: ready.uri }} style={styles.thumb} />}
      </View>}
      <View style={styles.fileText}><Text style={styles.title} numberOfLines={2}>{label}</Text>
        <Text style={styles.detail}>{attachment.state !== 'available' ? 'Attachment unavailable for now' : attachmentPageUrl(server, attachment)
          ? (status === 'error' ? 'Could not open the page. Tap to retry' : 'Web page. Tap to open in your browser') : tooLargeForApp(attachment, limit) ? (attachment.public_url ? (status === 'error' ? 'Could not open the link. Tap to retry' : 'Large file. Tap to download in your browser') : 'Too large to open in the app') : downloading ? `Downloading… ${progressLabel(downloading)}` : status === 'loading' ? 'Loading…' : status === 'error' ? 'Failed to load. Tap to retry' : attachment.mime || 'File'}</Text>
      </View>
    </Pressable>;
  })}
  </View>;
}

const styles = StyleSheet.create({
  // ChatTimeline owns the single blurred/tinted composer surface.
  composerRoot: { backgroundColor: 'transparent' },
  menu: { paddingHorizontal: 10, paddingVertical: 6 },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, paddingHorizontal: 10, paddingVertical: 7 },
  draftStrip: { maxHeight: 112 }, draftTile: { width: 250, marginRight: 6 },
  root: { marginVertical: 4 }, controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, alignItems: 'center' },
  action: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: '#e6f0ff' }, actionText: { color: '#215ca7', fontSize: 12 }, disabled: { opacity: 0.45 },
  add: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18 }, addText: { color: '#1f2329', fontSize: 28, lineHeight: 32, fontWeight: '300' },
  tile: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 6, padding: 6, borderRadius: 10, backgroundColor: '#f1f5fa' },
  thumb: { width: 62, height: 62, borderRadius: 6 }, fileText: { flex: 1, minWidth: 0 }, title: { color: '#172a40', fontSize: 12 },
  detail: { color: '#50647b', fontSize: 11, marginTop: 3 }, error: { color: '#a53238', fontSize: 12, marginTop: 5 },
});
