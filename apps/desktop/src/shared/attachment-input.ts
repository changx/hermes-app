export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
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
