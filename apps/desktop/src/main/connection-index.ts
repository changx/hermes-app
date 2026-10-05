import { app } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type ConnectionEntry = { id: string; server: string };
export function validateEntries(raw: unknown): ConnectionEntry[] {
  if (!Array.isArray(raw) || raw.length > 7) throw new Error('Invalid connection list');
  const ids = new Set<string>();
  return raw.map(item => {
    if (!item || !/^[0-9a-f]{24}$/.test(item.id) || ids.has(item.id) || typeof item.server !== 'string') throw new Error('Invalid connection list');
    const url = new URL(item.server);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.origin !== item.server) throw new Error('Invalid connection list');
    ids.add(item.id);
    return { id: item.id, server: item.server };
  });
}
/** Only local slot IDs and public server addresses. Credentials remain in safeStorage files. */
export class ConnectionIndex {
  private readonly path = join(app.getPath('userData'), 'connections.json');
  async load(): Promise<ConnectionEntry[]> {
    let text: string;
    try { text = await readFile(this.path, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const data = JSON.parse(text);
    if (data.version !== 1) throw new Error('Invalid connection list');
    return validateEntries(data.entries);
  }
  async save(entries: readonly ConnectionEntry[]): Promise<void> {
    const verified = validateEntries(entries);
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await writeFile(this.path + '.new', JSON.stringify({ version: 1, entries: verified }), { mode: 0o600 });
    await rename(this.path + '.new', this.path);
    if (JSON.stringify(await this.load()) !== JSON.stringify(verified)) throw new Error('Connection list save was not confirmed');
  }
}
