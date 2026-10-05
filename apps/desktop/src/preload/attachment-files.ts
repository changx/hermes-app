import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_FILES, type AttachmentInput } from '../shared/attachment-input';

export async function filesForUpload(files: readonly File[], pathForFile: (file: File) => string): Promise<AttachmentInput[]> {
  if (files.length > MAX_ATTACHMENT_FILES || files.some(file => !file.size || file.size > MAX_ATTACHMENT_BYTES)) {
    throw new Error('Choose up to eight files, each between 1 byte and 10 MiB.');
  }
  const inputs: AttachmentInput[] = [];
  for (const file of files) {
    const path = pathForFile(file);
    // Screenshots and copied browser images have no disk path.
    inputs.push(path || { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  }
  return inputs;
}
