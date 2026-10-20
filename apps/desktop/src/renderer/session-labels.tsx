import { useEffect, useRef, useState } from 'react';
import { labelCandidates, validateLabels } from '../../../../packages/client/src/sessionLabels';
import type { DesktopSnapshot, DesktopThread } from '../shared/desktop-api';

export function LabelsEditor({ thread, snapshot, close }: { thread: DesktopThread; snapshot: DesktopSnapshot; close: () => void }) {
  const [draft, setDraft] = useState(() => [...(thread.markers ?? [])]);
  const [entry, setEntry] = useState(''), [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const working = useRef(false), dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const online = snapshot.connectionState === 'online';
  const availableThreads = snapshot.threads.filter(row => snapshot.channels.some(channel => channel.id === row.channelId));
  const available = availableThreads.some(row => row.id === thread.id && row.channelId === thread.channelId);
  const enabled = online && available && snapshot.supportsSessionLabels === true && !busy;
  useEffect(() => { alive.current = true; dialog.current?.showModal(); input.current?.focus(); return () => { alive.current = false; }; }, []);
  const add = (label = entry) => {
    if (!enabled) return;
    try {
      const next = [...draft]; if (editing === null) next.push(label); else next[editing] = label;
      setDraft(validateLabels(next)); setEditing(null); setEntry(''); setError(''); input.current?.focus();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Check this label.'); }
  };
  const save = async () => {
    if (working.current || !enabled) return;
    if (entry || editing !== null) { setError('Add or update the label before saving.'); input.current?.focus(); return; }
    working.current = true; setBusy(true); setError('');
    try {
      const saved = await window.hermesDesktop.saveThreadLabels(thread.id, validateLabels(draft), Date.now(), snapshot.connectionKey ?? '');
      if (!alive.current) return;
      if (JSON.stringify(saved.markers) !== JSON.stringify(draft)) setError('Labels changed on another device. Your draft is still here. Try saving again.');
      else close();
    } catch { if (alive.current) setError('Could not confirm the save. Your draft is still here. Try again when connected.'); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  };
  const candidates = labelCandidates(availableThreads).filter(label => !draft.includes(label) && label.toLocaleLowerCase().includes(entry.toLocaleLowerCase()));
  return <dialog ref={dialog} className="editor-dialog labels-editor" aria-labelledby="labels-editor-title" onCancel={event => { event.preventDefault(); if (!working.current) close(); }}>
    <h2 id="labels-editor-title">Edit labels</h2><p className="labels-editor-session">{thread.title}</p>
    <p className="labels-help">Up to 10 labels, 30 characters each.</p>
    {!online && <p role="status">Connect to edit labels. Your draft is still here.</p>}
    {!available && <p role="alert">This session is unavailable. Your draft is still here.</p>}
    <ul className="labels-draft">{draft.map((label, i) => <li key={i}><span title={label}>{label}</span><button type="button" disabled={!enabled} aria-label={`Edit label ${label}`} onClick={() => { setEditing(i); setEntry(label); setError(''); input.current?.focus(); }}>Edit</button><button type="button" disabled={!enabled} aria-label={`Remove label ${label}`} onClick={() => { setDraft(draft.filter((_, n) => n !== i)); setEditing(null); setEntry(''); setError(''); }}>Remove</button></li>)}</ul>
    <div className="labels-entry"><input ref={input} autoFocus aria-label="Label text" placeholder="Add a label" value={entry} disabled={!enabled} onChange={event => setEntry(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} /><button type="button" disabled={!enabled} onClick={() => add()}>{editing === null ? 'Add' : 'Update'}</button>{editing !== null && <button type="button" disabled={!enabled} onClick={() => { setEditing(null); setEntry(''); }}>Cancel edit</button>}</div>
    {candidates.length > 0 && <div className="labels-reuse" aria-label="Reuse an existing label">{candidates.map(label => <button key={label} type="button" disabled={!enabled} title={label} onClick={() => add(label)}>{label}</button>)}</div>}
    {error && <p role="alert">{error}</p>}
    <div className="dialog-actions"><button type="button" className="secondary" disabled={!enabled || !draft.length} onClick={() => { setDraft([]); setEntry(''); setEditing(null); setError(''); }}>Clear labels</button><button type="button" className="secondary" disabled={busy} onClick={close}>Cancel</button><button type="button" disabled={!enabled} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button></div>
  </dialog>;
}
