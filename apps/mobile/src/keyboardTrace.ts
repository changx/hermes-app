/**
 * Temporary developer diagnostic for the session composer dock: it drops
 * behind the keyboard while the user types (docs/mobile-composer-dock-typing.md).
 * Records keyboard events, text length changes (never the text) and dock
 * samples in a small ring buffer. After a keyboard hide that follows typing,
 * the buffer goes to the connected Hermes as one `console` client log.
 * Nothing is shown in the UI. Remove with the fix.
 */
const MAX_ENTRIES = 240;
const MIN_UPLOAD_GAP_MS = 15000;
type Entry = [number, string, Record<string, unknown>?];
let entries: Entry[] = [];
let origin = Date.now();
let typedSinceUpload = false;
let lastUpload = 0;
let reporter: ((message: string, detail: string) => void) | undefined;
/** The client log sender (set by clientLogs.ts; this module has no native imports). */
export function setKeyboardTraceReporter(next: (message: string, detail: string) => void) { reporter = next; }

const round = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : value;

export function keyboardTrace(kind: string, data?: Record<string, unknown>) {
  const clean = data ? Object.fromEntries(Object.entries(data).map(([key, value]) => [key, round(value)])) : undefined;
  entries.push(clean ? [Date.now() - origin, kind, clean] : [Date.now() - origin, kind]);
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  if (kind === 'text') typedSinceUpload = true;
}

/** Sends the buffer once typing happened since the last upload. */
export function uploadKeyboardTrace(reason: string, now = Date.now()) {
  if (!reporter || !typedSinceUpload || now - lastUpload < MIN_UPLOAD_GAP_MS || !entries.length) return false;
  lastUpload = now;
  typedSinceUpload = false;
  const lines = entries.map(entry => JSON.stringify(entry)).join('\n');
  reporter(`keyboard-trace ${reason}`, lines);
  entries = [];
  origin = now;
  return true;
}

/** Test hook. */
export function resetKeyboardTrace() { entries = []; origin = Date.now(); typedSinceUpload = false; lastUpload = 0; }
export function keyboardTraceEntries(): readonly Entry[] { return entries; }
