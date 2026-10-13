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
/** Fixed app files the preview page may load: `hermes-preview://<host>/__hermes_preview__/<name>`.
 * Attachment names cannot contain `/`, so this path never names an attachment. */
export const PREVIEW_ASSET_PATH = '/__hermes_preview__/';
export function previewAssetType(name: string): string | undefined {
  if (name === 'markdown-preview.js') return 'text/javascript';
  if (name === 'katex.css' || name === 'styles.css') return 'text/css';
  if (/^fonts\/KaTeX_[A-Za-z0-9_-]+\.woff2$/.test(name)) return 'font/woff2';
  return undefined;
}
/** Markdown above this size shows as plain text; the full renderer would be too slow. */
export const MARKDOWN_RENDER_LIMIT = 1024 * 1024;
const nonce = () => { const value = new Uint8Array(18); globalThis.crypto.getRandomValues(value); return btoa(String.fromCharCode(...value)); };
/** Markdown becomes a page that renders the file with the chat message renderer (tables, math,
 * code, Mermaid). Only the app's own script runs (nonce); raw HTML in the file is skipped.
 * The source text is shown as a fallback if the script cannot run. */
export function markdownPage(name: string, text: string): { html: string; csp: string } {
  const key = nonce(), asset = PREVIEW_ASSET_PATH;
  const json = JSON.stringify(text).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(name)}</title>`
    + `<link rel="stylesheet" href="${asset}katex.css"><link rel="stylesheet" href="${asset}styles.css">`
    + '<style>html,body{height:auto;min-height:0;overflow:auto;background:white}body{min-width:0}'
    + '.markdown-preview{max-width:900px;margin:0 auto;padding:16px 14px 48px}.markdown-preview .message-markdown img{max-width:100%;height:auto}'
    + '.markdown-source{visibility:hidden;animation:markdown-fallback 0s 1.5s forwards;white-space:pre-wrap;font:13px/1.5 ui-monospace,Menlo,monospace}@keyframes markdown-fallback{to{visibility:visible}}</style>'
    + `<main class="message message-assistant markdown-preview"><div id="markdown-root"><pre class="markdown-source">${escapeHtml(text)}</pre></div></main>`
    + `<script type="application/json" id="hermes-markdown">${json}</script><script nonce="${key}" src="${asset}markdown-preview.js"></script>`;
  const csp = `default-src 'none'; script-src 'nonce-${key}'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' https: http: data:; object-src 'none'; base-uri 'none'; form-action 'none'`;
  return { html, csp };
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
  let body: Uint8Array | string = document.bytes, contentType = mime, markdownCsp: string | undefined;
  if (!rawAsset && mime === 'text/markdown' && document.bytes.byteLength <= MARKDOWN_RENDER_LIMIT) {
    const page = markdownPage(document.name, new TextDecoder().decode(document.bytes));
    body = page.html; contentType = 'text/html'; markdownCsp = page.csp;
  } else if (!rawAsset && ['text/plain', 'text/markdown', 'text/css', 'text/javascript', 'application/octet-stream'].includes(mime)) {
    const text = mime === 'application/octet-stream' ? 'This file cannot be previewed. Use Save or Open externally.' : new TextDecoder().decode(document.bytes);
    body = `<!doctype html><meta charset="utf-8"><title>${escapeHtml(document.name)}</title><style>body{margin:20px;color:#1f2937;background:white;font:16px/1.5 system-ui}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><pre>${escapeHtml(text)}</pre>`;
    contentType = 'text/html';
  }
  const pdfViewer = pdfExtension;
  const csp = mime === 'application/pdf'
    ? `default-src 'none'; style-src ${pdfViewer}; frame-src ${pdfViewer}; object-src 'self'`
    : markdownCsp ? markdownCsp
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

/** A Session's attachments side by side: `hermes-preview://<host>/__hermes_gallery__`. */
export const GALLERY_PATH = '/__hermes_gallery__';
/** One gallery item: `/__hermes_item__/<index>/<name>`. Its relative links resolve next to it, so
 * `/__hermes_item__/<index>/<other name>` names a sibling resource (Markdown images, page assets). */
export const GALLERY_ITEM_PATH = '/__hermes_item__/';
export type GalleryEntry = { name: string; mime: string };
export type GallerySlide = 'image' | 'video' | 'audio' | 'html' | 'frame';
/** Images and media show directly; every other file uses the single-file preview in a frame. */
export function gallerySlide(name: string, mime: string): GallerySlide {
  const type = previewMime(name, mime);
  if (/^image\/(png|jpeg|gif|webp|bmp|avif)$/.test(type)) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  return type === 'text/html' ? 'html' : 'frame';
}
export function galleryItemUrl(index: number, name: string): string { return `${GALLERY_ITEM_PATH}${index}/${encodeURIComponent(name)}`; }
/** Splits an item path into its index and the requested name. */
export function galleryItemPath(pathname: string): { index: number; name: string } | undefined {
  if (!pathname.startsWith(GALLERY_ITEM_PATH)) return undefined;
  const match = /^(\d{1,4})\/([^/]+)$/.exec(pathname.slice(GALLERY_ITEM_PATH.length));
  if (!match) return undefined;
  try { return { index: Number(match[1]), name: decodeURIComponent(match[2]) }; } catch { return undefined; }
}
export const GALLERY_UNAVAILABLE = 'This file could not be previewed. Use Save or Open externally.';
export function unavailableResponse(): Response {
  return new Response(`<!doctype html><meta charset="utf-8"><title>Preview unavailable</title><style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:white;color:#4b5563;font:15px/1.5 system-ui;padding:24px;box-sizing:border-box;text-align:center}</style><p>${GALLERY_UNAVAILABLE}</p>`,
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } });
}
/**
 * The gallery page: one full-size slide per attachment in a horizontal scroll-snap track.
 * A trackpad swipe, the arrow keys or the side buttons move between slides. Only the current
 * slide and its neighbours hold content; media pauses when its slide leaves. Only the page's
 * own script runs (nonce). HTML attachments run in a sandboxed frame without this origin.
 */
export function galleryPage(entries: readonly GalleryEntry[], start: number): { html: string; csp: string } {
  if (!entries.length) throw new Error('Nothing to preview.');
  const key = nonce(), first = Math.min(Math.max(0, Math.trunc(start) || 0), entries.length - 1);
  const slides = entries.map((entry, index) => `<section class="slide" data-kind="${gallerySlide(entry.name, entry.mime)}" data-src="${escapeHtml(galleryItemUrl(index, entry.name))}" data-title="${escapeHtml(entry.name)}" role="group" aria-roledescription="slide" aria-label="${escapeHtml(`${entry.name}, ${index + 1} of ${entries.length}`)}"></section>`).join('');
  const style = 'html,body{margin:0;height:100%;overflow:hidden;background:#111827;color:#e5e7eb;font:13px/1.4 system-ui}'
    + '#track{display:flex;height:100%;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;overscroll-behavior-x:contain;scrollbar-width:none;outline:none}'
    + '#track::-webkit-scrollbar{display:none}'
    + '.slide{flex:0 0 100%;height:100%;scroll-snap-align:start;scroll-snap-stop:always;display:flex;align-items:center;justify-content:center;overflow:hidden}'
    + '.slide img{max-width:100%;max-height:100%;object-fit:contain;user-select:none}.slide video{max-width:100%;max-height:100%}.slide audio{width:min(480px,90%)}'
    + '.slide iframe{width:100%;height:100%;border:0;background:white}.slide p{margin:24px;text-align:center;color:#d1d5db}'
    + '.nav{position:fixed;top:50%;transform:translateY(-50%);width:34px;height:34px;border:0;border-radius:17px;background:rgba(17,24,39,.62);color:white;font:22px/34px system-ui;cursor:pointer;padding:0}'
    + '.nav:hover{background:rgba(17,24,39,.85)}.nav:disabled{display:none}#prev{left:8px}#next{right:8px}'
    + '#counter{position:fixed;bottom:10px;left:50%;transform:translateX(-50%);padding:2px 10px;border-radius:10px;background:rgba(17,24,39,.62);color:white;font-variant-numeric:tabular-nums;pointer-events:none}'
    + (entries.length < 2 ? '.nav,#counter{display:none}' : '');
  const script = `(()=>{const track=document.getElementById('track'),slides=[...track.children],n=slides.length,prev=document.getElementById('prev'),next=document.getElementById('next'),counter=document.getElementById('counter');`
    + `const unavailable=${JSON.stringify(GALLERY_UNAVAILABLE)};let index=-1;`
    + `const fail=s=>{s.replaceChildren();const p=document.createElement('p');p.textContent=unavailable;s.append(p);};`
    + `const fill=s=>{if(s.firstChild)return;const k=s.dataset.kind,src=s.dataset.src;let e;`
    + `if(k==='image'){e=document.createElement('img');e.alt=s.dataset.title;e.draggable=false;}`
    + `else if(k==='video'||k==='audio'){e=document.createElement(k);e.controls=true;e.preload='metadata';}`
    + `else{e=document.createElement('iframe');e.title=s.dataset.title;if(k==='html')e.setAttribute('sandbox','allow-scripts allow-forms allow-popups');}`
    + `if(k!=='html'&&k!=='frame')e.addEventListener('error',()=>fail(s),{once:true});e.src=src;s.append(e);};`
    + `const show=i=>{if(i===index)return;index=i;slides.forEach((s,j)=>{if(Math.abs(j-i)<=1)fill(s);else s.replaceChildren();if(j!==i){s.inert=true;s.querySelectorAll('video,audio').forEach(m=>m.pause());}else s.inert=false;});`
    + `document.title=slides[i].dataset.title;counter.textContent=(i+1)+' / '+n;prev.disabled=i===0;next.disabled=i===n-1;};`
    + `const width=()=>track.clientWidth||1,current=()=>Math.min(n-1,Math.max(0,Math.round(track.scrollLeft/width())));`
    + `const reduce=matchMedia('(prefers-reduced-motion: reduce)');`
    + `const go=i=>{i=Math.min(n-1,Math.max(0,i));track.scrollTo({left:i*width(),behavior:reduce.matches?'auto':'smooth'});};`
    + `let timer;track.addEventListener('scroll',()=>{clearTimeout(timer);timer=setTimeout(()=>show(current()),120);},{passive:true});track.addEventListener('scrollend',()=>show(current()));`
    + `prev.addEventListener('click',()=>go(index-1));next.addEventListener('click',()=>go(index+1));`
    + `addEventListener('keydown',e=>{const t=e.target;if(e.defaultPrevented||e.altKey||e.ctrlKey||e.metaKey||t instanceof HTMLMediaElement||t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))return;`
    + `if(e.key==='ArrowLeft'){e.preventDefault();go(index-1);}else if(e.key==='ArrowRight'){e.preventDefault();go(index+1);}});`
    + `new ResizeObserver(()=>{track.scrollLeft=index*width();}).observe(track);`
    + `index=-1;show(${first});track.scrollLeft=${first}*width();track.focus({preventScroll:true});})();`;
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(entries[first].name)}</title>`
    + `<style nonce="${key}">${style}</style><div id="track" tabindex="-1" role="region" aria-roledescription="carousel" aria-label="Attachments">${slides}</div>`
    + `<button type="button" class="nav" id="prev" aria-label="Previous attachment">‹</button><button type="button" class="nav" id="next" aria-label="Next attachment">›</button><div id="counter" aria-live="polite"></div>`
    + `<script nonce="${key}">${script}</script>`;
  const csp = `default-src 'none'; script-src 'nonce-${key}'; style-src 'nonce-${key}'; img-src 'self'; media-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  return { html, csp };
}
