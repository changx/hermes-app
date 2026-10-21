import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { DesktopProjectWorkspace, DesktopSnapshot } from '../shared/desktop-api';

/** Trailing slashes are not part of the folder name the server expects. */
const folderValue = (text: string): string => text.trim().replace(/\/+$/, '');
const folderError = (reason: 'invalid' | 'taken' | 'failed'): string => reason === 'invalid' ? 'This folder cannot be used. Choose an existing folder inside /opt/projects on the server.'
  : reason === 'taken' ? 'Another project already uses this folder.' : 'The primary folder change could not be confirmed. Try Save again.';

const CONTEXT_LIMIT = 4000;
type EditorTab = 'context' | 'agents';

/**
 * One modal for New project and Project options: Connection, Title and Primary folder on the left.
 * The right column is one large editor with tabs: Context, and AGENTS.md when the connection supports Project files.
 * Both editors stay mounted, so a tab switch keeps undo history and scroll position. A dot marks a tab with unsaved changes.
 * AGENTS.md follows the primary folder, so a folder change and an AGENTS.md edit are never saved together.
 * Without Project files support, the editor shows the Context tab only.
 * Project files are not managed here: files belong to their Session (docs/session-files.md).
 * Nothing is written before Save. A created Project is never created a second time;
 * a later partial failure keeps the form open in edit mode so Save can finish the rest.
 */
export function ProjectDialog({ snapshot, close, channelId }: { snapshot: DesktopSnapshot; close: () => void; channelId?: string }) {
  const connections = (snapshot.connections ?? []).filter(row => row.connectionKey);
  const [connectionKey, setConnectionKey] = useState(() => connections.length === 1 ? connections[0].connectionKey! : '');
  const [projectId, setProjectId] = useState(channelId);
  const editing = projectId !== undefined;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [agents, setAgents] = useState('');
  const [folder, setFolder] = useState('');
  const [folderSupportedOnServer, setFolderSupportedOnServer] = useState(false);
  const [archiveOnServer, setArchiveOnServer] = useState(false);
  // Last confirmed server values. Save writes only what differs from them.
  const saved = useRef({ name: '', description: '', agents: '', folder: '', etag: null as string | null });
  const [details, setDetails] = useState<'loading' | 'ready' | 'failed'>(channelId ? 'loading' : 'ready');
  const [workspace, setWorkspace] = useState<DesktopProjectWorkspace | 'loading' | 'failed' | null>(channelId ? 'loading' : null);
  const [busy, setBusy] = useState(false);
  const [creationFailed, setCreationFailed] = useState(false);
  const [agentsConflict, setAgentsConflict] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<EditorTab>('context');
  const working = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    if (!channelId) return;
    void window.hermesDesktop.getChannelInfo(channelId).then(value => {
      if (!alive.current) return;
      saved.current.name = value.name; saved.current.description = value.description ?? '';
      saved.current.folder = value.primaryPath ?? '';
      setName(value.name); setDescription(value.description ?? ''); setFolder(value.primaryPath ?? '');
      setFolderSupportedOnServer(value.primaryPathSupported === true); setArchiveOnServer(value.archiveSupported === true); setDetails('ready');
    }, () => { if (alive.current) setDetails('failed'); });
    void window.hermesDesktop.getProjectWorkspace(channelId).then(value => {
      if (!alive.current) return;
      saved.current.agents = value.agents?.content ?? ''; saved.current.etag = value.agents?.etag ?? null;
      setAgents(value.agents?.content ?? ''); setWorkspace(value);
    }, () => { if (alive.current) setWorkspace('failed'); });
  }, [channelId]);

  const project = projectId ? snapshot.channels.find(row => row.id === projectId) : undefined;
  const targetKey = editing ? project?.connectionKey ?? snapshot.connections?.find(row => row.connectionKey === connectionKey)?.connectionKey : connectionKey;
  const selected = connections.find(row => row.connectionKey === targetKey);
  const online = editing ? (snapshot.connections ? selected?.state === 'online' : snapshot.connectionState === 'online') : selected?.state === 'online';
  // Create mode reads the connection capability; edit mode reads the server answer.
  const filesSupported = channelId ? typeof workspace === 'object' && workspace?.supported === true : selected?.supportsProjectFiles === true;
  const workspaceReady = !channelId || typeof workspace === 'object' && workspace !== null;
  const locked = busy || creationFailed || details !== 'ready';
  const folderSupported = channelId ? folderSupportedOnServer : selected?.supportsPrimaryPath === true;
  // The connection already knows the capability, so the right removal button shows from the first frame.
  // Without it, wait for the server answer instead of showing Delete first.
  const archiveSupported = selected?.supportsChannelArchive === true || archiveOnServer;
  const removalKnown = archiveSupported || details === 'ready';
  const folderChanged = folderSupported && folderValue(folder) !== saved.current.folder;
  const agentsChanged = filesSupported && agents !== saved.current.agents;
  const changed = name.trim() !== saved.current.name || description.trim() !== saved.current.description || folderChanged || agentsChanged;
  // After an AGENTS.md conflict, Save stays off: the user must reopen to see the other version.
  const canSave = online && !!name.trim() && !locked && !agentsConflict && (!editing || changed);

  const submit = async () => {
    if (working.current || !canSave) return;
    working.current = true; setBusy(true); setError('');
    let id = projectId;
    try {
      if (!id) {
        try {
          id = await window.hermesDesktop.createChannel({ connectionKey, name, description });
        } catch {
          // The server may have created it. Never retry automatically.
          if (alive.current) { setCreationFailed(true); setError('Project creation could not be confirmed. Check this connection’s project list before trying again. Your form is unchanged.'); }
          return;
        }
        saved.current.name = name.trim(); saved.current.description = description.trim();
        if (alive.current) setProjectId(id);
      } else if (name.trim() !== saved.current.name || description.trim() !== saved.current.description) {
        try { await window.hermesDesktop.updateChannel(id, { name, description }); }
        catch { if (alive.current) { setTab('context'); setError('The title and context could not be saved. They may have changed on another device.'); } return; }
        saved.current.name = name.trim(); saved.current.description = description.trim();
      }
      if (folderChanged) {
        const value = folderValue(folder);
        if (!value && !window.confirm('Remove the primary folder? New sessions will use this project’s own AGENTS.md. Files in the folder do not change.')) return;
        const result = await window.hermesDesktop.setProjectFolder(id, value || null);
        if (!result.ok) { if (alive.current) setError(projectId ? folderError(result.reason) : `The project was created. ${folderError(result.reason)}`); return; }
        saved.current.folder = value;
        if (alive.current) setFolder(value);
      }
      if (agentsChanged) {
        const result = await window.hermesDesktop.saveProjectAgents(id, agents, saved.current.etag);
        if (!result.ok) {
          if (!alive.current) return;
          setTab('agents');
          if (result.reason === 'conflict') { setAgentsConflict(true); setError('AGENTS.md was changed on another device. Your text is still here. Copy it, then close and reopen this project to see the latest version.'); }
          else setError(projectId ? 'AGENTS.md could not be saved. Your text is still here. Try Save again.' : 'The project was created, but AGENTS.md could not be saved. Your text is still here. Try Save again.');
          return;
        }
        saved.current.agents = agents; saved.current.etag = result.etag;
      }
      if (alive.current) close();
    } finally { working.current = false; if (alive.current) setBusy(false); }
  };

  const title = editing && channelId ? 'Project settings' : 'New project';
  const showAgents = filesSupported && workspaceReady;
  const activeTab: EditorTab = showAgents ? tab : 'context';
  const contextChanged = description.trim() !== saved.current.description;
  const tabs: { id: EditorTab; label: string; changed: boolean }[] = [
    { id: 'context', label: 'Context', changed: contextChanged },
    ...(showAgents ? [{ id: 'agents' as const, label: 'AGENTS.md', changed: agentsChanged }] : []),
  ];
  const moveTab = (event: KeyboardEvent<HTMLDivElement>) => {
    const { key } = event;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
    const index = tabs.findIndex(item => item.id === activeTab);
    const next = tabs[(index + (key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].id;
    setTab(next); event.currentTarget.querySelector<HTMLElement>(`#project-tab-${next}`)?.focus();
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={() => { if (!busy) close(); }}>
    <form className="editor-dialog project-dialog wide" role="dialog" aria-modal="true" aria-label={title} onSubmit={event => { event.preventDefault(); void submit(); }} onMouseDown={event => event.stopPropagation()}>
      <h2>{title}</h2>
      <div className="project-dialog-body">
        <div className="project-dialog-fields">
          {!channelId && <label>Connection<select autoFocus aria-label="Project connection" required value={connectionKey} disabled={busy || creationFailed || editing} onChange={event => { setConnectionKey(event.target.value); setError(''); }}>
            <option value="" disabled>Choose a connection</option>
            {connectionKey && !selected && <option value={connectionKey} disabled>Selected connection unavailable</option>}
            {connections.map(row => <option key={row.id} value={row.connectionKey} disabled={row.state !== 'online'}>{row.name} — {row.server}{row.state !== 'online' ? ' (unavailable)' : ''}</option>)}
          </select></label>}
          {!channelId && connectionKey && !online && <p role="alert">The selected connection is unavailable. This form will not use another connection.</p>}
          {!channelId && !connections.length && <p role="status">Add a connection in Settings before creating a project.</p>}
          {details === 'failed' && <p role="alert">Project details could not be loaded. Close this form and open it again.</p>}
          <label>Title<input aria-label="Project title" autoFocus={!!channelId} required maxLength={120} value={name} disabled={locked} onChange={event => setName(event.target.value)} /></label>
          {folderSupported && <label>Primary folder<span className="field-hint">A folder inside /opt/projects on the server. New sessions read AGENTS.md from this folder. Leave empty to use this project’s own AGENTS.md.</span><input aria-label="Project primary folder" placeholder="/opt/projects/…" spellCheck={false} autoCapitalize="off" autoCorrect="off" maxLength={4096} value={folder} disabled={locked || agentsChanged} onChange={event => setFolder(event.target.value)} /></label>}
          {folderSupported && agentsChanged && <p className="field-hint">Save your AGENTS.md changes before changing the primary folder.</p>}
          {channelId && workspace === 'loading' && <p className="field-hint" role="status">Loading AGENTS.md…</p>}
          {channelId && workspace === 'failed' && <p role="alert">AGENTS.md could not be loaded. Close this form and open it again.</p>}
          {error && <p role="alert">{error}</p>}
        </div>
        <div className="project-dialog-editor">
          <div className="project-editor-tabs" role="tablist" aria-label="Project text" onKeyDown={moveTab}>
            {tabs.map(item => <button key={item.id} type="button" role="tab" id={`project-tab-${item.id}`} aria-controls={`project-panel-${item.id}`} aria-selected={activeTab === item.id} tabIndex={activeTab === item.id ? 0 : -1} onClick={() => setTab(item.id)}>
              {item.label}{item.changed && <span className="project-tab-changed" title="Unsaved changes" aria-label="unsaved changes">•</span>}</button>)}
          </div>
          <div className="project-editor-panel" role="tabpanel" id="project-panel-context" aria-labelledby="project-tab-context" hidden={activeTab !== 'context'}>
            <p className="field-hint project-editor-hint"><span>Shared background for every new session in this project.</span><span className="project-editor-count">{description.length} / {CONTEXT_LIMIT}</span></p>
            <textarea className="project-editor-text" aria-label="Project context" maxLength={CONTEXT_LIMIT} value={description} disabled={locked} onChange={event => setDescription(event.target.value)} />
          </div>
          {showAgents && <div className="project-editor-panel" role="tabpanel" id="project-panel-agents" aria-labelledby="project-tab-agents" hidden={activeTab !== 'agents'}>
            <p className="field-hint project-editor-hint"><span>Working rules for new sessions in this project. Existing sessions keep their rules.</span></p>
            <textarea className="project-editor-text" aria-label="Project AGENTS.md" spellCheck={false} value={agents} disabled={locked || folderChanged} onChange={event => setAgents(event.target.value)} />
            {folderChanged && <p className="field-hint">Save the primary folder first. Then reopen this project to edit the AGENTS.md from that folder.</p>}
          </div>}
        </div>
      </div>
      <div className="dialog-actions">
        {channelId && project && archiveSupported && <button type="button" className="secondary danger" disabled={busy || details !== 'ready'} onClick={() => { if (window.confirm(`Archive “${project.name}”? The project and its sessions will no longer be shown.`)) void window.hermesDesktop.archiveChannel(channelId).then(close, () => { if (alive.current) setError('The project could not be archived. Check the connection and try again.'); }); }}>Archive project</button>}
        {channelId && project && removalKnown && !archiveSupported && <button type="button" className="secondary danger" disabled={busy || details !== 'ready'} onClick={() => { if (window.confirm(`Delete “${project.name}”? This cannot be undone.`)) void window.hermesDesktop.deleteChannel(channelId).then(close, () => {}); }}>Delete project</button>}
        <button type="button" className="secondary" disabled={busy} onClick={close}>{editing && !channelId ? 'Close' : 'Cancel'}</button>
        <button type="submit" disabled={!canSave}>{busy ? 'Saving…' : editing ? 'Save' : 'Create project'}</button>
      </div>
    </form>
  </div>;
}
