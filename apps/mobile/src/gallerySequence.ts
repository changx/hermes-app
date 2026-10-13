/** Pure helpers for the attachment gallery (no React Native imports, so tests can load them). */

/**
 * All available attachments of a Thread, in timeline order, without duplicates.
 * The tapped attachment is always part of the result.
 */
export function gallerySequence<T extends { id: string; state?: string }>(groups: ReadonlyArray<readonly T[] | undefined>, selected: T): { items: T[]; index: number } {
  const seen = new Set<string>(), items: T[] = [];
  for (const group of groups) for (const item of group ?? []) {
    if (item.state !== 'available' || seen.has(item.id)) continue;
    seen.add(item.id); items.push(item);
  }
  const index = items.findIndex(item => item.id === selected.id);
  return index < 0 ? { items: [selected], index: 0 } : { items, index };
}

/** The page shown at a horizontal offset. */
export function galleryPage(offset: number, width: number, count: number): number {
  if (!(width > 0) || count < 1) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(offset / width)));
}
