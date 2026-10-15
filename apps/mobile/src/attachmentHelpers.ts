import type { Attachment } from '../../../packages/client/src/index';

// The adapter caps bodies at 100 MiB (the Cloudflare request-body limit), requires
// nonempty bytes and a filename <=180 chars.
export const MAX_ATTACHMENTS = 8;
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
// A pasted image arrives as a base64 string in JS memory, so it keeps the old 10 MiB bound.
export const MAX_CLIPBOARD_IMAGE_BYTES = 10 * 1024 * 1024;
// Images up to this size download on their own for the message thumbnail; larger ones when tapped.
export const MAX_THUMBNAIL_BYTES = 10 * 1024 * 1024;
export type PickedAttachment = { uri?: string; name: string; mime?: string | null; size?: number; data?: Uint8Array };
export type DraftAttachment = { key: number; source: PickedAttachment; status: 'uploading' | 'ready' | 'failed'; attachment?: Attachment; error?: string };

export function safeFilename(name: string, mime?: string | null): string {
  const fallback = mime === 'image/jpeg' ? 'image.jpg' : mime === 'image/png' ? 'image.png' : 'attachment';
  const value = (name || fallback).replace(/[\\/\r\n\0]/g, '_').trim();
  return value && value !== '.' && value !== '..' ? value.slice(0, 180) : fallback;
}
export function isImage(mime?: string | null, name?: string): boolean {
  // The adapter determines MIME by filename, not picker-supplied metadata.
  return /\.(png|jpe?g|gif|webp|heic|heif|bmp)$/i.test(name || '') && (!mime || mime.startsWith('image/'));
}
export function chooseAttachments(existing: number, incoming: PickedAttachment[]): { accepted: PickedAttachment[]; error?: string } {
  const room = Math.max(0, MAX_ATTACHMENTS - existing);
  const accepted: PickedAttachment[] = [];
  let error: string | undefined;
  for (const source of incoming) {
    if (accepted.length >= room) { error = 'You can add up to 8 attachments.'; break; }
    const name = safeFilename(source.name, source.mime);
    const size = source.data?.byteLength ?? source.size;
    if (!name || !source.uri && !source.data || !Number.isFinite(size) || !size || size < 0 || size > MAX_ATTACHMENT_BYTES) {
      error = 'Some files are empty, unreadable, or over 100 MB. Please select them again.';
      continue;
    }
    accepted.push({ ...source, name, size });
  }
  return { accepted, error };
}
export function uploadedInOrder(items: DraftAttachment[]): Attachment[] {
  return items.filter(item => item.status === 'ready' && item.attachment?.state === 'available').map(item => item.attachment!);
}
export function draftBusy(items: DraftAttachment[]): boolean {
  return items.some(item => item.status !== 'ready');
}
