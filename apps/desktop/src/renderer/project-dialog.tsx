import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { DesktopProjectFile, DesktopProjectWorkspace, DesktopSnapshot } from '../shared/desktop-api';

const MAX_FILES = 8;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Trailing slashes are not part of the folder name the server expects. */
const folderValue = (text: string): string => text.trim().replace(/\/+$/, '');
const folderError = (reason: 'invalid' | 'taken' | 'failed'): string => reason === 'invalid' ? 'This folder cannot be used. Choose an existing folder inside /opt/projects on the server.'
  : reason === 'taken' ? 'Another project already uses this folder.' : 'The primary folder change could not be confirmed. Try Save again.';

const fileSize = (bytes: number | null): string => bytes === null ? '' : bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * One modal for New project and Project options: Title, Context, Primary folder, Files and AGENTS.md.
 * AGENTS.md follows the primary folder, so a folder change and an AGENTS.md edit are never saved together.
 * Files and AGENTS.md appear only when the connection supports Project files.
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
  const [archiveSupported, setArchiveSupported] = useState(false);
  const [staged, setStaged] = useState<readonly File[]>([]);
  // Last confirmed server values. Save writes only what differs from them.
  const saved = useRef({ name: '', description: '', agents: '', folder: '', etag: null as string | null });
  const [details, setDetails] = useState<'loading' | 'ready' | 'failed'>(channelId ? 'loading' : 'ready');
  const [workspace, setWorkspace] = useState<DesktopProjectWorkspace | 'loading' | 'failed' | null>(channelId ? 'loading' : null);
  const [files, setFiles] = useState<readonly DesktopProjectFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [creationFailed, setCreationFailed] = useState(false);
  const [agentsConflict, setAgentsConflict] = useState(false);
  const [error, setError] = useState('');
  const working = useRef(false);
  const alive = useRef(true);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    if (!channelId) return;
    void window.hermesDesktop.getChannelInfo(channelId).then(value => {
      if (!alive.current) return;
      saved.current.name = value.name; saved.current.description = value.description ?? '';
      saved.current.folder = value.primaryPath ?? '';
      setName(value.name); setDescription(value.description ?? ''); setFolder(value.primaryPath ?? '');
      setFolderSupportedOnServer(value.primaryPathSupported === true); setArchiveSupported(value.archiveSupported === true); setDetails('ready');
    }, () => { if (alive.current) setDetails('failed'); });
    void window.hermesDesktop.getProjectWorkspace(channelId).then(value => {
      if (!alive.current) return;
      saved.current.agents = value.agents?.content ?? ''; saved.current.etag = value.agents?.etag ?? null;
      setAgents(value.agents?.content ?? ''); setFiles(value.files); setWorkspace(value);
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
  const folderChanged = folderSupported && folderValue(folder) !== saved.current.folder;
  const agentsChanged = filesSupported && agents !== saved.current.agents;
  const changed = name.trim() !== saved.current.name || description.trim() !== saved.current.description || folderChanged || agentsChanged || staged.length > 0;
  // After an AGENTS.md conflict, Save stays off: the user must reopen to see the other version.
  const canSave = online && !!name.trim() && !locked && !agentsConflict && (!editing || changed);

  const stage = (incoming: readonly File[]) => {
    setError('');
    const next = [...staged];
    for (const file of incoming) {
      if (file.size < 1 || file.size > MAX_FILE_BYTES) { setError(`“${file.name}” must be between 1 byte and 10 MB.`); return; }
      if (file.name === 'AGENTS.md') { setError('Edit AGENTS.md in its own field below.'); return; }
      if (file.name.startsWith('.')) { setError(`“${file.name}” cannot be added. Names cannot start with a dot.`); return; }
      if (files.some(row => row.name === file.name) || next.some(row => row.name === file.name)) { setError(`A file named “${file.name}” is already in this project.`); return; }
      next.push(file);
    }
    if (next.length > MAX_FILES) { setError(`Add up to ${MAX_FILES} files at a time.`); return; }
    setStaged(next);
  };
  const drop = (event: DragEvent) => { event.preventDefault(); if (!locked && event.dataTransfer.files.length) stage([...event.dataTransfer.files]); };

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
        catch { if (alive.current) setError('The title and context could not be saved. They may have changed on another device.'); return; }
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
          if (result.reason === 'conflict') { setAgentsConflict(true); setError('AGENTS.md was changed on another device. Your text is still here. Copy it, then close and reopen this project to see the latest version.'); }
          else setError(projectId ? 'AGENTS.md could not be saved. Your text is still here. Try Save again.' : 'The project was created, but AGENTS.md could not be saved. Your text is still here. Try Save again.');
          return;
        }
        saved.current.agents = agents; saved.current.etag = result.etag;
      }
      if (filesSupported && staged.length) {
        const result = await window.hermesDesktop.addProjectFiles(id, staged);
        if (!alive.current) return;
        const added = new Set(result.uploaded);
        setFiles(old => [...old, ...staged.filter(file => added.has(file.name)).map(file => ({ name: file.name, kind: 'file' as const, size: file.size }))]);
        setStaged(old => old.filter(file => !added.has(file.name)));
        if (result.failed) {
          const reason = result.failed.reason === 'exists' ? `A file named “${result.failed.name}” already exists in this project. Rename your file and add it again.`
            : result.failed.reason === 'invalid' ? `“${result.failed.name}” cannot be added. Check its name and size.`
            : `“${result.failed.name}” could not be added. Try Save again.`;
          setError(projectId ? reason : `The project was created. ${reason}`);
          return;
        }
      }
      if (alive.current) close();
    } finally { working.current = false; if (alive.current) setBusy(false); }
  };

  const title = editing && channelId ? 'Project settings' : 'New project';
  return <div className="modal-backdrop" role="presentation" onMouseDown={() => { if (!busy) close(); }}>
    <form className="editor-dialog project-dialog" role="dialog" aria-modal="true" aria-label={title} onSubmit={event => { event.preventDefault(); void submit(); }} onMouseDown={event => event.stopPropagation()}>
      <h2>{title}</h2>
      <div className="project-dialog-body">
        {!channelId && <label>Connection<select autoFocus aria-label="Project connection" required value={connectionKey} disabled={busy || creationFailed || editing} onChange={event => { setConnectionKey(event.target.value); setError(''); }}>
          <option value="" disabled>Choose a connection</option>
          {connectionKey && !selected && <option value={connectionKey} disabled>Selected connection unavailable</option>}
          {connections.map(row => <option key={row.id} value={row.connectionKey} disabled={row.state !== 'online'}>{row.name} — {row.server}{row.state !== 'online' ? ' (unavailable)' : ''}</option>)}
        </select></label>}
        {!channelId && connectionKey && !online && <p role="alert">The selected connection is unavailable. This form will not use another connection.</p>}
        {!channelId && !connections.length && <p role="status">Add a connection in Settings before creating a project.</p>}
        {details === 'failed' && <p role="alert">Project details could not be loaded. Close this form and open it again.</p>}
        <label>Title<input aria-label="Project title" autoFocus={!!channelId} required maxLength={120} value={name} disabled={locked} onChange={event => setName(event.target.value)} /></label>
        <label>Context<span className="field-hint">Shared background for every new session in this project.</span><textarea aria-label="Project context" maxLength={4000} value={description} disabled={locked} onChange={event => setDescription(event.target.value)} /></label>
        {folderSupported && <label>Primary folder<span className="field-hint">A folder inside /opt/projects on the server. New sessions read AGENTS.md from this folder. Leave empty to use this project’s own AGENTS.md.</span><input aria-label="Project primary folder" placeholder="/opt/projects/…" spellCheck={false} autoCapitalize="off" autoCorrect="off" maxLength={4096} value={folder} disabled={locked || agentsChanged} onChange={event => setFolder(event.target.value)} /></label>}
        {folderSupported && agentsChanged && <p className="field-hint">Save your AGENTS.md changes before changing the primary folder.</p>}
        {channelId && workspace === 'loading' && <p className="field-hint" role="status">Loading files…</p>}
        {channelId && workspace === 'failed' && <p role="alert">Files and AGENTS.md could not be loaded. Close this form and open it again.</p>}
        {filesSupported && workspaceReady && <>
          <section className="project-files" aria-label="Project files" onDragOver={event => event.preventDefault()} onDrop={drop}>
            <div className="project-section-header"><span className="project-section-title">Files</span><button type="button" className="secondary" disabled={locked} onClick={() => picker.current?.click()}>Add files</button></div>
            <span className="field-hint">Reference files for this project. Sessions read them when needed.</span>
            <input ref={picker} type="file" multiple hidden aria-hidden="true" tabIndex={-1} onChange={event => { stage([...(event.target.files ?? [])]); event.target.value = ''; }} />
            {files.length || staged.length ? <ul className="project-file-list">
              {files.map(file => <li key={`saved:${file.name}`}><span className="project-file-name">{file.kind === 'directory' ? `${file.name}/` : file.name}</span><span className="project-file-size">{fileSize(file.size)}</span></li>)}
              {staged.map(file => <li key={`new:${file.name}`} className="staged"><span className="project-file-name">{file.name}</span><span className="project-file-size">New · {fileSize(file.size)}</span><button type="button" aria-label={`Remove ${file.name}`} disabled={busy} onClick={() => setStaged(old => old.filter(row => row !== file))}>×</button></li>)}
            </ul> : <p className="project-files-empty">No files yet. Drop files here or choose Add files.</p>}
            {typeof workspace === 'object' && workspace?.moreFiles && <p className="field-hint">More files are in this project than are shown here.</p>}
          </section>
          <label>AGENTS.md<span className="field-hint">Working rules for new sessions in this project. Existing sessions keep their rules.</span><textarea className="project-agents" aria-label="Project AGENTS.md" spellCheck={false} value={agents} disabled={locked || folderChanged} onChange={event => setAgents(event.target.value)} /></label>
          {folderChanged && <p className="field-hint">Save the primary folder first. Then reopen this project to edit the AGENTS.md from that folder.</p>}
        </>}
        {error && <p role="alert">{error}</p>}
      </div>
      <div className="dialog-actions">
        {channelId && project && archiveSupported && <button type="button" className="secondary danger" disabled={busy || details !== 'ready'} onClick={() => { if (window.confirm(`Archive “${project.name}”? The project and its sessions will no longer be shown.`)) void window.hermesDesktop.archiveChannel(channelId).then(close, () => { if (alive.current) setError('The project could not be archived. Check the connection and try again.'); }); }}>Archive project</button>}
        {channelId && project && !archiveSupported && <button type="button" className="secondary danger" disabled={busy || details !== 'ready'} onClick={() => { if (window.confirm(`Delete “${project.name}”? This cannot be undone.`)) void window.hermesDesktop.deleteChannel(channelId).then(close, () => {}); }}>Delete project</button>}
        <button type="button" className="secondary" disabled={busy} onClick={close}>{editing && !channelId ? 'Close' : 'Cancel'}</button>
        <button type="submit" disabled={!canSave}>{busy ? 'Saving…' : editing ? 'Save' : 'Create project'}</button>
      </div>
    </form>
  </div>;
}
