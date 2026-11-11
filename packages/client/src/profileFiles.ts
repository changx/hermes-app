/** SOUL.md, USER.md and MEMORY.md of the connected profile (plugin capability `profile_files`). */
export type ProfileFileKind = 'soul' | 'user' | 'memory';
export const PROFILE_FILE_KINDS: readonly ProfileFileKind[] = ['soul', 'user', 'memory'];
/** Longest text the server saves (plugin profile_files.MAX_CHARS). */
export const PROFILE_FILE_MAX_CHARS = 100_000;
/** Core memory entry delimiter: a line that holds only "§". */
const ENTRY_LINE = /^[ \t]*§[ \t]*$/m;
const DELIMITER = '\n§\n';

export interface ProfileFile {
  kind: ProfileFileKind;
  name: string;
  content: string;
  /** SHA-256 of the file on the server; empty when the file does not exist. Send it back on save. */
  version: string;
  exists: boolean;
  /** USER.md and MEMORY.md: the character limit of the profile. */
  limit?: number;
  /** USER.md and MEMORY.md: characters that count against the limit. */
  used?: number;
  /** USER.md and MEMORY.md: false when the profile config turns this memory off. */
  enabled?: boolean;
}

/** Entries of a memory text, as the server stores them (plugin profile_files.entries_of). */
export function memoryEntries(text: string): string[] {
  const parts = text.replace(/\r\n/g, '\n').split(new RegExp(ENTRY_LINE.source, 'gm')).map(part => part.trim()).filter(Boolean);
  return [...new Set(parts)];
}

/** Characters of a memory text that count against its limit. */
export const memoryUsed = (text: string): number => memoryEntries(text).join(DELIMITER).length;

/** Plain message for a refused save, by the server's error code. */
export function profileFileSaveError(code: string | undefined, status: number | undefined, name: string, limit?: number): string {
  if (status === 409 || code === 'version_conflict') return `${name} changed on Hermes after you opened it. Load the latest version, then make your change again.`;
  if (code === 'over_limit') return limit ? `${name} can hold ${limit.toLocaleString('en-US')} characters. Make the text shorter.` : `${name} is too long. Make the text shorter.`;
  if (code === 'blocked_text') return 'Part of this text looks like an instruction that could take control of Hermes. Hermes does not save it. Change or remove that part.';
  if (code === 'managed_file') return `${name} is managed outside Hermes App and cannot be changed here.`;
  if (code === 'invalid_text') return `The text is too long. Use up to ${PROFILE_FILE_MAX_CHARS.toLocaleString('en-US')} characters.`;
  return `Could not save ${name}. Check the connection and try again.`;
}
