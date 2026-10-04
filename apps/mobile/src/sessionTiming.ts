import type { OpenTimingEvent, OpenTimingStage, OpenRequestKind } from '../../../packages/client/src/openTiming';

export type TimingMark = OpenTimingStage | 'page-mounted' | 'ui-ready' | 'visible-rows' | 'empty-frame' | 'failed';
export type TimingResult = {
  origin: 'tap' | 'page'; outcome: 'visible-rows' | 'empty-frame' | 'cancelled' | 'failed';
  stages: Partial<Record<TimingMark, number>>; rows: number;
  localAfterResponse: Partial<Record<'history' | 'state', number>>;
  requests: Partial<Record<OpenRequestKind, { count: number; ms: number; lastEnd?: number }>>;
};

/** Temporary measurement, one opening only. No IDs, payloads, persistence or upload. */
export class SessionOpenMeasurement {
  private clock: () => number;
  private started: number;
  private origin: TimingResult['origin'];
  private stages: TimingResult['stages'] = {};
  private requests: TimingResult['requests'] = {};
  private pending = new Map<number, { kind: OpenRequestKind; at: number }>();
  private rows = 0;
  private localAfterResponse: TimingResult['localAfterResponse'] = {};
  private listeners = new Set<(value: TimingResult) => void>();
  result: TimingResult | null = null;
  constructor(origin: TimingResult['origin'], clock = () => performance.now()) {
    this.origin = origin; this.clock = clock; this.started = clock();
  }
  mark = (stage: TimingMark) => {
    if (this.result || this.stages[stage] !== undefined) return;
    this.stages[stage] = this.clock() - this.started;
    if (stage === 'visible-rows' || stage === 'empty-frame' || stage === 'cancelled' || stage === 'failed') {
      this.result = { origin: this.origin, outcome: stage, stages: { ...this.stages }, rows: this.rows, localAfterResponse: { ...this.localAfterResponse },
        requests: Object.fromEntries(Object.entries(this.requests).map(([kind, value]) => [kind, { ...value }])) };
      this.pending.clear();
      for (const listener of this.listeners) listener(this.result);
    }
  };
  observe = (event: OpenTimingEvent) => {
    if (this.result) return;
    if ('stage' in event) {
      if (event.rows !== undefined) this.rows = event.rows;
      const kind = event.stage === 'history-ready' ? 'history' : event.stage === 'state-ready' ? 'state' : null;
      const end = kind ? this.requests[kind]?.lastEnd : undefined;
      if (kind && end !== undefined && this.stages[event.stage] === undefined) this.localAfterResponse[kind] = Math.max(0, this.clock() - this.started - end);
      this.mark(event.stage); return;
    }
    const at = this.clock() - this.started;
    if (event.edge === 'start') {
      const tally = this.requests[event.request] ??= { count: 0, ms: 0 };
      tally.count++;
      this.pending.set(event.sequence, { kind: event.request, at });
    } else {
      const start = this.pending.get(event.sequence);
      if (!start) return;
      const tally = this.requests[start.kind]!;
      tally.ms += at - start.at; tally.lastEnd = at;
      this.pending.delete(event.sequence);
    }
  };
  subscribe(listener: (value: TimingResult) => void): () => void {
    this.listeners.add(listener);
    if (this.result) listener(this.result);
    return () => { this.listeners.delete(listener); };
  }
}

export function timingReport(result: TimingResult): string {
  const s = result.stages;
  const end = s[result.outcome];
  const diff = (from: TimingMark | null, to: TimingMark) => {
    const a = from === null ? 0 : s[from], b = s[to];
    return a === undefined || b === undefined ? 'not measured' : `${Math.round(Math.max(0, b - a))} ms`;
  };
  const local = s['ui-ready'] === undefined || end === undefined ? undefined : Math.max(0, end - s['ui-ready']);
  const before = s['ui-ready'];
  const verdict = result.outcome === 'cancelled' || result.outcome === 'failed' ? 'Incomplete sample; do not classify.'
    : result.outcome === 'empty-frame' ? 'Empty conversation; no message-render measurement.'
    : before === undefined || local === undefined ? 'Incomplete phase data; do not classify.'
    : before > local ? 'Most elapsed time was before UI release, not after it.' : 'Most elapsed time was after UI release; inspect client presentation.';
  const requestLines = Object.entries(result.requests).map(([kind, value]) => `${kind}: ${value.count} request(s), ${Math.round(value.ms)} ms`);
  const localMs = (kind: 'history' | 'state') => result.localAfterResponse[kind] === undefined ? 'not measured' : `${Math.round(result.localAfterResponse[kind]!)} ms`;
  return [
    `Temporary session timing: ${result.outcome}`,
    `Total (${result.origin === 'tap' ? 'tap' : 'page acquisition'} to callback): ${diff(null, result.outcome)}`,
    `Navigation/page setup: ${diff(null, 'open-start')}`,
    `Connection/watch wait: ${diff('open-start', 'history-start')}`,
    `History fetch + processing: ${diff('history-start', 'history-ready')}`,
    `History response to local merge complete: ${localMs('history')}`,
    `State fetch + processing: ${diff('state-start', 'state-ready')}`,
    `State response to local processing complete: ${localMs('state')}`,
    `History ready to UI release: ${diff('history-ready', 'ui-ready')}`,
    `After UI release to callback: ${diff('ui-ready', result.outcome)}`,
    `Initial history records: ${result.rows}`,
    ...requestLines,
    verdict,
    'Observed HTTP spans begin after open-start. They include network, server, body decoding and transport. Concurrent requests overlap; do not add them to total.',
    'Local response timings cover only work after the final decoded response, not all client CPU.',
    'End = first viewable-row callback (0 ms dwell), or one frame after empty UI release. Not a pixel-paint or media-ready measurement.',
  ].join('\n');
}
