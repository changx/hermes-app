import type { Attachment } from '../../../packages/client/src/index';

// One request body is at most 100 MiB (the Cloudflare request-body limit); the adapter
// requires nonempty bytes and a filename <=180 chars.
export const MAX_ATTACHMENTS = 8;
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
// Picked files above MAX_ATTACHMENT_BYTES upload in chunks (server `chunked_uploads`) and
// download natively into a file, so they never enter JS memory whole.
export const MAX_FILE_ATTACHMENT_BYTES = 2 * 1024 * 1024 * 1024;
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
/**
 * Files above the upload limit are too large to download into the app (Agent files have no
 * size limit). The browser downloads them from their public link instead; undefined = no link.
 */
export function tooLargeForApp(attachment: { size?: number }, limit = MAX_ATTACHMENT_BYTES): boolean { return (attachment.size ?? 0) > limit; }
export function browserDownloadUrl(attachment: { size?: number; public_url?: string }, limit = MAX_ATTACHMENT_BYTES): string | undefined {
  return tooLargeForApp(attachment, limit) ? attachment.public_url : undefined;
}
/** The largest attachment this client can hold in the app: native file transfer avoids JS memory. */
export function appDownloadLimit(nativeFiles: boolean): number { return nativeFiles ? MAX_FILE_ATTACHMENT_BYTES : MAX_ATTACHMENT_BYTES; }

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
    // Bytes in memory (pasted) keep the single-request limit; files on disk can upload in chunks.
    const limit = source.data ? MAX_ATTACHMENT_BYTES : MAX_FILE_ATTACHMENT_BYTES;
    if (!name || !source.uri && !source.data || !Number.isFinite(size) || !size || size < 0 || size > limit) {
      error = 'Some files are empty, unreadable, or over 2 GB. Please select them again.';
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
