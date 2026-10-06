/**
 * Shared Project-list rules for desktop and mobile. All functions are pure and
 * use only lightweight directory metadata; they never read conversation bodies.
 */

/** Minimal session metadata required for Project aggregation. */
export type ProjectSession = Readonly<{
  projectId: string;
  archived?: boolean;
  completedUnread?: boolean;
}>;

/**
 * Number of sessions in each Project that have an unread completed result.
 * A session contributes at most one, however many outputs it produced.
 * Archived sessions and sessions whose Project is not listed are excluded.
 */
export function projectUnreadCounts(sessions: Iterable<ProjectSession>, projectIds?: Iterable<string>): Map<string, number> {
  const allowed = projectIds ? new Set(projectIds) : undefined;
  const counts = new Map<string, number>();
  for (const session of sessions) {
    if (session.archived || session.completedUnread !== true) continue;
    if (allowed && !allowed.has(session.projectId)) continue;
    counts.set(session.projectId, (counts.get(session.projectId) ?? 0) + 1);
  }
  return counts;
}

/** Text shown for a count. Large values are capped to keep the row compact. */
export function unreadCountLabel(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** Accessible description for a Project count; empty when there is none. */
export function unreadCountDescription(count: number): string {
  if (count <= 0) return '';
  return count === 1 ? '1 session with an unread result' : `${count} sessions with unread results`;
}

/** Minimal Project metadata required for unified ordering. */
export type OrderedProject = Readonly<{ id: string; name: string; connectionName?: string }>;

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/**
 * One flat order across all connections: Project name first, then the
 * connection name for equal Project names, then the stable ID.
 */
export function compareProjects(a: OrderedProject, b: OrderedProject): number {
  return collator.compare(a.name, b.name)
    || collator.compare(a.connectionName ?? '', b.connectionName ?? '')
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function orderProjects<T extends OrderedProject>(projects: Iterable<T>): T[] {
  return [...projects].sort(compareProjects);
}
