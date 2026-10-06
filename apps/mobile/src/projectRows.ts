import { orderProjects, projectUnreadCounts } from '../../../packages/client/src/projectDirectory.ts';
import type { NetworkState } from './outbox.ts';

/** Directory data the Project list reads from one connection. */
type Directory = {
  isCatalogueReady: boolean;
  channels: ReadonlyMap<string, { id: string; name: string }>;
  threads: ReadonlyMap<string, { project_id: string; archived?: boolean | number; completed_unread?: boolean }>;
};
export type ProjectSource = Readonly<{ slot: string; name: string; client: Directory | null; status: NetworkState | 'pairing'; failed: boolean; loading: boolean; damaged: boolean }>;

// Only states that need the user's attention are shown; normal online stays quiet.
const hint: Partial<Record<ProjectSource['status'], string>> = { retrying: 'Reconnecting', suspended: undefined, blocked: 'Needs attention', pairing: 'Pairing' };

export type ProjectRow = Readonly<{ key: string; slot: string; id: string; name: string; connectionName: string; unread: number; issue?: string }>;
export type PendingRow = Readonly<{ key: string; slot: string; connectionName: string; text: string }>;

/**
 * One flat list of Projects across every saved connection. The connection
 * name is secondary text, never a separate level. Counts come from the
 * directory only; the last known values stay while a connection is down.
 */
export function projectRows(connections: readonly ProjectSource[]): { rows: ProjectRow[]; pending: PendingRow[] } {
  const rows: ProjectRow[] = [], pending: PendingRow[] = [];
  for (const runtime of connections) {
    const client = runtime.client;
    const issue = runtime.damaged ? 'Needs attention' : runtime.failed && runtime.status === 'suspended' ? 'Offline' : hint[runtime.status];
    if (!client || !client.isCatalogueReady) {
      // A connection without a directory yet has no Projects to show.
      pending.push({ key: runtime.slot, slot: runtime.slot, connectionName: runtime.name,
        text: issue ?? (runtime.loading ? 'Loading projects…' : 'Projects unavailable') });
      continue;
    }
    const counts = projectUnreadCounts([...client.threads.values()].map(t => ({ projectId: t.project_id, archived: Boolean(t.archived), completedUnread: t.completed_unread })), client.channels.keys());
    for (const channel of client.channels.values()) rows.push({ key: `${runtime.slot}:${channel.id}`, slot: runtime.slot, id: channel.id, name: channel.name,
      connectionName: runtime.name, unread: counts.get(channel.id) ?? 0, ...(issue ? { issue } : {}) });
  }
  // Raw Project IDs can repeat across servers; order by the unique row key.
  const ordered = orderProjects(rows.map(row => ({ id: row.key, name: row.name, connectionName: row.connectionName, row })));
  return { rows: ordered.map(item => item.row), pending };
}

