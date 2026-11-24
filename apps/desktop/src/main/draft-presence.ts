/** Records whether a Thread has a meaningful draft. True only when the presence changed:
 * the sidebar draft badge then needs a new snapshot. Ordinary keystrokes publish nothing. */
export function updateDraftPresence(threads: Set<string>, threadId: string, draft: unknown): boolean {
  const value = draft && typeof draft === 'object' ? draft as { text?: unknown; attachments?: unknown } : {};
  const has = typeof value.text === 'string' && (value.text.trim() !== '' || Array.isArray(value.attachments) && value.attachments.length > 0);
  if (threads.has(threadId) === has) return false;
  if (has) threads.add(threadId); else threads.delete(threadId);
  return true;
}
