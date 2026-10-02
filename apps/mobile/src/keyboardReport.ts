// Temporary, geometry-only diagnostic format. Never serialize native events.
export const KEYBOARD_REPORT_BUILD = 'keyboard-resume-capture-v1';
export const REPORT_LIMIT = 1200;
export type ReportRoute = 'new-topic' | 'new-channel';
export type KeyboardKind = 'unspecified' | 'system-english' | 'system-chinese' | 'third-party';
const kinds = new Set(['mount', 'unmount', 'app-state', 'form-state', 'layout', 'sample',
  'keyboardWillShow', 'keyboardDidShow', 'keyboardWillHide', 'keyboardDidHide',
  'keyboardWillChangeFrame', 'keyboardDidChangeFrame', 'report-open', 'report-share', 'issue-marker']);
const numbers = ['screenX', 'screenY', 'width', 'height', 'startScreenY', 'startHeight', 'duration',
  'x', 'y', 'headerHeight', 'insetTop', 'insetBottom', 'windowWidth', 'windowHeight',
  'screenWidth', 'screenHeight', 'fontScale', 'paddingBottom', 'storedBottom', 'measuredX', 'measuredY',
  'measuredWidth', 'measuredHeight', 'sampleDelay'] as const;
const booleans = ['focused', 'controllerVisible', 'rnVisible', 'isEventFromThisApp'] as const;
const states = new Set(['active', 'inactive', 'background', 'unknown', 'extension']);
const parts = new Set(['form', 'page', 'message-area', 'topic-actions', 'description-area', 'channel-actions']);
export function safeReportData(raw: Record<string, unknown>) {
  const data: Record<string, number | boolean | string> = {};
  for (const key of numbers) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100000)
      data[key] = Math.round(value * 100) / 100;
  }
  for (const key of booleans) if (typeof raw[key] === 'boolean') data[key] = raw[key] as boolean;
  if (typeof raw.appState === 'string' && states.has(raw.appState)) data.appState = raw.appState;
  if (typeof raw.part === 'string' && parts.has(raw.part)) data.part = raw.part;
  return data;
}
export type ReportEntry = { seq: number; elapsedMs: number; kind: string; route: ReportRoute; data: ReturnType<typeof safeReportData> };
export class KeyboardReport {
  private startedAt = Date.now();
  private sequence = 0;
  private dropped = 0;
  private entries: ReportEntry[] = [];
  private keyboard: KeyboardKind = 'unspecified';
  reset(keyboard: KeyboardKind) {
    this.startedAt = Date.now(); this.sequence = 0; this.dropped = 0; this.entries = []; this.keyboard = keyboard;
  }
  append(kind: string, route: ReportRoute, raw: Record<string, unknown> = {}) {
    if (!kinds.has(kind) || !['new-topic', 'new-channel'].includes(route)) return;
    this.entries.push({ seq: ++this.sequence, elapsedMs: Date.now() - this.startedAt, kind, route, data: safeReportData(raw) });
    if (this.entries.length > REPORT_LIMIT) { this.entries.shift(); this.dropped++; }
  }
  snapshot() {
    return { build: KEYBOARD_REPORT_BUILD, startedAt: this.startedAt, keyboard: this.keyboard,
      dropped: this.dropped, privacy: 'Geometry and lifecycle only. No input text, messages, credentials, identifiers, or attachments.',
      entries: this.entries.map(entry => ({ ...entry, data: { ...entry.data } })) };
  }
  restore(raw: unknown) {
    if (!raw || typeof raw !== 'object') return;
    const report = raw as Record<string, unknown>;
    if (report.build !== KEYBOARD_REPORT_BUILD || typeof report.startedAt !== 'number' ||
      !Number.isFinite(report.startedAt) || Date.now() - report.startedAt > 86400000 || report.startedAt > Date.now()) return;
    if (!Array.isArray(report.entries)) return;
    this.reset(['system-english', 'system-chinese', 'third-party'].includes(String(report.keyboard)) ? report.keyboard as KeyboardKind : 'unspecified');
    this.startedAt = report.startedAt;
    for (const rawEntry of report.entries.slice(-REPORT_LIMIT)) {
      if (!rawEntry || typeof rawEntry !== 'object') continue;
      const entry = rawEntry as Record<string, unknown>;
      if (typeof entry.kind !== 'string' || !kinds.has(entry.kind) || !['new-topic', 'new-channel'].includes(String(entry.route))) continue;
      const elapsedMs = entry.elapsedMs;
      if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 86400000) continue;
      this.entries.push({ seq: ++this.sequence, elapsedMs, kind: entry.kind, route: entry.route as ReportRoute,
        data: safeReportData(entry.data && typeof entry.data === 'object' ? entry.data as Record<string, unknown> : {}) });
    }
    if (typeof report.dropped === 'number' && Number.isSafeInteger(report.dropped) && report.dropped >= 0) this.dropped = report.dropped;
  }
}
