/** UNIX seconds, including epoch zero. Older messages may have no timestamp. */
export function validTimestampSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e12;
}

const two = (value: number) => String(value).padStart(2, '0');

export function absoluteMessageTime(seconds: number): string {
  const date = new Date(seconds * 1000);
  return `${two(date.getMonth() + 1)}/${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}

export function accessibleMessageTime(seconds: number): string {
  const date = new Date(seconds * 1000);
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}

export function formatMessageTime(seconds: unknown, nowMs: number): string {
  if (!validTimestampSeconds(seconds)) return '—';
  const age = Math.floor(Math.max(0, nowMs / 1000 - seconds));
  if (age < 60) return `${age}s ago`;
  if (age < 3600) return `${Math.floor(age / 60)}m ago`;
  if (age < 86400) return `${Math.floor(age / 3600)}h ago`;
  return absoluteMessageTime(seconds);
}

/** Milliseconds until the label could change; no timer for absolute/unknown. */
export function nextMessageTimeUpdate(seconds: unknown, nowMs: number): number | null {
  if (!validTimestampSeconds(seconds)) return null;
  const ageMs = Math.max(0, nowMs - seconds * 1000);
  if (ageMs >= 86400000) return null;
  if (nowMs < seconds * 1000) return Math.max(1, Math.min(2147483647, Math.ceil(seconds * 1000 - nowMs)));
  const quantum = ageMs < 60000 ? 1000 : ageMs < 3600000 ? 60000 : 3600000;
  return Math.max(1, Math.ceil(quantum - ageMs % quantum));
}