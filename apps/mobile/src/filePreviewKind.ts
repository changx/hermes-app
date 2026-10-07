export type PreviewKind = 'image' | 'pdf' | 'markdown' | 'html' | 'text' | 'video' | 'audio' | 'document' | 'other';

// The attachment and workspace transfer limit. Larger files are refused before download.
export const PREVIEW_MAX_BYTES = 10 * 1024 * 1024;
// Plain text above this size is shown as its first part only; Markdown above it is shown as text.
export const PREVIEW_TEXT_BYTES = 1024 * 1024;
export const PREVIEW_MARKDOWN_BYTES = 200_000;

const extension = (name: string) => /\.([a-z0-9]{1,8})$/i.exec(name)?.[1].toLowerCase() ?? '';
const images = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'bmp']);
const markdown = new Set(['md', 'markdown', 'mdown', 'mkd']);
const html = new Set(['html', 'htm']);
const videos = new Set(['mp4', 'm4v', 'mov', 'webm', '3gp']);
const audios = new Set(['mp3', 'm4a', 'aac', 'wav', 'aif', 'aiff', 'caf', 'flac', 'ogg', 'oga', 'opus']);
// Formats that iOS WKWebView displays natively (Quick Look based).
const documents = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pages', 'numbers', 'key', 'rtf']);
const texts = new Set(['txt', 'text', 'log', 'csv', 'tsv', 'json', 'jsonl', 'ndjson', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env',
  'py', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'css', 'scss', 'sh', 'bash', 'zsh', 'sql', 'go', 'rs', 'rb', 'java', 'kt', 'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'lua', 'r', 'diff', 'patch', 'svg']);

/** Filename/MIME say PDF and the body starts with the `%PDF-` signature. */
export function isPdf(mime?: string | null, name?: string, bytes?: Uint8Array): boolean {
  const declared = mime === 'application/pdf' || /\.pdf$/i.test(name || '');
  if (!declared || !bytes) return declared;
  return bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-';
}

/**
 * Choose a viewer from the file name first, then the MIME type. When bytes are
 * given, a PDF must also carry the `%PDF-` signature.
 */
export function previewKind(name: string, mime?: string | null, bytes?: Uint8Array): PreviewKind {
  const ext = extension(name), type = (mime || '').toLowerCase().split(';')[0].trim();
  if (ext === 'pdf' || type === 'application/pdf') return isPdf(type || undefined, name, bytes) ? 'pdf' : 'other';
  if (images.has(ext) || /^image\/(png|jpe?g|gif|webp|heic|heif|bmp)$/.test(type)) return 'image';
  if (markdown.has(ext) || type === 'text/markdown') return 'markdown';
  if (html.has(ext) || type === 'text/html') return 'html';
  if (videos.has(ext) || type.startsWith('video/')) return 'video';
  if (audios.has(ext) || type.startsWith('audio/')) return 'audio';
  if (documents.has(ext)) return 'document';
  if (texts.has(ext) || type.startsWith('text/') || ['application/json', 'application/xml', 'application/x-yaml'].includes(type)) return 'text';
  return 'other';
}

/** Cache file suffix. AVPlayer and WKWebView choose their decoder from it. */
export function previewSuffix(name: string): string {
  const ext = extension(name);
  return ext ? `.${ext}` : '';
}
