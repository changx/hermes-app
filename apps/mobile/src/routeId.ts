// Only opaque server IDs are accepted in URLs. Never route tokens or message text.
export function routeId(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
}
