import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function chromeUserAgent(platform: string, version: string): string {
  const major = /^\d+/.exec(version)?.[0];
  if (!major) throw new Error('Invalid Chromium version');
  const system = platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${system}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

export function browserUrl(value: string): string {
  const input = value.trim();
  if (!input || input.length > 4096 || /[\x00-\x1f\x7f]/.test(input)) throw new Error('Enter a web address.');
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP or HTTPS address without a password.');
  return url.href;
}

export const pdfExtension = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai';
// The built-in PDF viewer loads its scripts and styles from chrome://resources.
// Allow only those subresources, and only when the PDF viewer frame requests them.
export function pdfViewerResource(details: { url: string; resourceType: string; frame?: { url: string } | null }): boolean {
  if (!details.url.startsWith('chrome://resources/') || !['script', 'stylesheet', 'image', 'font'].includes(details.resourceType)) return false;
  try { return details.frame?.url.startsWith(`${pdfExtension}/`) === true; } catch { return false; }
}
export type PreviewDocument = { name: string; mime: string; bytes: Uint8Array };
export function previewMime(name: string, mime: string): string {
  const base = mime.toLowerCase().split(';')[0];
  if (/\.html?$/i.test(name) || base === 'text/html') return 'text/html';
  if (/\.pdf$/i.test(name) || base === 'application/pdf') return 'application/pdf';
  if (/\.(md|markdown|mdown|mkd)$/i.test(name) || base === 'text/markdown') return 'text/markdown';
  if (/^image\/(png|jpeg|gif|webp)$/.test(base)) return base;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const assets: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
    // Chromium's demuxer reads MOV/M4V as MP4.
    mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg' };
  if (assets[ext]) return assets[ext];
  if (/^(video\/(mp4|webm|ogg)|audio\/(mpeg|mp4|aac|wav|x-wav|flac|ogg|webm))$/.test(base)) return base;
  if (base === 'text/css' || /\.css$/i.test(name)) return 'text/css';
  if (/\.(js|mjs)$/i.test(name) || ['text/javascript', 'application/javascript'].includes(base)) return 'text/javascript';
  if (base.startsWith('text/') || ['application/json', 'application/xml'].includes(base) || /\.(md|txt|json|csv|log|xml|ya?ml|ts|tsx|jsx|py|sh)$/i.test(name)) return 'text/plain';
  return 'application/octet-stream';
}
const markdownCss = 'body{margin:0;background:white;color:#1f2937;font:16px/1.6 system-ui}main{max-width:860px;margin:0 auto;padding:24px 28px 48px}'
  + 'h1,h2{border-bottom:1px solid #e5e7eb;padding-bottom:.3em}a{color:#215ca7}img{max-width:100%}'
  + 'pre{background:#f6f8fa;padding:12px;border-radius:6px;overflow:auto}code{font:13px/1.45 ui-monospace,Menlo,monospace;background:#f6f8fa;padding:.1em .3em;border-radius:4px}pre code{padding:0}'
  + 'table{border-collapse:collapse;display:block;overflow:auto}th,td{border:1px solid #d0d7de;padding:6px 12px}blockquote{margin:0;padding:0 1em;color:#57606a;border-left:4px solid #d0d7de}';
/** Markdown becomes static HTML. Raw HTML inside it is escaped and no script can run. */
export function markdownPage(name: string, text: string): string {
  const body = renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkGfm] }, text));
  return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(name)}</title><style>${markdownCss}</style><main>${body}</main>`;
}
/** One `bytes=start-end` range inside the body, or undefined when absent or unusable. */
export function byteRange(header: string | null | undefined, size: number): { start: number; end: number } | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec((header || '').trim());
  if (!match || (!match[1] && !match[2])) return undefined;
  let start = match[1] ? Number(match[1]) : size - Number(match[2]), end = match[1] && match[2] ? Number(match[2]) : size - 1;
  if (!match[1]) start = Math.max(0, start);
  end = Math.min(end, size - 1);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end && start < size ? { start, end } : undefined;
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
export function previewResponse(document: PreviewDocument, rawAsset = false, range?: string | null): Response {
  if (!document.bytes.byteLength || document.bytes.byteLength > 10 * 1024 * 1024) throw new Error('The file is too large to preview.');
  const mime = previewMime(document.name, document.mime);
  let body: Uint8Array | string = document.bytes, contentType = mime;
  if (!rawAsset && mime === 'text/markdown') {
    body = markdownPage(document.name, new TextDecoder().decode(document.bytes)); contentType = 'text/html';
  } else if (!rawAsset && ['text/plain', 'text/css', 'text/javascript', 'application/octet-stream'].includes(mime)) {
    const text = mime === 'application/octet-stream' ? 'This file cannot be previewed. Use Save or Open externally.' : new TextDecoder().decode(document.bytes);
    body = `<!doctype html><meta charset="utf-8"><title>${escapeHtml(document.name)}</title><style>body{margin:20px;color:#1f2937;background:white;font:16px/1.5 system-ui}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><pre>${escapeHtml(text)}</pre>`;
    contentType = 'text/html';
  }
  const pdfViewer = pdfExtension;
  const csp = mime === 'application/pdf'
    ? `default-src 'none'; style-src ${pdfViewer}; frame-src ${pdfViewer}; object-src 'self'`
    : !rawAsset && mime === 'text/markdown' ? "default-src 'none'; img-src 'self' https: http: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
    : "default-src 'self' https: http: data: blob:; connect-src 'self' https: http: ws: wss:; script-src 'self' 'unsafe-inline' https: http:; style-src 'self' 'unsafe-inline' https: http:; object-src 'none'; base-uri 'self'; frame-src https: http:; form-action https: http:";
  const headers: Record<string, string> = { 'Content-Type': contentType + (contentType.startsWith('text/') ? '; charset=utf-8' : ''), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': csp };
  if (typeof body === 'string') return new Response(body, { headers });
  // Media elements seek with Range requests.
  headers['Accept-Ranges'] = 'bytes';
  const part = byteRange(range, body.byteLength);
  if (range && !part) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${body.byteLength}` } });
  if (!part) return new Response(body as BodyInit, { headers });
  return new Response(body.slice(part.start, part.end + 1) as BodyInit, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${part.start}-${part.end}/${body.byteLength}` } });
}
