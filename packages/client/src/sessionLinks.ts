/** Session links identify a stable App Thread, never a physical model session.
 * No credentials, arbitrary routes, commands or auto-pairing in this format. */
export type SessionLink = Readonly<{ threadId: string; server: string }>;
const threadPattern = /^th_[a-zA-Z0-9_-]{1,128}$/;
const unsafe = /[\s\p{Cc}\p{Cf}\\]/u;
export function sessionServer(value: string): string | null {
  if (value.length > 2048 || unsafe.test(value) || !/^https?:\/\//.test(value)) return null;
  try {
    const url = new URL(value);
    if (!url.hostname || url.username || url.password || url.search || url.hash) return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return null;
    return url.href.replace(/\/$/, '');
  } catch { return null; }
}
export function parseSessionLink(value: string): SessionLink | null {
  if (value.length > 4096 || unsafe.test(value) || !/^hermesapp:\/\/session\/th_[a-zA-Z0-9_-]{1,128}\?/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'hermesapp:' || url.host !== 'session' || url.username || url.password || url.hash) return null;
    const threadId = url.pathname.slice(1);
    if (!threadPattern.test(threadId)) return null;
    const fields = [...url.searchParams];
    if (fields.length !== 1 || fields[0][0] !== 'server') return null;
    const server = sessionServer(fields[0][1]);
    return server ? { threadId, server } : null;
  } catch { return null; }
}
export function buildSessionLink(server: string, threadId: string): string {
  const base = sessionServer(server);
  if (!base || !threadPattern.test(threadId)) throw new Error('Invalid session link target');
  return `hermesapp://session/${threadId}?server=${encodeURIComponent(base)}`;
}
export function sessionLinkRoute(value: string): string | null {
  const link = parseSessionLink(value);
  return link ? `/threads/${link.threadId}?server=${encodeURIComponent(link.server)}` : null;
}

/** Route for a URL the OS opens the installed app with. A home-screen launch carries
 * no link, so Expo Router passes the bare app root (`hermesapp:///`): open the home
 * page. Session links map to their Thread; every other app-scheme path is refused.
 * Non-app URLs (ordinary routes, Expo Go `exp://` launches) pass through unchanged. */
export function systemLinkRoute(path: string): string {
  if (!/^hermesapp:/i.test(path)) return path;
  if (/^hermesapp:\/{0,3}$/i.test(path)) return '/';
  return sessionLinkRoute(path) ?? '/session-unavailable';
}

/** Short in-message form without a server (`hermesapp://session/<thread-id>`), like a
 * scheme-relative web link. Valid only inside content shown for one connection, which
 * supplies the server. External entries (OS intents, clipboard) must use the full form. */
const relativePattern = /^hermesapp:\/\/session\/(th_[a-zA-Z0-9_-]{1,128})$/;
export function relativeSessionThread(value: string): string | null {
  if (value.length > 160 || unsafe.test(value)) return null;
  return relativePattern.exec(value)?.[1] ?? null;
}
export const isSessionLinkHref = (value: string): boolean => !!parseSessionLink(value) || !!relativeSessionThread(value);
/** Full link for a full or short session link, resolved against the content's own server. */
export function resolveSessionLink(value: string, server: string | null | undefined): string | null {
  if (parseSessionLink(value)) return value;
  const threadId = relativeSessionThread(value);
  if (!threadId || !server || !sessionServer(server)) return null;
  return buildSessionLink(server, threadId);
}

export function sessionLinksInText(text: string): Array<{ start: number; end: number; url: string }> {
  const links: Array<{ start: number; end: number; url: string }> = [];
  for (const match of text.matchAll(/hermesapp:\/\/session\/[^\s<>\[\](){}`]+/g)) {
    const url = match[0].replace(/[.,!?，。！？；：]+$/, '');
    if (isSessionLinkHref(url)) links.push({ start: match.index, end: match.index + url.length, url });
  }
  return links;
}
type MarkdownNode = { type: string; value?: string; url?: string; children?: MarkdownNode[] };
/** Linkify plain prose only. Code, existing links and image URLs remain inert. */
export function remarkSessionLinks() {
  return (tree: MarkdownNode): void => {
    const visit = (node: MarkdownNode): void => {
      if (!node.children || ['link', 'linkReference', 'code', 'inlineCode', 'html'].includes(node.type)) return;
      node.children = node.children.flatMap(child => {
        if (child.type !== 'text' || !child.value) { visit(child); return [child]; }
        const parts: MarkdownNode[] = []; let at = 0;
        for (const link of sessionLinksInText(child.value)) {
          if (link.start > at) parts.push({ type: 'text', value: child.value.slice(at, link.start) });
          parts.push({ type: 'link', url: link.url, children: [{ type: 'text', value: link.url }] }); at = link.end;
        }
        if (!at) return [child];
        if (at < child.value.length) parts.push({ type: 'text', value: child.value.slice(at) });
        return parts;
      });
    };
    visit(tree);
  };
}
