import { File, Paths } from 'expo-file-system';
import type { Attachment, HermesClient } from '../../../packages/client/src/index';
import { MAX_ATTACHMENT_BYTES, type PickedAttachment } from './attachmentHelpers';
import { previewKind, previewSuffix, type PreviewKind } from './filePreviewKind';

let fileSequence = 0;
/** A private cache file. The suffix keeps the original extension (AVPlayer and WKWebView need it). */
export function ownedFile(suffix = ''): File { return new File(Paths.cache, `hermes-attachment-${Date.now()}-${++fileSequence}${suffix}`); }
export function forgetFile(file: File) { try { if (file.exists) file.delete(); } catch { /* cache cleanup is best effort */ } }

let activeTransfers = 0;
const transferWaiters: Array<() => void> = [];
/** At most three attachment transfers (uploads and downloads) run at once. */
export async function attachmentSlot(signal: AbortSignal): Promise<() => void> {
  if (signal.aborted) throw new Error('aborted');
  const release = () => { const next = transferWaiters.shift(); if (next) next(); else activeTransfers--; };
  if (activeTransfers >= 3) await new Promise<void>((resolve, reject) => {
    const resume = () => { signal.removeEventListener('abort', abort); resolve(); };
    const abort = () => { const index = transferWaiters.indexOf(resume); if (index >= 0) transferWaiters.splice(index, 1); reject(new Error('aborted')); };
    if (signal.aborted) { reject(new Error('aborted')); return; }
    signal.addEventListener('abort', abort, { once: true }); transferWaiters.push(resume);
  });
  else activeTransfers++;
  if (signal.aborted) { release(); throw new Error('aborted'); }
  return release;
}

/**
 * Upload one picked source. A file goes through the native file upload, so up to
 * 100 MiB never enters JS memory; pasted bytes go as bytes. Resolves undefined
 * when `stale()` is true just before the upload starts.
 */
export async function uploadSource(client: HermesClient, threadId: string, source: PickedAttachment, signal: AbortSignal,
  stale: () => boolean): Promise<Attachment | undefined> {
  if (source.uri && !source.data && client.supportsFileTransfer) {
    const size = new File(source.uri).size;
    if (!size || size > MAX_ATTACHMENT_BYTES) throw new Error('invalid size');
    if (stale()) return undefined;
    return client.uploadFile(threadId, source.name, { uri: source.uri, size }, signal);
  }
  const bytes = source.data ?? await new File(source.uri!).bytes();
  if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('invalid size');
  if (stale()) return undefined;
  return client.upload(threadId, source.name, bytes, signal);
}

/** The first bytes of a file, for signature checks, without reading the whole file. */
function leadingBytes(file: File, length: number): Uint8Array {
  const handle = file.open();
  try { return handle.readBytes(Math.min(length, file.size)); } finally { handle.close(); }
}

export type LoadedAttachment = { uri: string; kind: PreviewKind };

/**
 * Downloaded message attachments of one Thread page. Message rows and the
 * gallery share it, so a file downloads once. Authenticated SDK bytes only; no
 * token-bearing URLs. A viewer never uses these files directly: it copies them,
 * because `dispose()` can run while a viewer route is still visible.
 */
export class AttachmentFiles {
  private ready = new Map<string, LoadedAttachment>();
  private pending = new Map<string, { controller: AbortController; task: Promise<LoadedAttachment | undefined> }>();
  private files: File[] = [];
  private generation = 0;
  constructor(readonly client: HermesClient, readonly threadId: string) {}

  peek(id: string): LoadedAttachment | undefined { return this.ready.get(id); }

  /** Rejects when the download fails. Resolves undefined only when `dispose()` ended it. */
  load(attachment: Attachment): Promise<LoadedAttachment | undefined> {
    if (attachment.state !== 'available') return Promise.reject(new Error('unavailable'));
    const done = this.ready.get(attachment.id);
    if (done) return Promise.resolve(done);
    const running = this.pending.get(attachment.id);
    if (running) return running.task;
    const controller = new AbortController(), generation = this.generation, name = attachment.name || '';
    const task = (async (): Promise<LoadedAttachment | undefined> => {
      let release: (() => void) | undefined;
      try {
        release = await attachmentSlot(controller.signal);
        if (attachment.size && attachment.size > MAX_ATTACHMENT_BYTES) throw new Error('too large');
        let file: File, head: Uint8Array;
        if (this.client.supportsFileTransfer) {
          // Native download straight into the cache file: up to 100 MiB never enters JS memory.
          file = ownedFile(previewSuffix(name));
          try {
            const size = await this.client.downloadFile(this.threadId, attachment.id, file.uri, controller.signal);
            if (!size || size > MAX_ATTACHMENT_BYTES || size !== file.size || (attachment.size !== undefined && attachment.size !== size)) throw new Error('invalid body');
            head = leadingBytes(file, 16);
          } catch (error) { forgetFile(file); throw error; }
          if (controller.signal.aborted || generation !== this.generation) { forgetFile(file); return undefined; }
        } else {
          const bytes = await this.client.download(this.threadId, attachment.id, controller.signal);
          if (bytes.length > MAX_ATTACHMENT_BYTES || !bytes.length || (attachment.size !== undefined && attachment.size !== bytes.length)) throw new Error('invalid body');
          if (controller.signal.aborted || generation !== this.generation) return undefined;
          file = ownedFile(previewSuffix(name)); file.create();
          try { file.write(bytes); } catch (error) { forgetFile(file); throw error; }
          head = bytes.subarray(0, 16);
        }
        this.files.push(file);
        const entry: LoadedAttachment = { uri: file.uri, kind: previewKind(name, attachment.mime, head) };
        this.ready.set(attachment.id, entry);
        return entry;
      } catch (error) {
        if (controller.signal.aborted || generation !== this.generation) return undefined;
        throw error;
      } finally {
        release?.();
        if (this.pending.get(attachment.id)?.controller === controller) this.pending.delete(attachment.id);
      }
    })();
    this.pending.set(attachment.id, { controller, task });
    return task;
  }

  /** Ends running downloads and deletes the files. The instance stays usable (effect replay). */
  dispose() {
    this.generation++;
    this.pending.forEach(entry => entry.controller.abort()); this.pending.clear();
    this.ready.clear();
    this.files.forEach(forgetFile); this.files = [];
  }
}
