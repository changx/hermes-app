import type { Attachment, TransferProgress } from './index';

/** Delivered: the Agent sent the file with MEDIA:. Uploaded: the user sent it with a message. */
export type SessionFileList = 'delivered' | 'uploaded';
export type SessionFile = Attachment & { list: SessionFileList; created_at: number; ref_seq: number | null; caption?: string };
export type SessionFilePage = { threadId: string; list: SessionFileList; items: SessionFile[]; nextAfter: string | null };
/** `rank` (1 = best) is set when the server ranked the page by meaning and keywords. */
export type FileSearchHit = SessionFile & { thread_title: string; channel_id: string; channel_name: string | null; rank?: number };
/** `ranked`: one page in relevance order (semantic search), no cursor. Otherwise newest first with a cursor. */
export type FileSearchPage = { query: string; labels: string[]; items: FileSearchHit[]; nextAfter: string | null; ranked: boolean };

type Call = (method: string, path: string, body?: unknown, signal?: AbortSignal) => Promise<Record<string, unknown>>;
type Transfer = (threadId: string, id: string, destination: string, size: number | undefined, signal?: AbortSignal, onProgress?: TransferProgress) => Promise<number>;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const CURSOR = /^\d{1,12}:att_[A-Za-z0-9_-]{1,124}$/;
const MAX_QUERY = 200, MAX_LABELS = 10;

/**
 * Session files and file search (plugin capabilities `session_files`, `file_search`). Route-owned:
 * nothing is cached in the directory or the chat caches, and a file of any Session can be read
 * without opening that Session (search results come from every Session).
 */
export function createSessionFilesApi(call: Call, error: (message: string) => Error, transfer?: Transfer) {
  const fail = (message = 'Invalid file response'): never => { throw error(message); };
  const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : fail();
  const id = (v: unknown): string => typeof v === 'string' && ID.test(v) ? v : fail('Invalid file identity');
  const text = (v: unknown): string => typeof v === 'string' ? v : fail();
  const count = (v: unknown): number => Number.isSafeInteger(v) && (v as number) >= 0 ? v as number : fail();
  const cursor = (v: unknown): string | null => v === null ? null : typeof v === 'string' && CURSOR.test(v) ? v : fail('Invalid file cursor');
  const rows = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : fail();
  const file = (raw: unknown, thread?: string): SessionFile => {
    const item = object(raw), key = id(item.id), owner = id(item.thread_id);
    if (!key.startsWith('att_') || thread !== undefined && owner !== thread) return fail('File identity mismatch');
    if (!['available', 'missing'].includes(item.state as string) || !['delivered', 'uploaded'].includes(item.list as string)) return fail();
    const value: SessionFile = { id: key, thread_id: owner, state: item.state as 'available' | 'missing', name: text(item.name), mime: text(item.mime),
      size: count(item.size), receipt_id: item.receipt_id === null || item.receipt_id === undefined ? null : id(item.receipt_id),
      list: item.list as SessionFileList, created_at: count(item.created_at), ref_seq: item.ref_seq === null ? null : count(item.ref_seq) };
    if (item.caption !== undefined) value.caption = text(item.caption);
    if (typeof item.public_url === 'string') {
      try { const url = new URL(item.public_url); if (url.protocol === 'https:' && url.pathname.startsWith('/media/' + key + '/')) value.public_url = url.href; }
      catch { /* An optional link never invalidates the file row. */ }
    }
    return value;
  };
  const unique = <T extends { id: string }>(items: T[]): T[] => new Set(items.map(item => item.id)).size === items.length ? items : fail('Duplicate file');
  return {
    /** Current metadata of one file (for example a search result) before it is opened or saved. */
    async metadata(threadId: string, attachmentId: string, signal?: AbortSignal): Promise<Attachment> {
      const thread = id(threadId), key = id(attachmentId);
      if (!key.startsWith('att_')) return fail('Invalid file identity');
      const body = await call('GET', `/v1/threads/${encodeURIComponent(thread)}/attachments/${encodeURIComponent(key)}/metadata`, undefined, signal);
      const item = object(body.attachment);
      if (item.id !== key || item.thread_id !== thread) return fail('File identity mismatch');
      if (!['available', 'missing', 'deleted'].includes(item.state as string)) return fail();
      const value: Attachment = { id: key, thread_id: thread, state: item.state as Attachment['state'] };
      if (value.state !== 'deleted') { value.name = text(item.name); value.mime = text(item.mime); value.size = count(item.size); }
      return value;
    },
    /** Streams an available file to `destination`; the written size must equal its metadata size. */
    async downloadFile(file: Attachment, destination: string, signal?: AbortSignal, onProgress?: TransferProgress): Promise<number> {
      if (!transfer) return fail('File download unavailable');
      const key = id(file.id), thread = id(file.thread_id);
      if (!key.startsWith('att_') || file.state !== 'available') return fail('File unavailable');
      const size = await transfer(thread, key, destination, file.size, signal, onProgress);
      if (file.size !== undefined && size !== file.size) return fail('The file is incomplete');
      return size;
    },
    async list(threadId: string, list: SessionFileList, after: string | null = null, signal?: AbortSignal): Promise<SessionFilePage> {
      const thread = id(threadId);
      if (list !== 'delivered' && list !== 'uploaded') return fail('Invalid file list');
      if (after !== null) cursor(after);
      const body = await call('GET', `/v1/threads/${encodeURIComponent(thread)}/files?list=${list}&limit=100${after === null ? '' : '&after=' + encodeURIComponent(after)}`, undefined, signal);
      if (body.thread_id !== thread || body.list !== list) return fail('File list identity mismatch');
      const items = unique(rows(body.items, 100).map(raw => file(raw, thread)));
      if (items.some(item => item.list !== list)) return fail('File list mismatch');
      const nextAfter = cursor(body.next_after);
      if (nextAfter !== null && (!items.length || nextAfter !== `${items.at(-1)!.created_at}:${items.at(-1)!.id}`)) return fail('File cursor did not advance');
      return { threadId: thread, list, items, nextAfter };
    },
    /** Keyword terms and exact Session labels (AND). Either may be empty, not both. */
    async search(query: string, labels: readonly string[] = [], after: string | null = null, signal?: AbortSignal): Promise<FileSearchPage> {
      const q = query.trim();
      if (q.length > MAX_QUERY || labels.length > MAX_LABELS || (!q && !labels.length) || labels.some(label => typeof label !== 'string' || !label)) return fail('Invalid file search');
      if (after !== null) cursor(after);
      const params = new URLSearchParams({ q, limit: '30' });
      for (const label of labels) params.append('labels', label);
      if (after !== null) params.set('after', after);
      const body = await call('GET', '/v1/files/search?' + params.toString(), undefined, signal);
      if (body.query !== q || !Array.isArray(body.labels) || body.labels.length !== labels.length || body.labels.some((label, i) => label !== labels[i])) return fail('File search identity mismatch');
      const items = unique(rows(body.items, 50).map(raw => {
        const item = object(raw);
        return { ...file(item), thread_title: text(item.thread_title), channel_id: id(item.channel_id), channel_name: item.channel_name === null ? null : text(item.channel_name),
          ...(body.ranked === true ? { rank: count(item.rank) } : {}) };
      }));
      if (body.ranked === true) {
        if (body.next_after !== null || items.some((item, i) => item.rank !== i + 1)) return fail('Invalid ranked file search');
        return { query: q, labels: [...labels], items, nextAfter: null, ranked: true };
      }
      const nextAfter = cursor(body.next_after);
      if (nextAfter !== null && (!items.length || nextAfter !== `${items.at(-1)!.created_at}:${items.at(-1)!.id}`)) return fail('File cursor did not advance');
      return { query: q, labels: [...labels], items, nextAfter, ranked: false };
    },
  };
}
export type SessionFilesApi = ReturnType<typeof createSessionFilesApi>;
