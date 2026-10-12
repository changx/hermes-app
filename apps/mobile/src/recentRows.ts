import { inRecents } from '../../../packages/client/src/recents.ts';
import { hasTodo, withoutTodo } from '../../../packages/client/src/todo.ts';
import { frequentSessionLabels, sessionQueryScore, type SessionQuery } from '../../../packages/client/src/sessionSearch.ts';

/** Directory data the Recents tab reads from one connection. */
type Directory = {
  isCatalogueReady: boolean;
  supportsSessionLabels?: boolean;
  channels: ReadonlyMap<string, { id: string; name: string }>;
  threads: ReadonlyMap<string, {
    id: string; project_id: string; title: string; title_alphabet?: string; markers?: readonly string[]; archived?: boolean | number; running?: boolean;
    completed_unread?: boolean; last_message_at?: number; origin?: 'user' | 'automation'; participated?: boolean;
  }>;
};
export type RecentSource = Readonly<{ slot: string; name: string; client: Directory | null }>;
export type RecentRow = Readonly<{
  key: string; slot: string; id: string; title: string; channelId: string; channelName: string; connectionName: string;
  running: boolean; completedUnread: boolean; lastMessageAt?: number;
  /** Labels, only from connections that support them. */
  markers: readonly string[]; titleAlphabet?: string;
}>;
export type ChannelChoice = Readonly<{ key: string; slot: string; id: string; name: string; connectionName: string }>;

/**
 * Recents across every saved connection: owned by the user, active in the
 * last 72 hours or running. Running first, then newest activity. Same rule as
 * the desktop sidebar (packages/client/src/recents.ts).
 */
export function recentRows(connections: readonly RecentSource[], nowSeconds: number): RecentRow[] {
  return listedRows(connections, thread => inRecents({ origin: thread.origin, participated: thread.participated, running: thread.running === true, lastMessageAt: thread.last_message_at }, nowSeconds))
    .sort(runningFirst);
}

/** Todo: every flagged Thread of every connection, any age. Running first, then newest activity (same as the desktop sidebar). */
export function todoRows(connections: readonly RecentSource[]): RecentRow[] {
  return listedRows(connections).filter(row => hasTodo(row.markers)).sort(runningFirst);
}

const runningFirst = (a: RecentRow, b: RecentRow): number => Number(b.running) - Number(a.running)
  || (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0) || a.title.localeCompare(b.title) || a.key.localeCompare(b.key);

type DirectoryThread = Directory['threads'] extends ReadonlyMap<string, infer T> ? T : never;
/** Every listed, non-archived Thread of every ready connection. */
function listedRows(connections: readonly RecentSource[], keep: (thread: DirectoryThread) => boolean = () => true): RecentRow[] {
  const rows: RecentRow[] = [];
  for (const runtime of connections) {
    const client = runtime.client;
    if (!client?.isCatalogueReady) continue;
    for (const thread of client.threads.values()) {
      const channel = client.channels.get(thread.project_id);
      if (!channel || thread.archived || !keep(thread)) continue;
      rows.push({ key: `${runtime.slot}:${thread.id}`, slot: runtime.slot, id: thread.id, title: thread.title,
        channelId: channel.id, channelName: channel.name, connectionName: runtime.name,
        running: thread.running === true, completedUnread: thread.completed_unread === true,
        markers: client.supportsSessionLabels ? [...(thread.markers ?? [])] : [],
        ...(thread.title_alphabet === undefined ? {} : { titleAlphabet: thread.title_alphabet }),
        ...(thread.last_message_at === undefined ? {} : { lastMessageAt: thread.last_message_at }) });
    }
  }
  return rows;
}

/**
 * Search from the Recents tab: every listed Thread (not only the last 72
 * hours), the same keyword and AND-label matching as the desktop sidebar.
 * Best match first; ties go running first, then newest activity.
 */
export function searchRecentRows(connections: readonly RecentSource[], query: SessionQuery): RecentRow[] {
  return listedRows(connections)
    .map(row => ({ row, score: sessionQueryScore({ title: row.title, title_alphabet: row.titleAlphabet, markers: row.markers }, query, row.channelName) }))
    .filter(item => Number.isFinite(item.score))
    .sort((a, b) => a.score - b.score || Number(b.row.running) - Number(a.row.running) || (b.row.lastMessageAt ?? 0) - (a.row.lastMessageAt ?? 0)
      || a.row.title.localeCompare(b.row.title) || a.row.key.localeCompare(b.row.key))
    .map(item => item.row);
}

/** Quick label filter: the five labels on the most listed Threads (same rule as the desktop sidebar). */
export function quickLabels(connections: readonly RecentSource[], limit = 5): string[] {
  // The flag is not a quick filter: the Todo section already lists flagged Threads.
  return frequentSessionLabels(listedRows(connections).map(row => ({ ...row, markers: withoutTodo(row.markers) })), limit);
}

/** Every channel the new-Thread page can target, by connection then name. */
export function channelChoices(connections: readonly RecentSource[]): ChannelChoice[] {
  const choices: ChannelChoice[] = [];
  for (const runtime of connections) {
    if (!runtime.client?.isCatalogueReady) continue;
    for (const channel of runtime.client.channels.values())
      choices.push({ key: `${runtime.slot}:${channel.id}`, slot: runtime.slot, id: channel.id, name: channel.name, connectionName: runtime.name });
  }
  return choices.sort((a, b) => a.connectionName.localeCompare(b.connectionName) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}

/**
 * Preselected channel: the channel of the Thread the user was most recently
 * active in (any of their Threads, not only the last 72 hours); otherwise the
 * first choice.
 */
export function recentChannel(connections: readonly RecentSource[], choices: readonly ChannelChoice[]): ChannelChoice | null {
  let best: { key: string; at: number } | null = null;
  for (const runtime of connections) {
    const client = runtime.client;
    if (!client?.isCatalogueReady) continue;
    for (const thread of client.threads.values()) {
      if (thread.archived || thread.last_message_at === undefined || !client.channels.has(thread.project_id)) continue;
      if (thread.origin === 'automation' && thread.participated !== true) continue;
      if (!best || thread.last_message_at > best.at) best = { key: `${runtime.slot}:${thread.project_id}`, at: thread.last_message_at };
    }
  }
  return (best && choices.find(choice => choice.key === best!.key)) ?? choices[0] ?? null;
}
