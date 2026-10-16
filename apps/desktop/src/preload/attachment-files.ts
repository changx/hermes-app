import { ATTACHMENT_SIZE_RULE, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_FILES, MAX_FILE_ATTACHMENT_BYTES, PASTED_SIZE_RULE, type AttachmentInput } from '../shared/attachment-input';

export async function filesForUpload(files: readonly File[], pathForFile: (file: File) => string): Promise<AttachmentInput[]> {
  if (files.length > MAX_ATTACHMENT_FILES || files.some(file => !file.size || file.size > MAX_FILE_ATTACHMENT_BYTES)) {
    throw new Error(ATTACHMENT_SIZE_RULE);
  }
  // Bytes without a disk path cross IPC whole; keep them at the single-request limit.
  if (files.some(file => file.size > MAX_ATTACHMENT_BYTES && !pathForFile(file))) throw new Error(PASTED_SIZE_RULE);
  const inputs: AttachmentInput[] = [];
  for (const file of files) {
    const path = pathForFile(file);
    // Screenshots and copied browser images have no disk path.
    inputs.push(path || { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  }
  return inputs;
}
