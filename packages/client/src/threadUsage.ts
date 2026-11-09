/**
 * Token usage of one Session (plugin `GET /v1/threads/{id}/usage`, capability `thread_usage`).
 *
 * - `contextTokens`: prompt tokens of the latest model request of the Session's current
 *   context, after compaction. `null` when the server has no current value.
 * - `totalTokens`: cumulative tokens of every model request in the Session
 *   (input + cache read + cache write + output), as Hermes core counts them.
 * - `cache`: the prompt cache of the first model request of the latest turn (plugin 0.2.57+,
 *   `turn_first_request`): tokens read from the cache and all input tokens. It shows whether the
 *   cache survived the pause before the turn. `null` when unknown, or when the provider reported no
 *   cache activity (no read and no write), so that "no data" never reads as a 0% hit rate.
 */
export type ThreadCache = Readonly<{ readTokens: number; promptTokens: number }>;
export type ThreadUsage = Readonly<{ contextTokens: number | null; totalTokens: number; cache: ThreadCache | null }>;

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

function parseCache(value: unknown): ThreadCache | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object') return undefined;
  const last = value as Record<string, unknown>;
  const prompt = count(last.prompt_tokens), read = count(last.cache_read_tokens), write = count(last.cache_write_tokens);
  if (prompt === undefined || read === undefined || write === undefined || read > prompt) return undefined;
  return prompt === 0 || read + write === 0 ? null : { readTokens: read, promptTokens: prompt };
}

/** The usage of `threadId` from the response body, or undefined when the body does not match. */
export function parseThreadUsage(body: unknown, threadId: string): ThreadUsage | undefined {
  const usage = body && typeof body === 'object' ? (body as { usage?: unknown }).usage : undefined;
  if (!usage || typeof usage !== 'object') return undefined;
  const value = usage as Record<string, unknown>;
  const total = count(value.total_tokens);
  const context = value.context_tokens === null ? null : count(value.context_tokens);
  const cache = parseCache(value.turn_first_request);
  if (value.thread_id !== threadId || total === undefined || context === undefined || cache === undefined) return undefined;
  return { contextTokens: context === 0 ? null : context, totalTokens: total, cache };
}

/** Compact token count: 950, 28.2K, 125K, 1.2M, 206M, 1.5B. */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0';
  const units: [number, string][] = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [size, unit] of units) {
    if (value < size) continue;
    const scaled = value / size;
    // One decimal below 100 (28.2K), none above (125K). 999.95K rounds up to the next unit.
    const text = scaled < 99.95 ? scaled.toFixed(1).replace(/\.0$/, '') : Math.round(scaled).toString();
    if (text === '1000' && unit !== 'B') return formatTokens(size * 1000);
    return text + unit;
  }
  return String(Math.round(value));
}

/** Cache hit rate in whole percent, rounded down: 99.97% shows 99%; only a full hit shows 100%. */
export const cacheHitPercent = (cache: ThreadCache): number => Math.floor((cache.readTokens / cache.promptTokens) * 100);

/** Full count with digit groups for tooltips and screen readers: 28,202. */
export const exactTokens = (value: number): string => Math.round(value).toLocaleString('en-US');
