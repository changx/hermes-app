/**
 * Session full-text search over message text (plugin capability `session_search`) and its AI
 * refine (`session_search_refine`). The server's embedding service ranks Sessions by keywords and
 * meaning; refine asks a small model to pick and order the best ones, or to say none fits.
 * Route-owned; never cached in the directory.
 */

/** One Session whose messages match. `seq` is the best message's ref_seq (null: the title or labels matched). */
export type SessionTextHit = {
  thread_id: string; title: string; channel_id: string; channel_name: string;
  markers: string[]; seq: number | null; snippet: string; rank: number;
};
/** `available: false`: the server's index is down. `ready: false`: it is still indexing older messages. */
export type SessionTextPage = { query: string; labels: string[]; available: boolean; ready: boolean; items: SessionTextHit[] };
/** `none`: the model found no Session that fits the question. */
export type SessionTextRefinement = { query: string; labels: string[]; available: boolean; items: SessionTextHit[]; none: boolean };

type Call = (method: string, path: string, body?: unknown, signal?: AbortSignal) => Promise<Record<string, unknown>>;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_QUERY = 200, MAX_LABELS = 10, MAX_ITEMS = 50;

export function createSessionTextApi(call: Call, error: (message: string) => Error) {
  const fail = (message = 'Invalid session search response'): never => { throw error(message); };
  const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : fail();
  const id = (v: unknown): string => typeof v === 'string' && ID.test(v) ? v : fail('Invalid session identity');
  const text = (v: unknown): string => typeof v === 'string' ? v : fail();
  const count = (v: unknown): number => Number.isSafeInteger(v) && (v as number) >= 0 ? v as number : fail();
  const hit = (raw: unknown): SessionTextHit => {
    const item = object(raw);
    const markers = Array.isArray(item.markers) ? item.markers.map(text) : fail();
    return { thread_id: id(item.thread_id), title: text(item.title), channel_id: id(item.channel_id), channel_name: text(item.channel_name), markers,
      seq: item.seq === null ? null : count(item.seq), snippet: text(item.snippet), rank: count(item.rank) };
  };
  const items = (v: unknown): SessionTextHit[] => {
    const list = Array.isArray(v) && v.length <= MAX_ITEMS ? v.map(hit) : fail();
    if (new Set(list.map(item => item.thread_id)).size !== list.length) fail('Duplicate session');
    if (list.some((item, i) => item.rank !== i + 1)) fail('Invalid session ranking');
    return list;
  };
  const request = async (path: string, query: string, labels: readonly string[], signal?: AbortSignal) => {
    const q = query.trim();
    if (!q || q.length > MAX_QUERY || labels.length > MAX_LABELS || labels.some(label => typeof label !== 'string' || !label)) return fail('Invalid session search');
    const params = new URLSearchParams({ q });
    for (const label of labels) params.append('labels', label);
    const body = await call('GET', `${path}?${params.toString()}`, undefined, signal);
    if (body.query !== q || !Array.isArray(body.labels) || body.labels.length !== labels.length || body.labels.some((label, i) => label !== labels[i])) return fail('Session search identity mismatch');
    if (typeof body.available !== 'boolean') return fail();
    return { q, body };
  };
  return {
    /** Keyword (required) and exact labels (AND). Fast: no model call. */
    async search(query: string, labels: readonly string[] = [], signal?: AbortSignal): Promise<SessionTextPage> {
      const { q, body } = await request('/v1/sessions/search', query, labels, signal);
      return { query: q, labels: [...labels], available: body.available as boolean, ready: body.ready === true, items: items(body.items) };
    },
    /** The same search, picked and ordered by a model. Slower (seconds); call after `search`. */
    async refine(query: string, labels: readonly string[] = [], signal?: AbortSignal): Promise<SessionTextRefinement> {
      const { q, body } = await request('/v1/sessions/search/refine', query, labels, signal);
      if (typeof body.none !== 'boolean') return fail();
      return { query: q, labels: [...labels], available: body.available as boolean, items: items(body.items), none: body.none };
    },
  };
}
export type SessionTextApi = ReturnType<typeof createSessionTextApi>;

/**
 * Message matches to show under the title matches: drops Sessions already listed by title, then
 * merges several servers by rank (the best of each server first). `key` qualifies a Session by server.
 */
export function messageMatches<T extends { hit: SessionTextHit }>(pages: readonly (readonly T[])[], shown: ReadonlySet<string>, key: (row: T) => string, limit = 20): T[] {
  const rows = pages.flatMap(page => page.filter(row => !shown.has(key(row))));
  return rows.sort((a, b) => a.hit.rank - b.hit.rank).slice(0, limit);
}
