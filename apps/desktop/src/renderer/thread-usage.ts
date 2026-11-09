import { useEffect, useState } from 'react';
import { cacheHitPercent, exactTokens, formatTokens } from '../../../../packages/client/src/threadUsage';
import type { DesktopThreadUsage } from '../shared/desktop-api';

/**
 * Session token usage for the sidebar card and the Session status bar.
 *
 * Hermes core updates both values when a turn ends, so a reading stays valid until the
 * Session gets a new message or finishes a turn. While the Session runs, the last reading
 * stays (a Session without any reading is read once). A reading is kept at most
 * USAGE_TTL_MS, for changes from other devices.
 */
export const USAGE_TTL_MS = 60_000;
type Entry = { version: string; at: number; usage: DesktopThreadUsage | null };
const cache = new Map<string, Entry>();
const pending = new Map<string, Promise<DesktopThreadUsage | null>>();


function fresh(threadId: string, version: string): Entry | undefined {
  const entry = cache.get(threadId);
  return entry && entry.version === version && Date.now() - entry.at < USAGE_TTL_MS ? entry : undefined;
}

/** Reads the usage once per Session and version; a failed read gives null. */
export function readThreadUsage(threadId: string, version: string): Promise<DesktopThreadUsage | null> {
  const entry = fresh(threadId, version);
  if (entry) return Promise.resolve(entry.usage);
  const key = `${threadId}\n${version}`, running = pending.get(key);
  if (running) return running;
  const read = (window.hermesDesktop?.threadUsage?.(threadId) ?? Promise.resolve(null))
    .catch(() => null)
    .then(usage => { cache.set(threadId, { version, at: Date.now(), usage }); return usage; })
    .finally(() => pending.delete(key));
  pending.set(key, read);
  return read;
}

/** The version to read, or undefined to keep the last reading (a running Session that has one). */
export const usageVersion = (threadId: string | undefined, running: boolean, lastMessageAt?: number): string | undefined =>
  !threadId ? undefined : !running ? `idle:${lastMessageAt ?? 0}` : cache.has(threadId) ? undefined : 'running';

/** The latest known usage of `threadId`: a previous reading shows until the new one arrives. */
export function useThreadUsage(threadId: string | undefined, running: boolean, lastMessageAt?: number): DesktopThreadUsage | null | undefined {
  const [state, setState] = useState<{ threadId?: string; usage?: DesktopThreadUsage | null }>({});
  const version = usageVersion(threadId, running, lastMessageAt);
  useEffect(() => {
    if (!threadId || !version) return;
    let live = true;
    void readThreadUsage(threadId, version).then(usage => { if (live) setState({ threadId, usage }); });
    return () => { live = false; };
  }, [threadId, version]);
  if (!threadId) return undefined;
  return state.threadId === threadId ? state.usage : cache.get(threadId)?.usage;
}

/** Short text: "Context 28.2K · Cache 99% · Total 206M". Parts without data are left out. */
export const usageText = (usage: DesktopThreadUsage): string =>
  [usage.contextTokens !== null ? `Context ${formatTokens(usage.contextTokens)}` : '',
    usage.cache ? `Cache ${cacheHitPercent(usage.cache)}%` : '',
    `Total ${formatTokens(usage.totalTokens)}`].filter(Boolean).join(' · ');

/** Full counts for the tooltip and screen readers. */
export const usageDescription = (usage: DesktopThreadUsage): string =>
  [usage.contextTokens !== null ? `Context: ${exactTokens(usage.contextTokens)} tokens in the latest request.` : '',
    usage.cache ? `Cache: ${cacheHitPercent(usage.cache)}% of the input of the latest turn's first request came from the prompt cache (${exactTokens(usage.cache.readTokens)} of ${exactTokens(usage.cache.promptTokens)} tokens).` : '',
    `Total: ${exactTokens(usage.totalTokens)} tokens used by this session.`].filter(Boolean).join(' ');

/** Test hook: forget every reading. */
export const clearThreadUsage = (): void => { cache.clear(); pending.clear(); };
