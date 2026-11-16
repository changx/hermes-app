import { useEffect, useRef, useState } from 'react';
import type { DesktopSnapshot } from '../shared/desktop-api';
import { GROUP_NAME_MAX, MAX_GROUPS, type ConnectionGroup } from '../../../../packages/client/src/connectionGroups';

/** Messages from the shared rules (connectionGroups.ts) are written for the user; others are replaced. */
const userMessage = (failure: unknown, fallback: string): string => {
  const reason = failure instanceof Error ? failure.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '';
  return /^(Enter a group name|A group with this name|This version supports|Name )/.test(reason) ? reason : fallback;
};

/**
 * Settings > Groups (docs/connection-groups.md). Groups separate connections, for example Work and
 * Home. The sidebar shows one group at a time. Groups are kept on this device only.
 */
export function GroupSettings({ snapshot }: { snapshot: DesktopSnapshot }) {
  const state = snapshot.connectionGroups, rows = snapshot.connections ?? [];
  const groups = state?.groups ?? [];
  const blocked = !state || !!state.unavailable || !!snapshot.connectionsError;
  const [name, setName] = useState(''), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const run = async (work: () => Promise<void>, done: string, fallback: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true); setMessage(null);
    try { await work(); setMessage({ error: false, text: done }); return true; }
    catch (failure) { setMessage({ error: true, text: userMessage(failure, fallback) }); return false; }
    finally { setBusy(false); }
  };
  const add = async () => { if (await run(() => window.hermesDesktop.addGroup(name), 'Group added.', 'Could not add the group. Nothing changed. Try again.')) setName(''); };
  const remove = (group: ConnectionGroup) => {
    if (!window.confirm(`Delete the group “${group.name}”? Its connections stay saved and connected. They then show only in All.`)) return;
    void run(() => window.hermesDesktop.removeGroup(group.id), 'Group deleted.', 'Could not delete the group. Nothing changed. Try again.');
  };
  const assign = (connectionId: string, id: string) =>
    void run(() => window.hermesDesktop.assignGroup(connectionId, id || null), 'Saved.', 'Could not change the group. Nothing changed. Try again.');
  return <div className="settings-section settings-groups">
    <p className="settings-description">Groups keep connections apart, for example Work and Home. The sidebar shows one group at a time: its Projects, Sessions, tabs, Automations and search results. All shows every connection. Every connection stays connected. Groups apply only on this device.</p>
    {state?.unavailable && <p role="alert">Saved groups could not be read. Hermes shows every connection. Reopen Hermes to try again.</p>}
    <section className="settings-group" aria-labelledby="settings-groups-list">
      <h4 id="settings-groups-list">Groups</h4>
      {groups.length === 0 && <p className="settings-description">No groups yet. Add one, then choose its connections below.</p>}
      {groups.map(group => <GroupName key={group.id} group={group} disabled={blocked || busy} onRename={value => run(() => window.hermesDesktop.renameGroup(group.id, value), 'Saved.', 'Could not rename the group. Nothing changed. Try again.')} onDelete={() => remove(group)} />)}
      <form className="settings-group-row" onSubmit={event => { event.preventDefault(); void add(); }}>
        <input aria-label="New group name" placeholder="New group, for example Work" maxLength={GROUP_NAME_MAX * 2} value={name} disabled={blocked || busy || groups.length >= MAX_GROUPS}
          onChange={event => { setMessage(null); setName(event.target.value); }} />
        <button type="submit" disabled={blocked || busy || !name.trim() || groups.length >= MAX_GROUPS}>Add group</button>
      </form>
    </section>
    {groups.length > 0 && <section className="settings-group" aria-labelledby="settings-groups-connections">
      <h4 id="settings-groups-connections">Connections</h4>
      {rows.map(row => <label key={row.id} className="settings-field settings-group-connection">{row.name}
        <select aria-label={`Group of ${row.name}`} value={row.groupId ?? ''} disabled={blocked || busy} onChange={event => assign(row.id, event.target.value)}>
          <option value="">No group (only in All)</option>
          {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select></label>)}
    </section>}
    {message && <p role={message.error ? 'alert' : 'status'} className={message.error ? undefined : 'settings-description'}>{message.text}</p>}
  </div>;
}

/** One group: its name (saved with Enter or the Rename button) and Delete. */
function GroupName({ group, disabled, onRename, onDelete }: { group: ConnectionGroup; disabled: boolean; onRename: (name: string) => Promise<boolean>; onDelete: () => void }) {
  const [draft, setDraft] = useState(group.name);
  const edited = useRef(false);
  // A rename from another window updates the field until the user starts typing.
  useEffect(() => { if (!edited.current) setDraft(group.name); }, [group.name]);
  const unchanged = draft.trim() === group.name;
  return <form className="settings-group-row" onSubmit={event => { event.preventDefault(); if (!unchanged) void onRename(draft).then(ok => { if (ok) edited.current = false; }); }}>
    <input aria-label={`Name of group ${group.name}`} maxLength={GROUP_NAME_MAX * 2} value={draft} disabled={disabled}
      onChange={event => { edited.current = true; setDraft(event.target.value); }} />
    <button type="submit" disabled={disabled || unchanged || !draft.trim()}>Rename</button>
    <button type="button" disabled={disabled} onClick={onDelete}>Delete</button>
  </form>;
}
