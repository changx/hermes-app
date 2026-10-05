import type { WorkGroup, WorkMessage } from './workPresentation';

export function validChatTime(seconds: unknown): seconds is number {
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 && seconds <= 8.64e12;
}
const two = (value: number) => String(value).padStart(2, '0');
export function chatClock(seconds: unknown): string {
  if (!validChatTime(seconds)) return '—';
  const date = new Date(seconds * 1000);
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}
export function chatDate(seconds: unknown, nowMs = Date.now()): string | undefined {
  if (!validChatTime(seconds)) return undefined;
  const date = new Date(seconds * 1000);
  const label = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  return date.getFullYear() === new Date(nowMs).getFullYear() ? label : `${label}, ${date.getFullYear()}`;
}
export function chatDateSeparators(messages: readonly WorkMessage[], nowMs = Date.now()): Map<string, string> {
  const labels = new Map<string, string>();
  let previous: string | undefined;
  for (const message of messages) {
    if (!validChatTime(message.seconds)) continue;
    const date = new Date(message.seconds * 1000);
    const day = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    if (day !== previous) labels.set(message.key, chatDate(message.seconds, nowMs)!);
    previous = day;
  }
  return labels;
}

export function processingWarning(state?: string, processing?: string | null): string | undefined {
  return ({ failed: 'Failed', interrupted: 'Stopped', unknown: 'Outcome unknown' } as Record<string, string>)[processing ?? state ?? ''];
}

// Pending feedback is UI only, not an assistant message or proof of model execution.
// Explicit delivery boundaries prevent stale requests from reopening a finished response.
export function hasWaitingRequest(messages: readonly (WorkMessage & { waiting?: boolean })[]): boolean {
  let boundary = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'assistant' && ['final', 'direct'].includes(messages[i].kind ?? '')) boundary = i;
  }
  return messages.slice(boundary + 1).some(message => message.role === 'user' && message.waiting);
}
export function needsWorkPlaceholder(messages: readonly (WorkMessage & { waiting?: boolean })[], groups: ReadonlyMap<string, WorkGroup>, running: boolean): boolean {
  if ([...groups.values()].some(group => group.running)) return false;
  if (hasWaitingRequest(messages)) return true;
  return running && !messages.some(message => message.role === 'assistant' && ['final', 'direct'].includes(message.kind ?? ''));
}
