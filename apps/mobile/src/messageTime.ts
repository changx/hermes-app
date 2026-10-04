/** UNIX seconds, including epoch zero. Older messages may have no timestamp. */
export function validTimestampSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e12;
}

const two = (value: number) => String(value).padStart(2, '0');

export function absoluteMessageTime(seconds: number): string {
  const date = new Date(seconds * 1000);
  return `${two(date.getMonth() + 1)}/${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

export function accessibleMessageTime(seconds: number): string {
  const date = new Date(seconds * 1000);
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** Hide only the current local year; retain the full timestamp for accessibility. */
export function userMessageTime(seconds: number, nowMs: number = Date.now()): string {
  const full = accessibleMessageTime(seconds);
  return new Date(seconds * 1000).getFullYear() === new Date(nowMs).getFullYear() ? full.slice(full.indexOf('-') + 1) : full;
}

export function formatMessageTime(seconds: unknown, nowMs: number): string {
  if (!validTimestampSeconds(seconds)) return '—';
  const age = Math.floor(Math.max(0, nowMs / 1000 - seconds));
  if (age < 60) return '<1m';
  if (age < 3600) return `${Math.floor(age / 60)}m ago`;
  if (age < 86400) return `${Math.floor(age / 3600)}h ago`;
  return absoluteMessageTime(seconds);
}

/** Fixed minute cadence; no sub-minute/hour-specific timer or absolute/unknown ticks. */
export function nextMessageTimeUpdate(seconds: unknown, nowMs: number): number | null {
  if (!validTimestampSeconds(seconds)) return null;
  const ageMs = Math.max(0, nowMs - seconds * 1000);
  if (ageMs >= 86400000) return null;
  return 60000;
}