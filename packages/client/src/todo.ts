// No runtime imports: mobile tests load this file directly in Node.
/** Same limit as `MAX_LABELS` in sessionLabels.ts (a test checks they match). */
export const TODO_LABEL_LIMIT = 10;
/** The session already has the most labels allowed; the message is for the user. */
export class TodoLimitError extends Error {}

/**
 * Todo flag: a reserved session label. It syncs like every other label, so it
 * needs no server change. Any case (`todo`, `TODO`) counts; the app writes `todo`.
 */
export const TODO_LABEL = 'todo';

export const isTodoLabel = (label: string): boolean => label.toLocaleLowerCase('en') === TODO_LABEL;
export const hasTodo = (markers: readonly string[] | undefined): boolean => !!markers?.some(isTodoLabel);

/** Labels without the todo flag: toolbars and frequent-label chips show the flag on its own (or not at all). */
export const withoutTodo = (markers: readonly string[] | undefined): string[] => (markers ?? []).filter(label => !isTodoLabel(label));

/**
 * The session's labels with the flag set or cleared. Other labels keep their
 * order. Throws when a session with ten labels would get an eleventh.
 */
export function toggledTodo(markers: readonly string[] | undefined, on: boolean): string[] {
  const rest = withoutTodo(markers);
  if (!on) return rest;
  if (hasTodo(markers)) return [...(markers ?? [])];
  if (rest.length >= TODO_LABEL_LIMIT) throw new TodoLimitError('Remove a label first. A session can have up to 10 labels.');
  return [...rest, TODO_LABEL];
}

type Ordered = Readonly<{ running?: boolean; lastMessageAt?: number; title: string; id: string }>;
/** Session list order everywhere: running first, then newest activity. */
export const runningFirst = (a: Ordered, b: Ordered): number =>
  Number(b.running === true) - Number(a.running === true) || (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)
  || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);

/** The Todo section: every flagged session, any age, running first, then newest activity. */
export const todoSessions = <T extends Ordered & Readonly<{ markers?: readonly string[] }>>(threads: readonly T[]): T[] =>
  threads.filter(thread => hasTodo(thread.markers)).sort(runningFirst);
