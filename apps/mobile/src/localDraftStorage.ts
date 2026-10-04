import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import type { LocalDraftMap } from '../../../packages/client/src/localDraftMap';
import type { ComposerDraft } from './Attachments';
import type { DraftAttachment } from './attachmentHelpers';

// Device-private documents, never the OS-purgeable cache or server payloads.
const folder = () => new Directory(Paths.document, 'hermes-local-drafts');
const owns = (uri: string) => {
  const prefix = folder().uri.replace(/\/$/, '') + '/';
  return uri.startsWith(prefix) && /^attachment-[0-9a-f-]{36}$/.test(uri.slice(prefix.length));
};
type Saved = { version: 1; generation: number; texts: Array<[string, string]>; attachments: Array<[string, DraftAttachment[]]> };
const slot = (index: number) => new File(folder(), `drafts-${index}.json`);
function parse(raw: string): Saved {
  const value = JSON.parse(raw) as Saved;
  if (value.version !== 1 || !Number.isSafeInteger(value.generation) || value.generation < 0 || !Array.isArray(value.texts) || !Array.isArray(value.attachments)) throw new Error('draft storage');
  for (const [key, text] of value.texts) if (typeof key !== 'string' || typeof text !== 'string') throw new Error('draft storage');
  for (const [key, items] of value.attachments) {
    if (typeof key !== 'string' || !Array.isArray(items) || items.length > 8) throw new Error('draft storage');
    for (const item of items) if (!Number.isSafeInteger(item.key) || !item.source || typeof item.source.name !== 'string' || typeof item.source.uri !== 'string' || !owns(item.source.uri) || !['ready', 'failed', 'uploading'].includes(item.status)) throw new Error('draft storage');
  }
  return value;
}

/** Restore before enabling composers. Synchronous per-edit writes avoid a debounce loss window. */
export function bindLocalDraftStorage(texts: LocalDraftMap<string>, attachments: LocalDraftMap<ComposerDraft>, onFailure: () => void): () => void {
  const directory = folder();
  directory.create({ intermediates: true, idempotent: true });
  let generation = 0;
  const copies = new Map<string, string>();
  const candidates: Saved[] = [];
  let existing = 0;
  for (let i = 0; i < 2; i++) {
    const file = slot(i);
    if (!file.exists) continue;
    existing++;
    try { candidates.push(parse(file.textSync())); } catch { /* A torn slot leaves its other committed generation intact. */ }
  }
  if (existing && !candidates.length) throw new Error('draft storage');
  const saved = candidates.sort((a, b) => b.generation - a.generation)[0];
  if (saved) {
    generation = saved.generation;
    saved.texts.forEach(([key, text]) => texts.set(key, text));
    for (const [key, items] of saved.attachments) {
      const files: ComposerDraft['files'] = [];
      const restored = items.map(item => {
        const durable = new File(item.source.uri!);
        if (!durable.exists) return { ...item, status: 'failed' as const, error: 'This file is unavailable. Remove it and select it again.' };
        // Composer cleanup owns a cache copy, never the last committed durable file.
        const working = new File(Paths.cache, `hermes-restored-draft-${randomUUID()}`);
        durable.copy(working); files.push([item.key, working]); copies.set(working.uri, durable.uri);
        return { ...item, source: { ...item.source, uri: working.uri }, ...(item.status === 'uploading' ? { status: 'failed' as const, error: 'Upload was interrupted. Retry or remove it.' } : {}) };
      });
      attachments.set(key, { items: restored, files });
    }
  }
  const persist = () => {
    try {
      const next: Saved = { version: 1, generation: generation + 1, texts: [...texts].filter(([, text]) => text !== ''), attachments: [] };
      for (const [key, draft] of attachments) {
        if (!draft.items.length) continue;
        const items = draft.items.map(item => {
          let uri = item.source.uri && copies.get(item.source.uri);
          if (!uri || !new File(uri).exists) {
            const durable = new File(directory, `attachment-${randomUUID()}`);
            if (item.source.data) { durable.create(); durable.write(item.source.data); }
            else if (item.source.uri && new File(item.source.uri).exists) new File(item.source.uri).copy(durable);
            else if (item.status === 'failed' && item.source.uri && owns(item.source.uri)) return item;
            else throw new Error('draft attachment unavailable');
            uri = durable.uri;
            if (item.source.uri) copies.set(item.source.uri, uri);
          }
          const { data: _data, ...source } = item.source;
          return { ...item, source: { ...source, uri } };
        });
        next.attachments.push([key, items]);
      }
      const destination = slot(next.generation % 2);
      if (!destination.exists) destination.create();
      destination.write(JSON.stringify(next));
      // Only advance after a verified complete write; retain both slots' attachment bytes.
      if (parse(destination.textSync()).generation !== next.generation) throw new Error('draft storage');
      generation = next.generation;
      // Mirror the committed state so explicit clear/forget cannot recover deleted drafts from a stale slot.
      const mirror = slot((next.generation + 1) % 2);
      if (!mirror.exists) mirror.create();
      mirror.write(JSON.stringify(next));
      if (parse(mirror.textSync()).generation !== next.generation) throw new Error('draft storage');
      const retained = new Set(next.attachments.flatMap(([, items]) => items.map(item => item.source.uri)));
      const other = slot((next.generation + 1) % 2);
      if (other.exists) try { parse(other.textSync()).attachments.forEach(([, items]) => items.forEach(item => retained.add(item.source.uri))); } catch { /* invalid old slot */ }
      directory.list().forEach(file => { if (file instanceof File && file.name.startsWith('attachment-') && !retained.has(file.uri)) file.delete(); });
    } catch { onFailure(); }
  };
  const stopText = texts.observeMutations(persist), stopAttachments = attachments.observeMutations(persist);
  return () => { stopText(); stopAttachments(); };
}
