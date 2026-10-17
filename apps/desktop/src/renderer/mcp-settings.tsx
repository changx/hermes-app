import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesktopMcpResult, DesktopMcpServerState, DesktopMcpState } from '../shared/desktop-api';

/**
 * Settings > MCP servers: tools on this computer that Hermes can use in every project.
 * The configuration is the standard `mcpServers` JSON, kept in a file on this computer.
 * See docs/desktop-mcp-host.md.
 */

const TEMPLATE = '{\n  "mcpServers": {}\n}\n';
const STATUS: Record<DesktopMcpServerState['status'], string> = { stopped: 'Not running', starting: 'Starting', running: 'Running', failed: 'Could not start' };

export function McpSettings() {
  const [state, setState] = useState<DesktopMcpState | null>(null);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  // Server status changes while Settings is open, and the file can change outside the app.
  const refresh = useCallback(() => window.hermesDesktop.getMcp().then(next => {
    setState(next);
    if (!dirtyRef.current) setDraft(next.text || TEMPLATE);
  }), []);
  useEffect(() => {
    let live = true;
    refresh().catch(() => { if (live) setError('MCP servers could not be loaded.'); });
    const timer = window.setInterval(() => { if (live) void refresh().catch(() => undefined); }, 2000);
    return () => { live = false; window.clearInterval(timer); };
  }, [refresh]);

  const apply = async (change: () => Promise<DesktopMcpResult>, done: (result: Extract<DesktopMcpResult, { ok: true }>) => string) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await change();
      if (!result.ok) { setError(result.error); return; }
      setState(result.state); setDraft(result.state.text || TEMPLATE); setDirty(false);
      setNotice(done(result));
    } catch { setError('The change could not be saved. Try again.'); }
    finally { setBusy(false); }
  };
  const save = () => apply(() => window.hermesDesktop.saveMcp(draft), () => 'Saved. Hermes uses these servers from now on.');
  const importClaude = () => apply(() => window.hermesDesktop.importClaudeMcp(), result => {
    const added = result.added ?? [], skipped = result.skipped ?? [];
    const parts = [added.length ? `Added ${added.join(', ')}. Hermes asks before each use.` : 'No new servers were found in Claude Desktop.'];
    if (skipped.length) parts.push(`Skipped ${skipped.join(', ')}: the name is already used or the entry is not supported.`);
    return parts.join(' ');
  });
  const setApproval = (name: string, approval: 'ask' | 'auto') => {
    if (dirty) { setError('Save or discard your changes to the configuration first.'); return; }
    void apply(() => window.hermesDesktop.setMcpApproval(name, approval), () => approval === 'auto' ? `${name} now runs without asking.` : `Hermes now asks before each use of ${name}.`);
  };
  const mac = window.hermesDesktop.getRuntimeInfo().platform === 'darwin';
  const servers = state?.servers ?? [];

  return <div className="settings-section settings-mcp">
    <p className="settings-description">MCP servers on this computer that Hermes can use for you, in every project. They run only while Hermes is open on this computer. Their settings, including keys, stay on this computer.</p>
    {state?.error && <p role="alert">The configuration file has an error, so Hermes still uses the last valid version: {state.error}</p>}
    {servers.length ? <ul className="settings-connection-list" aria-label="MCP servers">{servers.map(server => <li key={server.name} data-mcp-server={server.name}>
      <div className="settings-connection-info">
        <strong>{server.name}</strong>
        <span className="settings-connection-address">{server.kind === 'http' ? 'Web address' : 'Program on this computer'}</span>
        <span className={`settings-connection-state state-${server.disabled ? 'off' : server.status === 'running' ? 'online' : server.status === 'failed' ? 'blocked' : server.status === 'starting' ? 'connecting' : 'idle'}`} role="status">{server.disabled ? 'Turned off' : STATUS[server.status]}</span>
        {server.status === 'failed' && server.message && <p className="settings-description settings-mcp-message">{server.message}</p>}
      </div>
      <label className="settings-mcp-approval">Before each use
        <select aria-label={`Approval for ${server.name}`} value={server.approval} disabled={busy} onChange={event => setApproval(server.name, event.target.value as 'ask' | 'auto')}>
          <option value="ask">Ask me</option><option value="auto">Run without asking</option>
        </select></label>
    </li>)}</ul> : state && <p>No MCP servers yet. Add them below, or import them from Claude Desktop.</p>}
    <label className="settings-field">Configuration
      <textarea className="settings-mcp-editor" aria-label="MCP configuration" spellCheck={false} autoCapitalize="off" autoComplete="off" rows={14} value={draft} disabled={!state || busy}
        onChange={event => { setDraft(event.target.value); setDirty(true); setNotice(''); }} /></label>
    <p className="settings-description">Use the same format as Claude Desktop. Add <code>"approval": "auto"</code> to run a server without asking, or <code>"disabled": true</code> to turn it off.{state && <> File: <span className="settings-mcp-path">{state.path}</span></>}</p>
    <div className="settings-actions">
      <button type="button" disabled={!dirty || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
      <button type="button" className="secondary" disabled={!dirty || busy} onClick={() => { setDraft(state?.text || TEMPLATE); setDirty(false); setError(''); }}>Discard changes</button>
      {state?.claudeAvailable && <button type="button" className="secondary" disabled={busy || dirty} onClick={() => void importClaude()}>Import from Claude Desktop</button>}
      <button type="button" className="secondary" disabled={!state} onClick={() => void window.hermesDesktop.showMcpFile().catch(() => setError('The file could not be shown.'))}>{mac ? 'Show in Finder' : 'Show file'}</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {notice && <p className="settings-success" role="status">{notice}</p>}
  </div>;
}
