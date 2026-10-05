import { useEffect, useRef, useState } from 'react';
import type { DesktopSnapshot } from '../shared/desktop-api';

export function NewProjectDialog({ snapshot, close }: { snapshot: DesktopSnapshot; close: () => void }) {
  const connections = (snapshot.connections ?? []).filter(row => row.connectionKey);
  const [connectionKey, setConnectionKey] = useState(() => connections.length === 1 ? connections[0].connectionKey! : '');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState('');
  const working = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const selected = connections.find(row => row.connectionKey === connectionKey);
  const available = selected?.state === 'online';
  const submit = async () => {
    if (working.current || attempted || !available || !connectionKey || !name.trim()) return;
    working.current = true; setBusy(true); setAttempted(true); setError('');
    // Capture the exact identity. Active tab changes never retarget this request.
    try {
      await window.hermesDesktop.createChannel({ connectionKey, name, description });
      if (alive.current) close();
    } catch {
      if (alive.current) setError('Project creation could not be confirmed. Check this connection’s project list before trying again. Your form is unchanged.');
    } finally { working.current = false; if (alive.current) setBusy(false); }
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={() => { if (!busy) close(); }}>
    <form className="editor-dialog" role="dialog" aria-modal="true" aria-label="New project" onSubmit={event => { event.preventDefault(); void submit(); }} onMouseDown={event => event.stopPropagation()}>
      <h2>New project</h2>
      <label>Connection<select autoFocus aria-label="Project connection" required value={connectionKey} disabled={busy || attempted} onChange={event => { setConnectionKey(event.target.value); setError(''); }}>
        <option value="" disabled>Choose a connection</option>
        {connectionKey && !selected && <option value={connectionKey} disabled>Selected connection unavailable</option>}
        {connections.map(row => <option key={row.id} value={row.connectionKey} disabled={row.state !== 'online'}>{row.name} — {row.server}{row.state !== 'online' ? ' (unavailable)' : ''}</option>)}
      </select></label>
      {connectionKey && !available && <p role="alert">The selected connection is unavailable. This form will not use another connection.</p>}
      {!connections.length && <p role="status">Add a connection in Settings before creating a project.</p>}
      <label>Name<input aria-label="Project name" required maxLength={120} value={name} disabled={busy || attempted} onChange={event => setName(event.target.value)} /></label>
      <label>Description<textarea aria-label="Project description" maxLength={4000} value={description} disabled={busy || attempted} onChange={event => setDescription(event.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="secondary" disabled={busy} onClick={close}>Cancel</button><button type="submit" disabled={!available || !name.trim() || busy || attempted}>{busy ? 'Creating…' : 'Create project'}</button></div>
    </form>
  </div>;
}
