// Message attachment upload limit: the Cloudflare edge in front of the App
// connections accepts request bodies up to 100 MiB.
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
// In-app preview (browser sidebar, gallery, image thumbnails) stays at 10 MiB.
export const MAX_PREVIEW_BYTES = 10 * 1024 * 1024;
// Channel workspace files: the server keeps its own 10 MiB file limit.
export const MAX_WORKSPACE_FILE_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_SIZE_RULE = 'Choose up to eight files, each between 1 byte and 100 MiB.';
export const MAX_ATTACHMENT_FILES = 8;
export type AttachmentInput = string | { name: string; bytes: Uint8Array };

// Validate the entire request before reading disk or starting any uploads.
export function attachmentInputs(value: unknown): AttachmentInput[] {
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENT_FILES) throw new Error('Choose no more than eight files.');
  return value.map(item => {
    if (typeof item === 'string') {
      if (!item || item.length > 4096 || item.includes('\0')) throw new Error('Invalid attachment path.');
      return item;
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || typeof item.name !== 'string' || !item.name || item.name.length > 180
      || item.name === '.' || item.name === '..' || /[/\\\x00-\x1f\x7f]/.test(item.name)
      || !(item.bytes instanceof Uint8Array) || !item.bytes.byteLength || item.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error('Invalid attachment.');
    }
    return { name: item.name, bytes: item.bytes };
  });
}
