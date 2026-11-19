/**
 * "Send to main" (docs/side-chat.md): a side chat puts a reply into its source Session's composer.
 * The source page may be mounted under the side chat in the Stack, so it listens for its own draft key;
 * otherwise the text waits in the saved draft until the page opens.
 */
type Drafts = { get(key: string): string | undefined; set(key: string, value: string): void };
const listeners = new Map<string, (text: string) => void>();

/** The source page's composer: `listener` gets the whole new draft text. */
export function onComposerFill(key: string, listener: (text: string) => void): () => void {
  listeners.set(key, listener);
  return () => { if (listeners.get(key) === listener) listeners.delete(key); };
}

/** Adds `text` after the existing draft (one blank line between) and tells a mounted page. Never sends. */
export function fillComposer(key: string, text: string, drafts: Drafts): string {
  const current = drafts.get(key) ?? '';
  const next = current.trim() ? `${current.replace(/\s+$/, '')}\n\n${text}` : text;
  drafts.set(key, next);
  listeners.get(key)?.(next);
  return next;
}
