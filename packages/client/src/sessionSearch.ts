export interface SearchableSession { title: string; title_alphabet?: string }
const fold = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();
const compact = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, '');
/** Smaller is better. This uses directory metadata only, never message bodies. */
export function sessionSearchScore(session: SearchableSession, query: string, channel = ''): number {
  const q = fold(query), title = fold(session.title);
  if (!q) return 0;
  if (title === q) return 0;
  if (title.startsWith(q)) return 1;
  if (title.includes(q)) return 2;
  const alphabet = fold(session.title_alphabet ?? ''), key = compact(q);
  if (key && alphabet) {
    const joined = compact(alphabet);
    if (joined.startsWith(key)) return 3;
    if (joined.includes(key)) return 4;
    const initials = alphabet.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(word => [...word][0]).join('');
    if (initials.startsWith(key)) return 5;
    if (initials.includes(key)) return 6;
  }
  return fold(channel).includes(q) ? 7 : Infinity;
}

/**
 * One search, shared by the sidebar search box and the Cmd+K picker: a keyword
 * plus exact labels. Every selected label must be on the session (AND). The
 * keyword matches the title (as above) or a label's text.
 */
export interface SessionQuery { text: string; labels: readonly string[] }
export interface QueryableSession extends SearchableSession { markers?: readonly string[] }
export const emptySessionQuery = (): SessionQuery => ({ text: '', labels: [] });
export const sessionQueryActive = (query: SessionQuery): boolean => !!query.text.trim() || query.labels.length > 0;
export function addQueryLabel(query: SessionQuery, label: string): SessionQuery {
  return query.labels.includes(label) ? query : { ...query, labels: [...query.labels, label] };
}
export function removeQueryLabel(query: SessionQuery, label: string): SessionQuery {
  return { ...query, labels: query.labels.filter(item => item !== label) };
}

/** Smaller is better; Infinity means no match. A label match ranks after a title match of the same kind. */
export function sessionQueryScore(session: QueryableSession, query: SessionQuery, channel = ''): number {
  const markers = session.markers ?? [];
  if (!query.labels.every(label => markers.includes(label))) return Infinity;
  const q = fold(query.text);
  if (!q) return 0;
  const title = sessionSearchScore(session, query.text, channel);
  let label = Infinity;
  for (const marker of markers) {
    const value = fold(marker);
    label = Math.min(label, value === q ? 0.5 : value.startsWith(q) ? 1.5 : value.includes(q) ? 2.5 : Infinity);
  }
  return Math.min(title, label);
}

/** Existing labels whose text contains the keyword, excluding labels already selected. */
export function sessionLabelSuggestions(sessions: readonly QueryableSession[], query: SessionQuery, limit = 6): string[] {
  const q = fold(query.text);
  if (!q) return [];
  const all = [...new Set(sessions.flatMap(session => session.markers ?? []))].filter(label => !query.labels.includes(label));
  const rank = (label: string) => { const value = fold(label); return value === q ? 0 : value.startsWith(q) ? 1 : value.includes(q) ? 2 : Infinity; };
  return all.map(label => ({ label, score: rank(label) })).filter(item => Number.isFinite(item.score))
    .sort((a, b) => a.score - b.score || a.label.localeCompare(b.label)).slice(0, limit).map(item => item.label);
}
