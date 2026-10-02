import type { DesktopSnapshot } from './desktop-api';

const collections = ['channels', 'threads', 'messages', 'interactions'] as const;
type Collection = typeof collections[number];
type Row<K extends Collection> = DesktopSnapshot[K][number];
export type CollectionDelta<K extends Collection> = Readonly<{
  upserts: readonly Row<K>[];
  removed: readonly string[];
  // Present only for insertion/removal/reordering; edits preserve order.
  order?: readonly string[];
}>;
export type DesktopSnapshotDelta = Readonly<{
  kind: 'delta';
  baseRevision: number;
  revision: number;
  state: Omit<DesktopSnapshot, Collection | 'revision'>;
  channels?: CollectionDelta<'channels'>;
  threads?: CollectionDelta<'threads'>;
  messages?: CollectionDelta<'messages'>;
  interactions?: CollectionDelta<'interactions'>;
}>;
export type DesktopUpdate = DesktopSnapshot | DesktopSnapshotDelta;

const equal = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);
const state = ({revision: _revision, channels: _channels, threads: _threads, messages: _messages, interactions: _interactions, ...rest}: DesktopSnapshot) => rest;

function diff<K extends Collection>(before: DesktopSnapshot[K], after: DesktopSnapshot[K]): CollectionDelta<K> | undefined {
  const old = new Map(before.map(row => [row.id,row]));
  const next = new Set(after.map(row => row.id));
  const upserts = after.filter(row => !equal(old.get(row.id),row)) as Row<K>[];
  const removed = before.filter(row => !next.has(row.id)).map(row => row.id);
  const reordered = before.length !== after.length || before.some((row,index) => row.id !== after[index]?.id);
  if (!upserts.length && !removed.length && !reordered) return undefined;
  return {upserts,removed,...(reordered ? {order:after.map(row => row.id)} : {})};
}

export function snapshotDelta(before: DesktopSnapshot, after: DesktopSnapshot): DesktopSnapshotDelta {
  return {
    kind:'delta',baseRevision:before.revision,revision:after.revision,state:state(after),
    ...Object.fromEntries(collections.flatMap(key => {const change=diff(before[key],after[key]);return change ? [[key,change]] : []})),
  };
}

function apply<K extends Collection>(before: DesktopSnapshot[K], change?: CollectionDelta<K>): DesktopSnapshot[K] {
  if (!change) return before;
  const rows = new Map(before.map(row => [row.id,row]));
  for (const id of change.removed) rows.delete(id);
  for (const row of change.upserts) {
    const old = rows.get(row.id);
    rows.set(row.id,equal(old,row) ? old! : row);
  }
  const order = change.order ?? before.map(row => row.id);
  const result = order.map(id => {
    const row = rows.get(id);
    if (!row) throw new Error('Invalid desktop update');
    return row;
  });
  if (result.length !== rows.size) throw new Error('Invalid desktop update');
  return Object.freeze(result) as DesktopSnapshot[K];
}

export function applySnapshotDelta(before: DesktopSnapshot, change: DesktopSnapshotDelta): DesktopSnapshot {
  if (change.baseRevision !== before.revision || change.revision <= change.baseRevision) throw new Error('Desktop update gap');
  return Object.freeze({
    ...change.state,revision:change.revision,
    channels:apply<'channels'>(before.channels,change.channels),threads:apply<'threads'>(before.threads,change.threads),
    messages:apply<'messages'>(before.messages,change.messages),interactions:apply<'interactions'>(before.interactions,change.interactions),
  });
}

// A full baseline (startup/gap recovery) also preserves equal row identities.
export function reconcileSnapshot(before: DesktopSnapshot, after: DesktopSnapshot): DesktopSnapshot {
  const change = snapshotDelta(before,after);
  return Object.freeze({
    ...after,channels:apply<'channels'>(before.channels,change.channels),threads:apply<'threads'>(before.threads,change.threads),
    messages:apply<'messages'>(before.messages,change.messages),interactions:apply<'interactions'>(before.interactions,change.interactions),
  });
}
