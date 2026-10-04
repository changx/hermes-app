import { SessionOpenMeasurement } from './sessionTiming';

// Temporary opt-in build. Normal builds do not allocate or subscribe to traces.
export const SESSION_TIMING_AVAILABLE = process.env.EXPO_PUBLIC_SESSION_TIMING === '1';
let enabled = SESSION_TIMING_AVAILABLE;
let latest: { thread: string; trace: SessionOpenMeasurement } | null = null;
export const isSessionTimingEnabled = () => enabled;
export function setSessionTimingEnabled(value: boolean) {
  enabled = SESSION_TIMING_AVAILABLE && value;
  if (!enabled) { latest?.trace.mark('cancelled'); latest = null; }
}
export function beginSessionTiming(thread: string) {
  if (!enabled) return;
  latest = { thread, trace: new SessionOpenMeasurement('tap') };
}
export function sessionTimingForPage(thread: string): SessionOpenMeasurement | null {
  if (!enabled) return null;
  if (latest?.thread !== thread || latest.trace.result) latest = { thread, trace: new SessionOpenMeasurement('page') };
  return latest.trace;
}
