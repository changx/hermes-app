import { PROFILE_FILE_KINDS, PROFILE_FILE_MAX_CHARS, type ProfileFileKind } from "@hermes-app/client";

/**
 * Checked shapes of profile file IPC payloads (docs/profile-files.md).
 * Pure: unit-tested in tests/profile-files-ipc.test.mjs.
 */
const invalid = (): never => { throw new Error("Invalid desktop request"); };

export const profileFileKind = (value: unknown): ProfileFileKind =>
  typeof value === "string" && (PROFILE_FILE_KINDS as readonly string[]).includes(value) ? value as ProfileFileKind : invalid();

export const profileFileContent = (value: unknown): string =>
  typeof value === "string" && value.length <= PROFILE_FILE_MAX_CHARS && !value.includes("\0") ? value : invalid();

/** SHA-256 hex of the file the user edited, or empty for a file that did not exist. */
export const profileFileVersion = (value: unknown): string =>
  typeof value === "string" && /^(?:[0-9a-f]{64})?$/.test(value) ? value : invalid();
