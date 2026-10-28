import { sessionServer } from './sessionLinks';

/** An HTML attachment the server published as a web page (plugin 0.2.51+): `/media/<id>/site/<name>`.
 * The server sends only the path; each client joins it to the connection's own server address,
 * so no public base URL has to be configured on the server. The page loads its images, styles and
 * videos by relative paths under the same `/media/<id>/site/` folder. */
const pageName = /^[A-Za-z0-9%._~!$&'()*+,;=:@-]{1,600}$/;

export function validSitePath(attachmentId: string, value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^att_[0-9a-f]{32}$/.test(attachmentId)) return undefined;
  const prefix = '/media/' + attachmentId + '/site/';
  if (!value.startsWith(prefix)) return undefined;
  const name = value.slice(prefix.length);
  if (!pageName.test(name)) return undefined;
  try {
    const decoded = decodeURIComponent(name);
    if (!decoded || decoded === '.' || decoded === '..' || /[/\\\u0000-\u001f]/.test(decoded) || !/\.html?$/i.test(decoded)) return undefined;
  } catch { return undefined; }
  return value;
}

/** Full web page link for an attachment on this connection's server, or undefined for an ordinary file. */
export function attachmentPageUrl(server: string | null | undefined, attachment: { id: string; state?: string; site_path?: string }): string | undefined {
  if (!server || attachment.state !== 'available') return undefined;
  const base = sessionServer(server), path = validSitePath(attachment.id, attachment.site_path);
  return base && path ? base + path : undefined;
}
