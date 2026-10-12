/**
 * Automations directory (plugin capability `automations`).
 * GET /v1/automations lists this connection's scheduled jobs (paged with
 * `automations_paged`); GET /v1/automations/{id} adds the Threads that one job
 * delivered into, and with `automation_controls` the editing fields.
 */
export class AutomationProtocolError extends Error {
  constructor() { super('Invalid automations response'); this.name = 'AutomationProtocolError'; }
}

export type AutomationTarget = Readonly<{ channelId: string; mode: 'new' | 'thread'; threadId?: string }>;
export type AutomationControl = 'pause' | 'resume' | 'run' | 'schedule';
export type Automation = Readonly<{
  id: string; name: string; schedule: string; state: string; enabled: boolean; running: boolean;
  nextRunAt?: string; lastRunAt?: string; lastStatus?: string; failed: boolean;
  targets: readonly AutomationTarget[]; threadCount: number; unreadCount: number; prompt?: string;
  /** Editing (plugin 0.2.28): empty `controls` means read-only here. */
  controls: readonly AutomationControl[]; editorChannelId?: string; editorThreadId?: string;
}>;
export type AutomationPage = Readonly<{ automations: readonly Automation[]; nextAfter: string | null }>;
export type AutomationThread = Readonly<{
  id: string; channelId: string; title: string; runs: number; completedUnread: boolean; resultVersion: number; resultRef: number;
}>;
export type AutomationDetail = Readonly<{ automation: Automation; threads: readonly AutomationThread[]; nextBefore: number | null }>;

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AutomationProtocolError();
  return value as Record<string, unknown>;
};
const text = (value: unknown, max = 400): string => {
  if (typeof value !== 'string' || !value.length || value.length > max) throw new AutomationProtocolError();
  return value;
};
const optionalText = (value: unknown, max = 400): string | undefined =>
  value === null || value === undefined || value === '' ? undefined : text(value, max);
const label = (value: unknown): string => text(typeof value === 'string' ? value.slice(0, 400) : value);
const count = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new AutomationProtocolError();
  return value;
};
const FAILED = new Set(['error', 'failed', 'delivery_failed', 'timeout']);
const CONTROLS = new Set<AutomationControl>(['pause', 'resume', 'run', 'schedule']);

function parseControls(value: unknown): AutomationControl[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 8) throw new AutomationProtocolError();
  // Unknown future controls are ignored, so an older App keeps the ones it knows.
  return value.filter((item): item is AutomationControl => typeof item === 'string' && CONTROLS.has(item as AutomationControl));
}

function parseTarget(value: unknown): AutomationTarget {
  const row = object(value);
  const channelId = text(row.channel_id, 200);
  if (row.mode === 'new') return { channelId, mode: 'new' };
  if (row.mode === 'thread') return { channelId, mode: 'thread', threadId: text(row.thread_id, 200) };
  throw new AutomationProtocolError();
}

export function parseAutomation(value: unknown): Automation {
  const row = object(value);
  if (!Array.isArray(row.targets) || row.targets.length > 20) throw new AutomationProtocolError();
  const lastStatus = optionalText(row.last_status, 80);
  const prompt = typeof row.prompt === 'string' ? row.prompt.slice(0, 8000) : undefined;
  return {
    id: text(row.id, 200), name: label(row.name), schedule: optionalText(row.schedule_display) ?? '',
    state: optionalText(row.state, 80) ?? 'scheduled', enabled: row.enabled !== false, running: row.running === true,
    ...(optionalText(row.next_run_at, 80) ? { nextRunAt: optionalText(row.next_run_at, 80) } : {}),
    ...(optionalText(row.last_run_at, 80) ? { lastRunAt: optionalText(row.last_run_at, 80) } : {}),
    ...(lastStatus ? { lastStatus } : {}),
    failed: (lastStatus !== undefined && FAILED.has(lastStatus)) || row.state === 'error',
    targets: row.targets.map(parseTarget), threadCount: count(row.thread_count), unreadCount: count(row.unread_count),
    ...(prompt === undefined ? {} : { prompt }),
    controls: row.editable === true ? parseControls(row.controls) : [],
    ...(optionalText(row.editor_channel_id, 200) ? { editorChannelId: optionalText(row.editor_channel_id, 200) } : {}),
    ...(optionalText(row.editor_thread_id, 200) ? { editorThreadId: optionalText(row.editor_thread_id, 200) } : {}),
  };
}

export function parseAutomations(value: unknown): Automation[] {
  const body = object(value);
  if (!Array.isArray(body.automations) || body.automations.length > 500) throw new AutomationProtocolError();
  return body.automations.map(parseAutomation);
}

export function parseAutomationPage(value: unknown): AutomationPage {
  const body = object(value);
  if (!Array.isArray(body.automations) || body.automations.length > 100) throw new AutomationProtocolError();
  const nextAfter = body.next_after === null || body.next_after === undefined ? null : text(body.next_after, 2000);
  return { automations: body.automations.map(parseAutomation), nextAfter };
}

/** Response of a control: the job after the change. */
export function parseAutomationUpdate(value: unknown): Automation {
  return parseAutomation(object(value).automation);
}

export function parseAutomationDetail(value: unknown): AutomationDetail {
  const body = object(value);
  if (!Array.isArray(body.threads) || body.threads.length > 100) throw new AutomationProtocolError();
  const threads = body.threads.map(raw => {
    const row = object(raw);
    return { id: text(row.id, 200), channelId: text(row.project_id, 200), title: label(row.title), runs: count(row.runs),
      completedUnread: row.completed_unread === true, resultVersion: count(row.result_version), resultRef: count(row.result_ref) };
  });
  const nextBefore = body.next_before === null || body.next_before === undefined ? null : count(body.next_before);
  return { automation: parseAutomation(body.automation), threads, nextBefore };
}
