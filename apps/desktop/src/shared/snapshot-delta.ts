import type { DesktopSnapshot } from './desktop-api';

const collections = ['channels', 'threads', 'messages', 'interactions'] as const;
type Collection = typeof collections[number];
type Row<K extends Collection> = DesktopSnapshot[K][number];
type SessionPage = NonNullable<DesktopSnapshot['sessionPages']>[number];
type PageState = Omit<SessionPage, 'messages' | 'interactions'>;
type PageDelta = Readonly<{
  present: boolean;
  upserts: readonly Readonly<{ state: PageState; messages?: CollectionDelta<'messages'>; interactions?: CollectionDelta<'interactions'> }>[];
  removed: readonly string[];
  order?: readonly string[];
}>;
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
  state: Omit<DesktopSnapshot, Collection | 'revision' | 'sessionPages'>;
  sessionPages?: PageDelta;
  channels?: CollectionDelta<'channels'>;
  threads?: CollectionDelta<'threads'>;
  messages?: CollectionDelta<'messages'>;
  interactions?: CollectionDelta<'interactions'>;
}>;
export type DesktopUpdate = DesktopSnapshot | DesktopSnapshotDelta;

function reconcilePages(before: DesktopSnapshot['sessionPages'], after: DesktopSnapshot['sessionPages']): DesktopSnapshot['sessionPages'] {
  if (!after) return after;
  const old = new Map(before?.map(page => [page.id, page]));
  const pages = after.map(page => {
    const previous = old.get(page.id);
    if (!previous) return page;
    if (previous === page) return previous;
    const messages = apply<'messages'>(previous.messages, diff<'messages'>(previous.messages, page.messages));
    const interactions = apply<'interactions'>(previous.interactions, diff<'interactions'>(previous.interactions, page.interactions));
    return messages === previous.messages && interactions === previous.interactions && equal(pageState(previous), pageState(page))
      ? previous : { ...page, messages, interactions };
  });
  return before?.length === pages.length && pages.every((page, index) => page === before[index]) ? before : Object.freeze(pages);
}

const equal = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);
const state = ({revision: _revision, channels: _channels, threads: _threads, messages: _messages, interactions: _interactions, sessionPages: _pages, ...rest}: DesktopSnapshot) => rest;
const pageState = ({messages: _messages, interactions: _interactions, ...rest}: SessionPage): PageState => rest;

function diffPages(before: DesktopSnapshot['sessionPages'], after: DesktopSnapshot['sessionPages']): PageDelta | undefined {
  if (before === after) return undefined;
  if (after === undefined) return { present: false, upserts: [], removed: [] };
  const old = new Map(before?.map(page => [page.id, page]));
  const upserts: PageDelta['upserts'][number][] = [];
  for (const page of after) {
    const previous = old.get(page.id);
    if (previous === page) continue;
    const messages = diff<'messages'>(previous?.messages ?? [], page.messages);
    const interactions = diff<'interactions'>(previous?.interactions ?? [], page.interactions);
    if (!previous || messages || interactions || !equal(pageState(previous), pageState(page)))
      upserts.push({ state: pageState(page), ...(messages ? { messages } : {}), ...(interactions ? { interactions } : {}) });
  }
  const next = new Set(after.map(page => page.id));
  const removed = (before ?? []).filter(page => !next.has(page.id)).map(page => page.id);
  const reordered = !before || before.length !== after.length || before.some((page, index) => page.id !== after[index]?.id);
  if (!upserts.length && !removed.length && !reordered) return undefined;
  return { present: true, upserts, removed, ...(reordered ? { order: after.map(page => page.id) } : {}) };
}

function applyPages(before: DesktopSnapshot['sessionPages'], change?: PageDelta): DesktopSnapshot['sessionPages'] {
  if (!change) return before;
  if (!change.present) return undefined;
  const pages = new Map(before?.map(page => [page.id, page]));
  for (const id of change.removed) pages.delete(id);
  for (const item of change.upserts) {
    const previous = pages.get(item.state.id);
    const messages = apply<'messages'>(previous?.messages ?? [], item.messages);
    const interactions = apply<'interactions'>(previous?.interactions ?? [], item.interactions);
    pages.set(item.state.id, { ...item.state, messages, interactions });
  }
  const order = change.order ?? (before ?? []).map(page => page.id);
  const result = order.map(id => { const page = pages.get(id); if (!page) throw new Error('Invalid desktop page update'); return page; });
  if (result.length !== pages.size || new Set(order).size !== order.length) throw new Error('Invalid desktop page update');
  return before?.length === result.length && result.every((page, index) => page === before[index]) ? before : Object.freeze(result);
}

function diff<K extends Collection>(before: DesktopSnapshot[K], after: DesktopSnapshot[K]): CollectionDelta<K> | undefined {
  if (before === after) return undefined;
  const old = new Map(before.map(row => [row.id,row]));
  const next = new Set(after.map(row => row.id));
  const upserts = after.filter(row => !equal(old.get(row.id),row)) as Row<K>[];
  const removed = before.filter(row => !next.has(row.id)).map(row => row.id);
  const reordered = before.length !== after.length || before.some((row,index) => row.id !== after[index]?.id);
  if (!upserts.length && !removed.length && !reordered) return undefined;
  return {upserts,removed,...(reordered ? {order:after.map(row => row.id)} : {})};
}

export function snapshotDelta(before: DesktopSnapshot, after: DesktopSnapshot): DesktopSnapshotDelta {
  const sessionPages = diffPages(before.sessionPages, after.sessionPages);
  return {
    kind:'delta',baseRevision:before.revision,revision:after.revision,state:state(after),
    ...(sessionPages ? { sessionPages } : {}),
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
  const sessionPages = applyPages(before.sessionPages, change.sessionPages);
  return Object.freeze({
    ...change.state,revision:change.revision,
    ...(sessionPages === undefined ? {} : { sessionPages }),
    channels:apply<'channels'>(before.channels,change.channels),threads:apply<'threads'>(before.threads,change.threads),
    messages:apply<'messages'>(before.messages,change.messages),interactions:apply<'interactions'>(before.interactions,change.interactions),
  });
}

// A full baseline (startup/gap recovery) also preserves equal row identities.
export function reconcileSnapshot(before: DesktopSnapshot, after: DesktopSnapshot): DesktopSnapshot {
  const change = snapshotDelta(before,after);
  return Object.freeze({
    ...after,channels:apply<'channels'>(before.channels,change.channels),threads:apply<'threads'>(before.threads,change.threads),
    ...(after.sessionPages ? { sessionPages:reconcilePages(before.sessionPages,after.sessionPages) } : {}),
    messages:apply<'messages'>(before.messages,change.messages),interactions:apply<'interactions'>(before.interactions,change.interactions),
  });
}
