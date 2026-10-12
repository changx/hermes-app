import { inRecents } from '../../../packages/client/src/recents.ts';

/** Directory data the Recents tab reads from one connection. */
type Directory = {
  isCatalogueReady: boolean;
  channels: ReadonlyMap<string, { id: string; name: string }>;
  threads: ReadonlyMap<string, {
    id: string; project_id: string; title: string; archived?: boolean | number; running?: boolean;
    completed_unread?: boolean; last_message_at?: number; origin?: 'user' | 'automation'; participated?: boolean;
  }>;
};
export type RecentSource = Readonly<{ slot: string; name: string; client: Directory | null }>;
export type RecentRow = Readonly<{
  key: string; slot: string; id: string; title: string; channelId: string; channelName: string; connectionName: string;
  running: boolean; completedUnread: boolean; lastMessageAt?: number;
}>;
export type ChannelChoice = Readonly<{ key: string; slot: string; id: string; name: string; connectionName: string }>;

/**
 * Recents across every saved connection: owned by the user, active in the
 * last 24 hours or running, newest activity first. Same rule as the desktop
 * sidebar (packages/client/src/recents.ts).
 */
export function recentRows(connections: readonly RecentSource[], nowSeconds: number): RecentRow[] {
  const rows: RecentRow[] = [];
  for (const runtime of connections) {
    const client = runtime.client;
    if (!client?.isCatalogueReady) continue;
    for (const thread of client.threads.values()) {
      const channel = client.channels.get(thread.project_id);
      if (!channel || thread.archived) continue;
      const candidate = { origin: thread.origin, participated: thread.participated, running: thread.running === true, lastMessageAt: thread.last_message_at };
      if (!inRecents(candidate, nowSeconds)) continue;
      rows.push({ key: `${runtime.slot}:${thread.id}`, slot: runtime.slot, id: thread.id, title: thread.title,
        channelId: channel.id, channelName: channel.name, connectionName: runtime.name,
        running: thread.running === true, completedUnread: thread.completed_unread === true,
        ...(thread.last_message_at === undefined ? {} : { lastMessageAt: thread.last_message_at }) });
    }
  }
  return rows.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0) || a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
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
 * active in (any of their Threads, not only the last 24 hours); otherwise the
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
