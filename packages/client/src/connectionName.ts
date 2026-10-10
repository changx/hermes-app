/**
 * A connection name is chosen on one device and stays on that device.
 * An empty name means "use the server's host name".
 */
export const CONNECTION_NAME_MAX = 40;
export const CONNECTION_NAME_INVALID = 'Name contains unsupported characters.';
export const CONNECTION_NAME_TOO_LONG = `Name must be ${CONNECTION_NAME_MAX} characters or fewer.`;
// Control and bidirectional override characters could disguise another name.
const forbidden = /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u206f]/u;

/** Returns the trimmed name, or throws a message that can be shown to the user. */
export function normalizeConnectionName(value: string): string {
  if (forbidden.test(value)) throw new Error(CONNECTION_NAME_INVALID);
  const trimmed = value.trim();
  if (Array.from(trimmed).length > CONNECTION_NAME_MAX) throw new Error(CONNECTION_NAME_TOO_LONG);
  return trimmed;
}

/** Host name of a server address, the default connection name. */
export function serverHostName(server: string | null | undefined): string | null {
  if (!server) return null;
  try { return new URL(server).hostname || null; } catch { return null; }
}
