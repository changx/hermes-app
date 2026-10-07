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
  if (/^image\/(png|jpeg|gif|webp)$/.test(base)) return base;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const assets: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf' };
  if (assets[ext]) return assets[ext];
  if (base === 'text/css' || /\.css$/i.test(name)) return 'text/css';
  if (/\.(js|mjs)$/i.test(name) || ['text/javascript', 'application/javascript'].includes(base)) return 'text/javascript';
  if (base.startsWith('text/') || ['application/json', 'application/xml'].includes(base) || /\.(md|txt|json|csv|log|xml|ya?ml|ts|tsx|jsx|py|sh)$/i.test(name)) return 'text/plain';
  return 'application/octet-stream';
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
export function previewResponse(document: PreviewDocument, rawAsset = false): Response {
  if (!document.bytes.byteLength || document.bytes.byteLength > 10 * 1024 * 1024) throw new Error('The file is too large to preview.');
  const mime = previewMime(document.name, document.mime);
  let body: Uint8Array | string = document.bytes, contentType = mime;
  if (!rawAsset && ['text/plain', 'text/css', 'text/javascript', 'application/octet-stream'].includes(mime)) {
    const text = mime === 'application/octet-stream' ? 'This file cannot be previewed. Use Save or Open externally.' : new TextDecoder().decode(document.bytes);
    body = `<!doctype html><meta charset="utf-8"><title>${escapeHtml(document.name)}</title><style>body{margin:20px;color:#1f2937;background:white;font:16px/1.5 system-ui}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><pre>${escapeHtml(text)}</pre>`;
    contentType = 'text/html';
  }
  const pdfViewer = pdfExtension;
  const csp = mime === 'application/pdf'
    ? `default-src 'none'; style-src ${pdfViewer}; frame-src ${pdfViewer}; object-src 'self'`
    : "default-src 'self' https: http: data: blob:; connect-src 'self' https: http: ws: wss:; script-src 'self' 'unsafe-inline' https: http:; style-src 'self' 'unsafe-inline' https: http:; object-src 'none'; base-uri 'self'; frame-src https: http:; form-action https: http:";
  return new Response(body as BodyInit, { headers: { 'Content-Type': contentType + (contentType.startsWith('text/') ? '; charset=utf-8' : ''), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': csp } });
}
