import type { Attachment } from './index';

export type ConditionalHeaders = { 'If-Match': string; 'If-None-Match'?: never } | { 'If-None-Match': '*'; 'If-Match'?: never };
export type WorkspaceState = { channelId: string; initialized: boolean; agentsAvailable?: boolean; agentsBytes: number; fileBytes: number };
export type WorkspaceEntry = { name: string; path: string; kind: 'file' | 'directory' | 'unavailable'; size: number | null };
export type WorkspacePage = { channelId: string; path: string; items: WorkspaceEntry[]; nextAfter: string | null };
export type AgentsDocument = { channelId: string; path: 'AGENTS.md'; content: string; etag: string };
export type ChannelAttachmentPage = { channelId: string; items: Attachment[]; nextAfter: string | null };

/** RN-independent UTF-8 length; reject lone surrogates rather than replacing user text. */
export function utf8Size(text: string): number {
  let length = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) length++;
    else if (code < 0x800) length += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const low = text.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) throw new Error('Invalid text');
      length += 4;
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new Error('Invalid text');
    else length += 3;
  }
  return length;
}

export function workspacePath(value: string, directory = false): string {
  if (typeof value !== 'string' || utf8Size(value) > 2048) throw new Error('Invalid relative path');
  if (directory && value === '') return value;
  const pieces = value.split('/');
  if (pieces.length > 16 || pieces.some(p => !p || p.startsWith('.') || utf8Size(p) > 255 || /[\\:\x00-\x1f\x7f]/.test(p)))
    throw new Error('Invalid relative path');
  return value;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ETAG = /^"[0-9a-f]{64}"$/;
const MAX_FILE = 10 * 1024 * 1024;
// Server filename sorting uses Unicode code points, not JS UTF-16 code units.
const nameOrder = (a: string, b: string): number => {
  const left = Array.from(a), right = Array.from(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const delta = left[i].codePointAt(0)! - right[i].codePointAt(0)!;
    if (delta) return delta;
  }
  return left.length - right.length;
};
type Call = (method: string, path: string, body?: unknown, signal?: AbortSignal, headers?: ConditionalHeaders) => Promise<Record<string, unknown>>;

/** Small route-owned details, never added to the directory/chat caches. */
export function createWorkspaceApi(call: Call, download: (path: string, signal?: AbortSignal) => Promise<Uint8Array>, error: (message: string) => Error) {
  const fail = (message = 'Invalid workspace response'): never => { throw error(message); };
  const object = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== 'object' || Array.isArray(v)) return fail(); return v as Record<string, unknown>; };
  const id = (v: unknown): string => typeof v === 'string' && ID.test(v) ? v : fail('Invalid workspace identity');
  const root = (cid: string) => '/v1/channels/' + encodeURIComponent(id(cid));
  const path = (p: string, dir = false) => { try { return workspacePath(p, dir); } catch { return fail('Invalid workspace path'); } };
  const text = (v: unknown): string => { if (typeof v !== 'string') return fail(); try { utf8Size(v); } catch { return fail(); } return v; };
  const size = (v: unknown): number => Number.isSafeInteger(v) && (v as number) >= 0 ? v as number : fail();
  const etag = (v: unknown): string => typeof v === 'string' && ETAG.test(v) ? v : fail('Invalid file version');
  const rows = (v: unknown): unknown[] => Array.isArray(v) && v.length <= 200 ? v : fail();
  const state = (body: Record<string, unknown>, cid: string): WorkspaceState => {
    const value = object(body.workspace), limits = object(value.limits);
    if (value.channel_id !== cid || value.root !== '' || value.agents_path !== 'AGENTS.md' ||
        value.rules_effect !== 'new_sessions' || typeof value.initialized !== 'boolean') return fail();
    const agentsBytes = size(limits.agents_bytes), fileBytes = size(limits.file_bytes);
    if (agentsBytes < 1 || agentsBytes > MAX_FILE || fileBytes < 1 || fileBytes > MAX_FILE ||
        value.agents_available !== undefined && typeof value.agents_available !== 'boolean') return fail();
    return { channelId: cid, initialized: value.initialized,
      agentsAvailable: value.agents_available === undefined ? value.initialized : value.agents_available as boolean,
      agentsBytes, fileBytes };
  };
  const document = (body: Record<string, unknown>, cid: string): AgentsDocument => {
    if (body.channel_id !== cid || body.path !== 'AGENTS.md' || body.rules_effect !== 'new_sessions') return fail();
    const content = text(body.content);
    if (utf8Size(content) > MAX_FILE) return fail();
    return { channelId: cid, path: 'AGENTS.md', content, etag: etag(body.etag) };
  };
  return {
    async getState(cid: string, signal?: AbortSignal) { return state(await call('GET', root(cid) + '/workspace', undefined, signal), cid); },
    async initialize(cid: string, signal?: AbortSignal) {
      const result = state(await call('POST', root(cid) + '/workspace', {}, signal), cid);
      if (!result.initialized) return fail('Workspace initialization not confirmed');
      const saved = state(await call('GET', root(cid) + '/workspace', undefined, signal), cid);
      if (!saved.initialized) return fail('Workspace initialization not confirmed');
      return saved;
    },
    async getAgents(cid: string, signal?: AbortSignal) { return document(await call('GET', root(cid) + '/agents', undefined, signal), cid); },
    async saveAgents(cid: string, content: string, previous: string | null): Promise<AgentsDocument> {
      if (utf8Size(text(content)) > MAX_FILE) return fail('Guidelines exceed the file transfer limit');
      const headers: ConditionalHeaders = previous === null ? { 'If-None-Match': '*' } : { 'If-Match': etag(previous) };
      const saved = await call('PUT', root(cid) + '/agents', { content }, undefined, headers);
      if (saved.channel_id !== cid || saved.path !== 'AGENTS.md') return fail('Guidelines save identity mismatch');
      const version = etag(saved.etag);
      const readback = document(await call('GET', root(cid) + '/agents'), cid);
      if (readback.content !== content || readback.etag !== version) return fail('Guidelines changed before verification');
      return readback;
    },
    async list(cid: string, directory = '', after: string | null = null, signal?: AbortSignal): Promise<WorkspacePage> {
      path(directory, true);
      if (after !== null && (path(after).includes('/'))) return fail('Invalid workspace cursor');
      const query = '?path=' + encodeURIComponent(directory) + '&limit=100' + (after === null ? '' : '&after=' + encodeURIComponent(after));
      const body = await call('GET', root(cid) + '/files' + query, undefined, signal);
      if (body.channel_id !== cid || body.path !== directory) return fail('Workspace listing identity mismatch');
      const seen = new Set<string>();
      const items = rows(body.items).map(raw => {
        const item = object(raw), name = path(text(item.name));
        if (name.includes('/') || item.path !== (directory ? directory + '/' : '') + name || seen.has(name) ||
            after !== null && nameOrder(name, after) <= 0 || !['file', 'directory', 'unavailable'].includes(item.kind as string)) return fail();
        seen.add(name);
        return { name, path: path(text(item.path)), kind: item.kind as WorkspaceEntry['kind'], size: item.kind === 'file' ? size(item.size) : null };
      });
      const nextAfter = body.next_after === null ? null : path(text(body.next_after));
      if (nextAfter !== null && (!items.length || nextAfter !== items.at(-1)!.name)) return fail('Workspace cursor did not advance');
      return { channelId: cid, path: directory, items, nextAfter };
    },
    async mkdir(cid: string, directory: string): Promise<void> {
      const result = await call('POST', root(cid) + '/directories', { path: path(directory) });
      if (result.channel_id !== cid || result.path !== directory || result.kind !== 'directory') return fail('Directory creation not confirmed');
    },
    async readFile(cid: string, file: string, signal?: AbortSignal): Promise<Uint8Array> {
      const value = await download(root(cid) + '/file?path=' + encodeURIComponent(path(file)), signal);
      if (!(value instanceof Uint8Array) || value.byteLength > MAX_FILE) return fail('Workspace file exceeds limit');
      return value;
    },
    /** Explicit selection from the validated Channel inventory, not a chat subscription.
     * Reuse the authenticated attachment route; never populate conversation caches. */
    async attachmentSource(cid: string, attachment: Attachment, signal?: AbortSignal): Promise<{ threadId: string; refSeq: number } | null> {
      const key = id(attachment.id), thread = id(attachment.thread_id);
      if (!key.startsWith('att_')) return fail('Invalid attachment identity');
      const body = await call('GET', root(cid) + '/attachments/' + encodeURIComponent(key) + '/source', undefined, signal);
      if (body.channel_id !== cid || body.attachment_id !== key) return fail('Attachment source identity mismatch');
      if (body.source === null) return null;
      const source = object(body.source), refSeq = size(source.ref_seq);
      if (source.thread_id !== thread || refSeq <= 0) return fail('Attachment source mismatch');
      return { threadId: thread, refSeq };
    },
    async readAttachment(attachment: Attachment, signal?: AbortSignal): Promise<Uint8Array> {
      const thread = id(attachment.thread_id), key = id(attachment.id);
      if (!key.startsWith('att_') || attachment.state !== 'available' || size(attachment.size) > MAX_FILE) return fail('Attachment preview unavailable');
      const value = await download('/v1/threads/' + encodeURIComponent(thread) + '/attachments/' + encodeURIComponent(key), signal);
      if (!(value instanceof Uint8Array) || value.byteLength > MAX_FILE) return fail('Attachment exceeds limit');
      return value;
    },
    async attachments(cid: string, after: string | null = null, signal?: AbortSignal): Promise<ChannelAttachmentPage> {
      if (after !== null) id(after);
      const body = await call('GET', root(cid) + '/attachments?limit=100' + (after === null ? '' : '&after=' + encodeURIComponent(after)), undefined, signal);
      if (body.channel_id !== cid) return fail('Channel attachment identity mismatch');
      const seen = new Set<string>();
      const items = rows(body.items).map(raw => {
        const item = object(raw), key = id(item.id), thread = id(item.thread_id);
        if (!key.startsWith('att_') || seen.has(key) || after !== null && key <= after || !['available', 'missing', 'deleted'].includes(item.state as string)) return fail();
        seen.add(key);
        return { id: key, thread_id: thread, state: item.state as Attachment['state'],
          ...(item.state === 'deleted' ? {} : { name: text(item.name), mime: text(item.mime), size: size(item.size), receipt_id: item.receipt_id === null ? null : id(item.receipt_id) }) };
      });
      const nextAfter = body.next_after === null ? null : id(body.next_after);
      if (nextAfter !== null && (!items.length || nextAfter !== items.at(-1)!.id)) return fail('Attachment cursor did not advance');
      return { channelId: cid, items, nextAfter };
    },
  };
}
export type WorkspaceApi = ReturnType<typeof createWorkspaceApi>;
