// Presentation only. Never alter message identity/order or infer a final from receipts.
export interface WorkMessage { key: string; role: string; kind?: string; seconds?: number }
export interface WorkGroup { key: string; members: string[]; completion?: string; label: string; running: boolean }
export interface WorkChoice { completion?: string; expanded: boolean }
const valid = (seconds: number | undefined): seconds is number => typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0;
export function workDuration(start?: number, end?: number): string {
  if (!valid(start) || !valid(end) || end < start) return '—';
  const seconds = Math.round(end - start);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
}
// Group public process between explicit delivery boundaries. Interleaved user
// messages and system notices keep their own original positions and remain visible.
// This is not a server turn ID or a model execution duration.
export function workGroups(messages: readonly WorkMessage[], running: boolean): Map<string, WorkGroup> {
  const result = new Map<string, WorkGroup>();
  let pending: WorkMessage[] = [];
  const finish = (final?: WorkMessage, active = false) => {
    if (!pending.length) return;
    const group: WorkGroup = { key: pending[0].key, members: pending.map(m => m.key), completion: final?.key,
      running: active, label: final ? `Worked for ${workDuration(pending[0].seconds, final.seconds)}` : active ? 'Working' : 'Work recorded' };
    for (const member of pending) result.set(member.key, group);
    pending = [];
  };
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    if (message.kind === 'final') finish(message);
    else if (message.kind === 'direct') finish();
    else if (!message.kind) pending.push(message);
  }
  finish(undefined, running);
  return result;
}
/** The group fields a message row shows; members are left out on purpose. */
export type WorkGroupView = Readonly<Pick<WorkGroup, 'key' | 'completion' | 'label' | 'running'>>;
/**
 * Row key → group view. A view keeps its previous object while its shown fields
 * are unchanged, so a new tool row does not render every earlier row of its group.
 */
export function reuseWorkViews(previous: ReadonlyMap<string, WorkGroupView>, groups: ReadonlyMap<string, WorkGroup>): Map<string, WorkGroupView> {
  const result = new Map<string, WorkGroupView>(), made = new Map<WorkGroup, WorkGroupView>();
  for (const [row, group] of groups) {
    let view = made.get(group);
    if (!view) {
      const old = previous.get(group.key);
      view = old && old.key === group.key && old.completion === group.completion && old.label === group.label && old.running === group.running
        ? old : { key: group.key, completion: group.completion, label: group.label, running: group.running };
      made.set(group, view);
    }
    result.set(row, view);
  }
  return result;
}
export function workIsExpanded(group: WorkGroup, choice?: WorkChoice): boolean {
  // Final arrival invalidates active overrides immediately, before paint/effects.
  return choice && choice.completion === group.completion ? choice.expanded : !group.completion;
}
