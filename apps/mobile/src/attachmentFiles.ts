import { File, Paths } from 'expo-file-system';
import type { Attachment, HermesClient } from '../../../packages/client/src/index';
import { MAX_ATTACHMENT_BYTES } from './attachmentHelpers';
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
        const bytes = await this.client.download(this.threadId, attachment.id, controller.signal);
        if (bytes.length > MAX_ATTACHMENT_BYTES || !bytes.length || (attachment.size !== undefined && attachment.size !== bytes.length)) throw new Error('invalid body');
        if (controller.signal.aborted || generation !== this.generation) return undefined;
        const file = ownedFile(previewSuffix(name)); file.create();
        try { file.write(bytes); } catch (error) { forgetFile(file); throw error; }
        this.files.push(file);
        const entry: LoadedAttachment = { uri: file.uri, kind: previewKind(name, attachment.mime, bytes) };
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
