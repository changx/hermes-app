import { useRef, useState } from 'react';
import type { DesktopConnection, DesktopSnapshot } from '../shared/desktop-api';
import { ModelSettings } from './model-settings';

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
 * One connection, grouped by where each setting takes effect:
 * its status, its Hermes server (every device), and this device only.
 */
export function ConnectionPage({ row, disabled }: { row: DesktopConnection; disabled?: boolean }) {
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
  return <div className="settings-section settings-connection-page" data-connection-id={row.id}>
    <section className="settings-group" aria-labelledby="settings-group-status">
      <h4 id="settings-group-status">Status</h4>
      <p className="settings-connection-address">{row.server || 'Saved server address unavailable'}</p>
      <span className={`settings-connection-state state-${row.state}`} role="status">{connectionStateLabels[row.state]}</span>
      {row.detail && <p className="settings-description">{row.detail}</p>}
    </section>
    <section className="settings-group" aria-labelledby="settings-group-server">
      <h4 id="settings-group-server">On this Hermes · all your devices</h4>
      <p className="settings-description">Applies to this Hermes on every device. Conversations with their own model selection keep it. Running replies are not interrupted.</p>
      <h5>Default model</h5>
      <ModelSettings key={row.connectionKey ?? 'unpaired'} connectionKey={row.connectionKey} />
    </section>
    <section className="settings-group" aria-labelledby="settings-group-device">
      <h4 id="settings-group-device">On this device</h4>
      <p className="settings-description">Removing does not delete conversations on the server or stop running tasks.</p>
      {confirming ? <div className="settings-danger" role="alert"><h4>Remove {row.name}?</h4><p>This removes this connection, its open tabs, local drafts and queued messages from this device. Other connections and server conversations are unchanged.</p><div className="settings-actions"><button type="button" disabled={busy} onClick={() => void remove()}>{busy ? 'Removing…' : 'Remove connection'}</button><button type="button" className="secondary" disabled={busy} onClick={() => setConfirming(false)}>Keep connection</button></div></div>
        : <button type="button" className="secondary settings-remove" aria-label={`${pairing ? 'Cancel pairing' : 'Remove connection'} ${row.server || row.name}`} disabled={busy || disabled} onClick={() => { setConfirming(true); setError(''); }}>{pairing ? 'Cancel pairing' : 'Remove connection'}</button>}
      {error && <p role="alert">{error}</p>}
    </section>
  </div>;
}
