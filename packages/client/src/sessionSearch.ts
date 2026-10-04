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
