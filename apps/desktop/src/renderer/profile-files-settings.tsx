import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ProfileFile, ProfileFileKind } from '@hermes-app/client';
import { PROFILE_FILE_MAX_CHARS, memoryUsed } from '../../../../packages/client/src/profileFiles';

export const PROFILE_FILE_ABOUT: Record<ProfileFileKind, string> = {
  soul: 'How Hermes speaks and acts.',
  user: 'What Hermes knows about you.',
  memory: 'Notes that Hermes keeps for itself.',
};
const count = (value: number) => value.toLocaleString('en-US');

/** Status line of one file: its size against the limit, or why Hermes does not use it. */
export function profileFileStatus(file: ProfileFile, text: string): string {
  if (file.kind === 'soul') return file.exists || text ? `${count(text.length)} characters` : 'Not created yet';
  const used = memoryUsed(text);
  const parts = [file.limit ? `${count(used)} of ${count(file.limit)} characters` : `${count(used)} characters`];
  if (file.enabled === false) parts.push('Turned off on this Hermes');
  return parts.join(' · ');
}

/**
 * SOUL.md, USER.md and MEMORY.md of one connection's Hermes profile (docs/profile-files.md).
 * A save sends the version that the user edited, so a change by the agent or another device
 * is never overwritten.
 */
export function ProfileFilesSettings({ connectionKey }: { connectionKey?: string }) {
  const [files, setFiles] = useState<readonly ProfileFile[] | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<ProfileFileKind, string>>>({});
  const [open, setOpen] = useState<ProfileFileKind>('soul');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const load = useCallback(async () => {
    if (!connectionKey) return;
    setError(''); setConflict(false);
    try { const result = await window.hermesDesktop.getProfileFiles(connectionKey); if (alive.current) setFiles(result); }
    catch (failure) { if (alive.current) setError(failure instanceof Error && /not available/.test(failure.message) ? failure.message : 'Could not load these files. Check the connection and try again.'); }
  }, [connectionKey]);
  useEffect(() => { alive.current = true; setFiles(null); void load(); return () => { alive.current = false; }; }, [load]);
  if (!connectionKey) return <p className="settings-description">Available after pairing.</p>;

  const replace = (file: ProfileFile) => setFiles(rows => rows?.map(row => row.kind === file.kind ? file : row) ?? rows);
  const drop = (kind: ProfileFileKind) => setDrafts(({ [kind]: _, ...rest }) => rest);
  const save = async (file: ProfileFile, text: string) => {
    if (busy) return;
    setBusy(true); setError(''); setConflict(false); setNotice('');
    try {
      const saved = await window.hermesDesktop.saveProfileFile(connectionKey, file.kind, text, file.version, file.limit);
      if (!alive.current) return;
      replace(saved); drop(file.kind);
      setNotice(`${file.name} saved. Hermes uses it in new conversations.`);
    } catch (failure) {
      if (!alive.current) return;
      const message = failure instanceof Error ? failure.message : `Could not save ${file.name}. Check the connection and try again.`;
      setError(message); setConflict(/changed on Hermes/.test(message));
    } finally { if (alive.current) setBusy(false); }
  };
  const latest = async (kind: ProfileFileKind) => { drop(kind); setNotice(''); await load(); };

  const current = files?.find(file => file.kind === open) ?? files?.[0] ?? null;
  const unsaved = (file: ProfileFile) => drafts[file.kind] !== undefined && drafts[file.kind] !== file.content;
  const select = (kind: ProfileFileKind) => { setOpen(kind); setNotice(''); setError(''); setConflict(false); };
  const moveTab = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!files || !current || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    const index = files.findIndex(file => file.kind === current.kind);
    const next = files[(index + (event.key === 'ArrowRight' ? 1 : files.length - 1)) % files.length];
    select(next.kind); event.currentTarget.querySelector<HTMLElement>(`[data-file="${next.kind}"]`)?.focus();
  };
  const editor = (file: ProfileFile) => {
    const draft = drafts[file.kind];
    const text = draft ?? file.content;
    const changed = unsaved(file);
    const over = file.kind !== 'soul' && !!file.limit && memoryUsed(text) > file.limit && memoryUsed(text) > memoryUsed(file.content);
    return <form className="profile-file-editor" role="tabpanel" aria-label={file.name} onSubmit={event => { event.preventDefault(); void save(file, text); }}>
      <p className="settings-description profile-file-status"><span>{PROFILE_FILE_ABOUT[file.kind]}{file.kind !== 'soul' ? ' Put § on its own line between two entries.' : ''}</span>
        <span className="profile-file-count">{profileFileStatus(file, text)}</span></p>
      <textarea className="settings-mcp-editor profile-file-text" aria-label={file.name} spellCheck={file.kind !== 'soul'}
        maxLength={PROFILE_FILE_MAX_CHARS} value={text} disabled={busy}
        placeholder={file.kind === 'soul' ? 'Describe how Hermes should speak and act.' : 'One fact per entry. Put § on its own line between entries.'}
        onChange={event => { const value = event.target.value; setDrafts(rows => ({ ...rows, [file.kind]: value })); setNotice(''); }}
        onKeyDown={event => { if (event.key === 's' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); if (changed && !over) void save(file, text); } }} />
      {over && <p role="alert">{file.name} can hold {count(file.limit ?? 0)} characters. Make the text shorter.</p>}
      <div className="settings-actions">
        <button type="submit" disabled={busy || !changed || over}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="secondary" disabled={busy || !changed} onClick={() => { drop(file.kind); setError(''); setConflict(false); }}>Discard changes</button>
        {conflict && <button type="button" className="secondary" disabled={busy} onClick={() => void latest(file.kind)}>Load latest version</button>}
      </div>
    </form>;
  };

  return <div className="vault-settings profile-files-settings">
    <p className="settings-description">Applies to this Hermes on every device. Hermes reads these files when a conversation starts, so changes apply to new conversations.</p>
    {files === null && !error && <p role="status" className="settings-description">Loading…</p>}
    {files !== null && current && <>
      <div className="settings-connection-tabs profile-file-tabs" role="tablist" aria-label="Files" onKeyDown={moveTab}>
        {files.map(file => <button key={file.kind} type="button" role="tab" data-file={file.kind} aria-selected={file.kind === current.kind}
          tabIndex={file.kind === current.kind ? 0 : -1} onClick={() => select(file.kind)}>
          {file.name}{unsaved(file) && <span className="project-tab-changed" title="Unsaved changes" aria-label="unsaved changes">•</span>}</button>)}
      </div>
      {editor(current)}
    </>}
    {notice && <p role="status" className="settings-description">{notice}</p>}
    {error && <><p role="alert">{error}</p>{files === null && <button type="button" className="secondary" onClick={() => void load()}>Reload</button>}</>}
  </div>;
}
