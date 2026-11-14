import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type React from 'react';
import { memberIdentityText, type MemberIdentity } from '@hermes-app/client';
import type { DesktopConnection, DesktopSnapshot } from '../shared/desktop-api';
import { ModelSettings } from './model-settings';
import { VaultSettings } from './vault-settings';
import { EnvKeysSettings } from './env-keys-settings';
import { ProfileFilesSettings } from './profile-files-settings';

export const CONNECTION_LIMIT = 8;
export const connectionStateLabels = { online: 'Online', connecting: 'Connecting', syncing: 'Syncing', retrying: 'Reconnecting', suspended: 'Offline', blocked: 'Needs attention', pairing: 'Pairing' } as const;

/** Connections overview: every saved connection (opens its own page) and Add connection. */
export function ConnectionSettings({ snapshot, onOpen }: { snapshot: DesktopSnapshot; onOpen(id: string): void }) {
  const [adding, setAdding] = useState(false);
  const [server, setServer] = useState('');
  const [code, setCode] = useState('');
  const [device, setDevice] = useState('Hermes desktop');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const working = useRef(false);
  const rows = snapshot.connections ?? [];
  const add = async () => {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try {
      const before = new Set(rows.map(row => row.id));
      await window.hermesDesktop.addConnection({ baseUrl: server.trim(), code, deviceName: device.trim() });
      const readback = await window.hermesDesktop.getSnapshot();
      if (!readback.connections?.some(row => !before.has(row.id))) throw new Error('Not confirmed');
      setCode(''); setServer(''); setAdding(false);
    } catch (failure) { setCode(''); setError(failure instanceof Error && failure.message.includes('already saved') ? 'This server is already saved. Use its existing connection.' : 'Could not add the connection. Check the HTTPS address, pairing code and device name, then try again.'); }
    finally { working.current = false; setBusy(false); }
  };
  return <div className="settings-section settings-connections">
    <p className="settings-description">Saved Hermes connections on this device. Sessions from all connections appear in the sidebar. Open a connection for its status, default model and removal.</p>
    {snapshot.connectionsError && <p role="alert">{snapshot.connectionsError}</p>}
    {rows.length ? <ul className="settings-connection-list" aria-label="Saved connections">{rows.map(row => <li key={row.id} data-connection-id={row.id}>
      <div className="settings-connection-info"><strong>{row.name}</strong><span className="settings-connection-address">{row.server || 'Saved server address unavailable'}</span><span className={`settings-connection-state state-${row.state}`} role="status">{connectionStateLabels[row.state]}</span>{row.detail && <p className="settings-description">{row.detail}</p>}</div>
      <button type="button" className="secondary settings-connection-open" aria-label={`Open connection ${row.server || row.name}`} onClick={() => onOpen(row.id)}>Open</button>
    </li>)}</ul> : <p>No saved connections. Add a connection to open your sessions.</p>}
    {adding ? <form onSubmit={event => { event.preventDefault(); void add(); }}>
      <h4>Add connection</h4><label className="settings-field">Server address<input type="url" aria-label="Server address" placeholder="https://your-hermes.example" maxLength={300} required autoFocus autoComplete="url" value={server} disabled={busy} onChange={event => setServer(event.target.value)} /></label>
      <label className="settings-field">One-time pairing code<input type="password" aria-label="One-time pairing code" placeholder="XXXX-XXXX-XXXX-XXXX" maxLength={32} required autoComplete="one-time-code" value={code} disabled={busy} onChange={event => setCode(event.target.value)} /></label>
      <label className="settings-field">Device name<input aria-label="Device name" maxLength={64} required value={device} disabled={busy} onChange={event => setDevice(event.target.value)} /></label>
      <p className="settings-description">Use a pairing code from this server. Your existing connections stay connected.</p><div className="settings-actions"><button type="submit" disabled={busy || !server.trim() || !code.trim() || !device.trim()}>{busy ? 'Adding…' : 'Pair connection'}</button><button type="button" className="secondary" disabled={busy} onClick={() => { setAdding(false); setCode(''); }}>Cancel</button></div>
    </form> : <button type="button" disabled={busy || !!snapshot.connectionsError || rows.length >= CONNECTION_LIMIT} onClick={() => { setAdding(true); setError(''); }}>Add connection</button>}
    {rows.length >= CONNECTION_LIMIT && <p className="settings-description">This version supports eight connections. Remove one before adding another.</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

/**
 * Read-only: the team member this connection speaks as. The server decides it from the device
 * pairing; only an administrator can change it. Hidden when the server does not report it.
 */
export function ConnectionIdentity({ connectionKey, online }: { connectionKey?: string; online: boolean }) {
  const [identity, setIdentity] = useState<MemberIdentity | null>(null);
  useEffect(() => {
    if (!connectionKey || !online) return;
    let alive = true;
    window.hermesDesktop.getMemberIdentity(connectionKey).then(value => { if (alive) setIdentity(value); }, () => { if (alive) setIdentity(null); });
    return () => { alive = false; };
  }, [connectionKey, online]);
  if (!identity) return null;
  const text = memberIdentityText(identity);
  return <div className="settings-connection-identity">
    <h5>Speaking as</h5>
    <p className={text.bound ? 'settings-connection-member' : 'settings-connection-member issue'} role="status">{text.value}</p>
    <p className="settings-description">{text.hint}</p>
  </div>;
}

/** This device's name for one connection. Blank restores the server's host name. */
function ConnectionName({ row, disabled }: { row: DesktopConnection; disabled?: boolean }) {
  const saved = row.customName ? row.name : '';
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const edited = useRef(false);
  // A rename from another window updates the field until the user starts typing.
  useEffect(() => { if (!edited.current) setDraft(saved); }, [saved]);
  const unchanged = draft.trim() === saved;
  const save = async () => {
    if (busy || unchanged) return;
    setBusy(true); setMessage(null);
    try {
      await window.hermesDesktop.renameConnection(row.id, draft);
      edited.current = false; setDraft(draft.trim()); setMessage({ error: false, text: 'Saved.' });
    } catch (failure) {
      const reason = failure instanceof Error ? failure.message : '';
      setMessage({ error: true, text: /characters/.test(reason) ? reason.replace(/^.*?(Name )/, '$1') : 'Could not save the name. Nothing changed. Try again.' });
    } finally { setBusy(false); }
  };
  return <form className="settings-connection-name" onSubmit={event => { event.preventDefault(); void save(); }}>
    <label className="settings-field">Name<input aria-label="Connection name" maxLength={80} placeholder={row.defaultName ?? row.name} value={draft} disabled={busy || disabled}
      onChange={event => { edited.current = true; setMessage(null); setDraft(event.target.value); }} /></label>
    <p className="settings-description">Shown in the sidebar and in tabs on this device. Leave blank to use {row.defaultName ?? 'the server address'}.</p>
    <div className="settings-actions"><button type="submit" disabled={busy || disabled || unchanged}>{busy ? 'Saving…' : 'Save name'}</button></div>
    {message && <p role={message.error ? 'alert' : 'status'} className={message.error ? undefined : 'settings-description'}>{message.text}</p>}
  </form>;
}

export type ConnectionTab = 'general' | 'model' | 'vault' | 'keys' | 'files';
/** Tabs of one connection: General is this device; the other tabs apply to its Hermes on every device. */
export const CONNECTION_TABS: readonly { id: ConnectionTab; label: string }[] = [
  { id: 'general', label: 'General' }, { id: 'model', label: 'Model' }, { id: 'vault', label: 'Passwords & Logins' },
  { id: 'keys', label: 'API keys' }, { id: 'files', label: 'Persona & memory' },
];

/**
 * One connection as tabs (docs/profile-files.md): General (status, name, removal on this device),
 * then the settings of its Hermes server, which apply on every device.
 */
export function ConnectionPage({ row, disabled }: { row: DesktopConnection; disabled?: boolean }) {
  const [tab, setTab] = useState<ConnectionTab>('general');
  const [visited, setVisited] = useState<ReadonlySet<ConnectionTab>>(() => new Set(['general']));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const working = useRef(false);
  const pairing = row.state === 'pairing';
  const remove = async () => {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try {
      await window.hermesDesktop.removeConnection(row.id);
      const readback = await window.hermesDesktop.getSnapshot();
      // Settings returns to Connections once the snapshot no longer has this row.
      if (!readback.connections || readback.connections.some(item => item.id === row.id)) throw new Error('Not confirmed');
    } catch (failure) { setError(failure instanceof Error && failure.message.includes('Wait for the current action') ? 'Wait for the current action before removing this connection.' : 'Could not confirm removal. Check the connection list before trying again.'); }
    finally { working.current = false; setBusy(false); }
  };
  const tabs = CONNECTION_TABS;
  const select = (id: ConnectionTab) => { setTab(id); setVisited(seen => seen.has(id) ? seen : new Set(seen).add(id)); };
  const moveTab = (event: KeyboardEvent<HTMLDivElement>) => {
    const { key } = event;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
    event.preventDefault();
    const index = tabs.findIndex(item => item.id === tab);
    const next = tabs[(index + (key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].id;
    select(next); event.currentTarget.querySelector<HTMLElement>(`#${tabId(next)}`)?.focus();
  };
  const tabId = (id: ConnectionTab) => `connection-${row.id}-tab-${id}`;
  const panelId = (id: ConnectionTab) => `connection-${row.id}-panel-${id}`;
  const server = 'Applies to this Hermes on every device.';
  // Each tab is mounted when first opened and stays mounted, so drafts survive a tab change.
  const panel = (id: ConnectionTab, children: React.ReactNode) => (visited.has(id) || tab === id) &&
    <div key={id} className="settings-connection-panel" role="tabpanel" id={panelId(id)} aria-labelledby={tabId(id)} hidden={tab !== id}>{children}</div>;
  return <div className="settings-section settings-connection-page" data-connection-id={row.id}>
    <div className="settings-connection-tabs" role="tablist" aria-label={`${row.name} settings`} onKeyDown={moveTab}>
      {tabs.map(item => <button key={item.id} type="button" role="tab" id={tabId(item.id)} aria-controls={panelId(item.id)} aria-selected={tab === item.id}
        tabIndex={tab === item.id ? 0 : -1} onClick={() => select(item.id)}>{item.label}</button>)}
    </div>
    {panel('general', <>
      <section className="settings-group" aria-labelledby={`settings-group-status-${row.id}`}>
        <h4 id={`settings-group-status-${row.id}`}>Status</h4>
        <p className="settings-connection-address">{row.server || 'Saved server address unavailable'}</p>
        <span className={`settings-connection-state state-${row.state}`} role="status">{connectionStateLabels[row.state]}</span>
        {row.detail && <p className="settings-description">{row.detail}</p>}
        <ConnectionIdentity key={row.connectionKey ?? 'unpaired'} connectionKey={row.connectionKey} online={row.state === 'online'} />
      </section>
      <section className="settings-group" aria-labelledby={`settings-group-device-${row.id}`}>
        <h4 id={`settings-group-device-${row.id}`}>On this device</h4>
        <ConnectionName key={row.id} row={row} disabled={disabled} />
        <p className="settings-description">Removing does not delete conversations on the server or stop running tasks.</p>
        {confirming ? <div className="settings-danger" role="alert"><h4>Remove {row.name}?</h4><p>This removes this connection, its open tabs, local drafts and queued messages from this device. Other connections and server conversations are unchanged.</p><div className="settings-actions"><button type="button" disabled={busy} onClick={() => void remove()}>{busy ? 'Removing…' : 'Remove connection'}</button><button type="button" className="secondary" disabled={busy} onClick={() => setConfirming(false)}>Keep connection</button></div></div>
          : <button type="button" className="secondary settings-remove" aria-label={`${pairing ? 'Cancel pairing' : 'Remove connection'} ${row.server || row.name}`} disabled={busy || disabled} onClick={() => { setConfirming(true); setError(''); }}>{pairing ? 'Cancel pairing' : 'Remove connection'}</button>}
        {error && <p role="alert">{error}</p>}
      </section>
    </>)}
    {panel('model', <section className="settings-group">
      <p className="settings-description">{server} Conversations with their own model selection keep it. Running replies are not interrupted.</p>
      <h5>Default model</h5>
      <ModelSettings key={row.connectionKey ?? 'unpaired'} connectionKey={row.connectionKey} />
    </section>)}
    {panel('vault', <section className="settings-group">
      <p className="settings-description">{server}</p>
      <VaultSettings key={`vault:${row.connectionKey ?? 'unpaired'}`} connectionKey={row.connectionKey} />
    </section>)}
    {panel('keys', <section className="settings-group">
      <p className="settings-description">{server}</p>
      <EnvKeysSettings key={`env-keys:${row.connectionKey ?? 'unpaired'}`} connectionKey={row.connectionKey} />
    </section>)}
    {panel('files', <section className="settings-group">
      <ProfileFilesSettings key={`profile-files:${row.connectionKey ?? 'unpaired'}`} connectionKey={row.connectionKey} />
    </section>)}
  </div>;
}
