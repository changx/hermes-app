/**
 * Connection groups are a device preference (docs/connection-groups.md).
 *
 * A group is a named set of saved connections, for example "Work" and "Home".
 * Each connection belongs to at most one group. The active group decides which
 * connections the lists of this device show: Projects, Recents, Todo,
 * Automations, search and tabs. `active: null` is "All": every connection.
 * A connection without a group is shown only in All.
 *
 * Groups never leave the device and never change what a connection does: every
 * saved connection stays connected, receives results and keeps its pages.
 */
export const GROUP_NAME_MAX = 40;
export const MAX_GROUPS = 8;
export const GROUP_NAME_EMPTY = 'Enter a group name.';
export const GROUP_NAME_TAKEN = 'A group with this name already exists.';
export const GROUP_LIMIT = `This version supports ${MAX_GROUPS} groups.`;
export const ALL_GROUPS_LABEL = 'All';
export const GROUP_NAME_INVALID = 'Name contains unsupported characters.';
export const GROUP_NAME_TOO_LONG = `Name must be ${GROUP_NAME_MAX} characters or fewer.`;
// The same rule as connection names (connectionName.ts). This module has no imports, so desktop
// and mobile load it the same way. Control and bidirectional override characters could disguise a name.
const forbidden = /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u206f]/u;

export type ConnectionGroup = Readonly<{ id: string; name: string }>;
export type ConnectionGroups = Readonly<{
  /** Display order is the order of creation. */
  groups: readonly ConnectionGroup[];
  /** Connection slot ID to group ID. */
  members: Readonly<Record<string, string>>;
  /** The group this device shows, or null for All. */
  active: string | null;
}>;
export const NO_GROUPS: ConnectionGroups = Object.freeze({ groups: Object.freeze([]), members: Object.freeze({}), active: null });

const groupId = /^g[0-9a-f]{8,32}$/;
const slotId = /^(primary|[0-9a-f]{24})$/;
const key = (name: string) => name.toLocaleLowerCase();

/** Returns the trimmed group name, or throws a message that can be shown to the user. */
export function normalizeGroupName(value: string): string {
  if (forbidden.test(value)) throw new Error(GROUP_NAME_INVALID);
  const name = value.trim();
  if (!name) throw new Error(GROUP_NAME_EMPTY);
  if (Array.from(name).length > GROUP_NAME_MAX) throw new Error(GROUP_NAME_TOO_LONG);
  return name;
}

/** Validates stored or received data. Throws on any invalid field, so damaged data is never saved again. */
export function parseConnectionGroups(raw: unknown): ConnectionGroups {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid connection groups');
  const value = raw as { groups?: unknown; members?: unknown; active?: unknown };
  if (!Array.isArray(value.groups) || value.groups.length > MAX_GROUPS) throw new Error('Invalid connection groups');
  const ids = new Set<string>(), names = new Set<string>();
  const groups = value.groups.map(item => {
    const group = item as { id?: unknown; name?: unknown };
    if (!group || typeof group.id !== 'string' || !groupId.test(group.id) || ids.has(group.id) || typeof group.name !== 'string') throw new Error('Invalid connection groups');
    let name: string;
    try { name = normalizeGroupName(group.name); } catch { throw new Error('Invalid connection groups'); }
    if (name !== group.name || names.has(key(name))) throw new Error('Invalid connection groups');
    ids.add(group.id); names.add(key(name));
    return { id: group.id, name };
  });
  if (!value.members || typeof value.members !== 'object' || Array.isArray(value.members)) throw new Error('Invalid connection groups');
  const entries = Object.entries(value.members as Record<string, unknown>);
  if (entries.length > 8 || entries.some(([slot, id]) => !slotId.test(slot) || typeof id !== 'string' || !ids.has(id))) throw new Error('Invalid connection groups');
  if (value.active !== null && (typeof value.active !== 'string' || !ids.has(value.active))) throw new Error('Invalid connection groups');
  return { groups, members: Object.fromEntries(entries) as Record<string, string>, active: value.active };
}

function nameFree(state: ConnectionGroups, name: string, except?: string): void {
  if (state.groups.some(group => group.id !== except && key(group.name) === key(name))) throw new Error(GROUP_NAME_TAKEN);
}

/** Adds a group with a new random `id` (`g` + hex). The new group does not become active. */
export function addGroup(state: ConnectionGroups, value: string, id: string): ConnectionGroups {
  const name = normalizeGroupName(value);
  if (state.groups.length >= MAX_GROUPS) throw new Error(GROUP_LIMIT);
  if (!groupId.test(id) || state.groups.some(group => group.id === id)) throw new Error('Invalid group');
  nameFree(state, name);
  return { ...state, groups: [...state.groups, { id, name }] };
}

export function renameGroup(state: ConnectionGroups, id: string, value: string): ConnectionGroups {
  const name = normalizeGroupName(value);
  if (!state.groups.some(group => group.id === id)) throw new Error('Group unavailable');
  nameFree(state, name, id);
  return { ...state, groups: state.groups.map(group => group.id === id ? { id, name } : group) };
}

/** Deletes a group. Its connections become ungrouped; they stay saved and connected. */
export function removeGroup(state: ConnectionGroups, id: string): ConnectionGroups {
  if (!state.groups.some(group => group.id === id)) throw new Error('Group unavailable');
  return { groups: state.groups.filter(group => group.id !== id),
    members: Object.fromEntries(Object.entries(state.members).filter(([, group]) => group !== id)),
    active: state.active === id ? null : state.active };
}

/** Puts a connection in one group, or in no group with `null`. */
export function assignConnection(state: ConnectionGroups, slot: string, id: string | null): ConnectionGroups {
  if (!slotId.test(slot)) throw new Error('Connection unavailable');
  if (id !== null && !state.groups.some(group => group.id === id)) throw new Error('Group unavailable');
  const { [slot]: _previous, ...rest } = state.members;
  return { ...state, members: id === null ? rest : { ...rest, [slot]: id } };
}

/** A removed connection leaves its group. A later pairing in the same slot starts ungrouped. */
export function forgetConnection(state: ConnectionGroups, slot: string): ConnectionGroups {
  if (!(slot in state.members)) return state;
  const { [slot]: _removed, ...rest } = state.members;
  return { ...state, members: rest };
}

export function setActiveGroup(state: ConnectionGroups, id: string | null): ConnectionGroups {
  if (id !== null && !state.groups.some(group => group.id === id)) throw new Error('Group unavailable');
  return state.active === id ? state : { ...state, active: id };
}

/** Removes members whose connection is no longer saved. */
export function pruneMembers(state: ConnectionGroups, slots: Iterable<string>): ConnectionGroups {
  const saved = new Set(slots);
  const kept = Object.entries(state.members).filter(([slot]) => saved.has(slot));
  return kept.length === Object.keys(state.members).length ? state : { ...state, members: Object.fromEntries(kept) };
}

export function groupOf(state: ConnectionGroups, slot: string): ConnectionGroup | undefined {
  const id = state.members[slot];
  return id ? state.groups.find(group => group.id === id) : undefined;
}

/** True when the active group shows this connection. All shows every connection. */
export function showsConnection(state: ConnectionGroups, slot: string): boolean {
  return state.active === null || state.members[slot] === state.active;
}

export function activeGroupName(state: ConnectionGroups): string {
  return state.groups.find(group => group.id === state.active)?.name ?? ALL_GROUPS_LABEL;
}

/**
 * The choices of the group switcher, in display order: All, then each group.
 * `unread` is true when a connection of that choice has a completed result
 * that is not read yet. All has no unread mark; it would always repeat a group.
 */
export function groupChoices(state: ConnectionGroups, unreadSlots: ReadonlySet<string>): { id: string | null; name: string; active: boolean; unread: boolean; size: number }[] {
  const size = (id: string) => Object.values(state.members).filter(group => group === id).length;
  return [{ id: null, name: ALL_GROUPS_LABEL, active: state.active === null, unread: false, size: -1 },
    ...state.groups.map(group => ({ id: group.id, name: group.name, active: state.active === group.id, size: size(group.id),
      unread: Object.entries(state.members).some(([slot, id]) => id === group.id && unreadSlots.has(slot)) }))];
}

/** True when a group other than the active one has an unread result; the switcher shows a dot. */
export function otherGroupUnread(state: ConnectionGroups, unreadSlots: ReadonlySet<string>): boolean {
  return [...unreadSlots].some(slot => {
    const id = state.members[slot];
    return !!id && id !== state.active && state.active !== null;
  });
}
