import { MAX_ATTACHMENT_BYTES, MAX_FILE_ATTACHMENT_BYTES } from '../shared/attachment-input';

// Names for pasted files that have no disk path (screenshots, images copied from a
// browser). Chromium names them all "image.png", so several pastes look the same to
// the user and to the Agent. Files copied from Finder keep their own names.

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/tiff': 'tiff',
  'image/heic': 'heic', 'image/bmp': 'bmp', 'application/pdf': 'pdf', 'text/plain': 'txt', 'text/html': 'html',
  'text/markdown': 'md', 'text/csv': 'csv', 'application/json': 'json', 'application/zip': 'zip',
};

const two = (value: number) => String(value).padStart(2, '0');

function extension(file: File): string {
  const own = /\.([A-Za-z0-9]{1,10})$/.exec(file.name)?.[1];
  return (own ?? EXTENSIONS[file.type.toLowerCase()] ?? '').toLowerCase();
}

/** "Pasted 2026-10-16 14.03.22.png", then "… 14.03.22 2.png" when the name is taken. */
export function pastedFileName(file: File, now: Date, taken: ReadonlySet<string>): string {
  const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}.${two(now.getMinutes())}.${two(now.getSeconds())}`;
  const ext = extension(file), suffix = ext ? '.' + ext : '';
  for (let index = 1; ; index++) {
    const name = `Pasted ${stamp}${index > 1 ? ' ' + index : ''}${suffix}`;
    if (!taken.has(name)) return name;
  }
}

/**
 * Give each pathless file a generated name. `isDiskFile` comes from preload; without it
 * (an older preload) the files stay unchanged. Disk files keep their name and path.
 */
export function namePastedFiles(files: readonly File[], taken: Iterable<string>, now = new Date(),
  isDiskFile = globalThis.window?.hermesDesktop?.isDiskFile): File[] {
  if (!isDiskFile) return [...files];
  const used = new Set(taken);
  return files.map(file => {
    if (isDiskFile(file)) return file;
    const name = pastedFileName(file, now, used);
    used.add(name);
    return new File([file], name, { type: file.type, lastModified: file.lastModified });
  });
}

/** Largest size for one chosen file: disk files upload in chunks, pasted bytes go in one request. */
export function fileSizeLimit(file: File, isDiskFile = globalThis.window?.hermesDesktop?.isDiskFile): number {
  return isDiskFile && !isDiskFile(file) ? MAX_ATTACHMENT_BYTES : MAX_FILE_ATTACHMENT_BYTES;
}
