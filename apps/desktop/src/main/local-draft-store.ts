import { app, safeStorage } from 'electron';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DesktopLocalDraft } from '../shared/desktop-api';

const path = () => join(app.getPath('userData'), 'drafts.secure.json');
type Data = { version: 1; identities: Record<string, Record<string, DesktopLocalDraft>> };
const identity = (value: string) => { if (!/^[0-9a-f]{24}$/.test(value)) throw new Error('draft identity'); return value; };
const thread = (value: string) => { if (!value || value.length > 200 || ['__proto__', 'constructor', 'prototype'].includes(value)) throw new Error('draft thread'); return value; };
export function localDraft(value: unknown): DesktopLocalDraft {
  if (!value || typeof value !== 'object') throw new Error('draft data');
  const item = value as DesktopLocalDraft;
  if (typeof item.text !== 'string' || item.text.length > 100_000 || !Array.isArray(item.attachments) || item.attachments.length > 8) throw new Error('draft data');
  const attachments = item.attachments.map(file => {
    if (!file || typeof file.id !== 'string' || !file.id.startsWith('att_') || file.id.length > 200 || typeof file.name !== 'string' || file.name.length > 180 || typeof file.mime !== 'string' || file.mime.length > 200 || !Number.isSafeInteger(file.size) || file.size < 0 || !['available','missing','deleted','uploading'].includes(file.state)) throw new Error('draft attachment');
    return { id: file.id, name: file.name, mime: file.mime, size: file.size, state: file.state };
  });
  return { text: item.text, attachments };
}
function validate(value: Data): Data {
  if (value.version !== 1 || !value.identities || Array.isArray(value.identities) || typeof value.identities !== 'object') throw new Error('draft data');
  for (const [id, records] of Object.entries(value.identities)) {
    identity(id);
    if (!records || typeof records !== 'object' || Array.isArray(records)) throw new Error('draft data');
    for (const [key, draft] of Object.entries(records)) { thread(key); records[key] = localDraft(draft); }
  }
  return value;
}
/** Main-process local storage only. No draft request reaches the server. */
export class LocalDraftStore {
  private mutation: Promise<void> = Promise.resolve();
  async flush(): Promise<void> { await this.mutation; }
  private async read(): Promise<Data> {
    let raw: string;
    try { raw = await readFile(path(), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, identities: {} }; throw new Error('draft storage'); }
    if (!safeStorage.isEncryptionAvailable()) throw new Error('draft storage');
    try {
      const envelope = JSON.parse(raw);
      if (envelope.version !== 1 || typeof envelope.encrypted !== 'string') throw new Error();
      return validate(JSON.parse(safeStorage.decryptString(Buffer.from(envelope.encrypted, 'base64'))));
    } catch { throw new Error('draft storage'); }
  }
  private change(action: (value: Data) => void): Promise<void> {
    const operation = this.mutation.then(async () => {
      const value = await this.read(); action(value);
      if (!safeStorage.isEncryptionAvailable()) throw new Error('draft storage');
      if (!Object.keys(value.identities).length) { await rm(path(), { force: true }); return; }
      const encrypted = safeStorage.encryptString(JSON.stringify(validate(value))).toString('base64');
      await mkdir(dirname(path()), { recursive: true, mode: 0o700 });
      await writeFile(path()+'.new', JSON.stringify({ version: 1, encrypted }), { encoding: 'utf8', mode: 0o600 });
      await rename(path()+'.new', path());
    });
    this.mutation = operation.catch(() => {});
    return operation;
  }
  async list(id: string): Promise<Record<string, DesktopLocalDraft>> {
    identity(id); await this.mutation;
    return (await this.read()).identities[id] ?? {};
  }
  put(id: string, key: string, raw: unknown): Promise<void> {
    identity(id); thread(key); const draft = localDraft(raw);
    return this.change(value => {
      const records = value.identities[id] ?? {};
      if (draft.text !== '' || draft.attachments.length) records[key] = draft; else delete records[key];
      if (Object.keys(records).length) value.identities[id] = records; else delete value.identities[id];
    });
  }
  clear(id: string): Promise<void> { identity(id); return this.change(value => { delete value.identities[id]; }); }
}
