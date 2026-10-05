import { useRef, useState } from 'react';
import type { DesktopConnection, DesktopSnapshot } from '../shared/desktop-api';

export function ConnectionSettings({ snapshot }: { snapshot: DesktopSnapshot }) {
  const [adding, setAdding] = useState(false);
  const [server, setServer] = useState('');
  const [code, setCode] = useState('');
  const [device, setDevice] = useState('Hermes desktop');
  const [target, setTarget] = useState<DesktopConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const working = useRef(false);
  const rows = snapshot.connections ?? [];
  const labels = { online: 'Online', connecting: 'Connecting', syncing: 'Syncing', retrying: 'Reconnecting', suspended: 'Offline', blocked: 'Needs attention', pairing: 'Pairing' };
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
  const remove = async () => {
    if (!target || working.current) return;
    working.current = true; setBusy(true); setError('');
    try {
      await window.hermesDesktop.removeConnection(target.id);
      const readback = await window.hermesDesktop.getSnapshot();
      if (!readback.connections || readback.connections.some(row => row.id === target.id)) throw new Error('Not confirmed');
      setTarget(null);
    } catch (failure) { setError(failure instanceof Error && failure.message.includes('Wait for the current action') ? 'Wait for the current action before removing this connection.' : 'Could not confirm removal. Check the connection list before trying again.'); }
    finally { working.current = false; setBusy(false); }
  };
  return <div className="settings-section settings-connections">
    <p className="settings-description">Manage saved Hermes connections on this device. Sessions from all connections appear in the sidebar.</p>
    {snapshot.connectionsError && <p role="alert">{snapshot.connectionsError}</p>}
    {rows.length ? <ul className="settings-connection-list" aria-label="Saved connections">{rows.map(row => <li key={row.id} data-connection-id={row.id}>
      <div className="settings-connection-info"><strong>{row.name}</strong><span className="settings-connection-address">{row.server || 'Saved server address unavailable'}</span><span className={`settings-connection-state state-${row.state}`} role="status">{labels[row.state]}</span>{row.detail && <p className="settings-description">{row.detail}</p>}</div>
      <button type="button" className="secondary" aria-label={`Remove connection ${row.server || row.name}`} disabled={busy || !!snapshot.connectionsError} onClick={() => { setTarget(row); setAdding(false); setCode(''); setError(''); }}>{row.state === 'pairing' ? 'Cancel pairing' : 'Remove'}</button>
    </li>)}</ul> : <p>No saved connections. Add a connection to open your sessions.</p>}
    {target && <div className="settings-danger" role="alert"><h4>Remove {target.name}?</h4><p>{target.server}</p><p>This removes this connection, its open tabs, local drafts and queued messages from this device. Other connections and server conversations are unchanged.</p><div className="settings-actions"><button type="button" disabled={busy} onClick={() => void remove()}>{busy ? 'Removing…' : 'Remove connection'}</button><button type="button" className="secondary" disabled={busy} onClick={() => setTarget(null)}>Keep connection</button></div></div>}
    {adding ? <form onSubmit={event => { event.preventDefault(); void add(); }}>
      <h4>Add connection</h4><label className="settings-field">Server address<input type="url" aria-label="Server address" placeholder="https://your-hermes.example" maxLength={300} required autoFocus autoComplete="url" value={server} disabled={busy} onChange={event => setServer(event.target.value)} /></label>
      <label className="settings-field">One-time pairing code<input type="password" aria-label="One-time pairing code" placeholder="XXXX-XXXX-XXXX-XXXX" maxLength={32} required autoComplete="one-time-code" value={code} disabled={busy} onChange={event => setCode(event.target.value)} /></label>
      <label className="settings-field">Device name<input aria-label="Device name" maxLength={64} required value={device} disabled={busy} onChange={event => setDevice(event.target.value)} /></label>
      <p className="settings-description">Use a pairing code from this server. Your existing connections stay connected.</p><div className="settings-actions"><button type="submit" disabled={busy || !server.trim() || !code.trim() || !device.trim()}>{busy ? 'Adding…' : 'Pair connection'}</button><button type="button" className="secondary" disabled={busy} onClick={() => { setAdding(false); setCode(''); }}>Cancel</button></div>
    </form> : <button type="button" disabled={busy || !!snapshot.connectionsError || rows.length >= 8} onClick={() => { setAdding(true); setTarget(null); setError(''); }}>Add connection</button>}
    {rows.length >= 8 && <p className="settings-description">This version supports eight connections. Remove one before adding another.</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
