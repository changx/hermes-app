import { open } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { attachmentInputs, MAX_ATTACHMENT_BYTES } from '../shared/attachment-input';
import type { PreviewDocument } from '../shared/browser-policy';

export async function localPreview(value: unknown): Promise<PreviewDocument> {
  const input = attachmentInputs([value])[0];
  if (typeof input !== 'string') return { ...input, mime: 'application/octet-stream' };
  if (!isAbsolute(input)) throw new Error('Invalid file path');
  const handle = await open(input, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || !info.size || info.size > MAX_ATTACHMENT_BYTES) throw new Error('Unsupported file size');
    const bytes = new Uint8Array(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error('The file changed while it was being read.');
      offset += bytesRead;
    }
    if ((await handle.stat()).size !== info.size) throw new Error('The file changed while it was being read.');
    attachmentInputs([{ name: basename(input), bytes }]);
    return { name: basename(input), mime: 'application/octet-stream', bytes };
  } finally { await handle.close(); }
}
