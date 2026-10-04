import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { emptyLabelFilter, labelCandidates, labelFilterActive, labelPillLayout, validateLabels, type LabelFilter } from '../../../../packages/client/src/sessionLabels';
import type { DesktopSnapshot, DesktopThread } from '../shared/desktop-api';

export function LabelPills({ markers = [] }: { markers?: readonly string[] }) {
  const root = useRef<HTMLSpanElement>(null);
  const [layout, setLayout] = useState({ widths: [] as number[], hidden: markers.length });
  const key = JSON.stringify(markers);
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    let active = true;
    const measure = () => {
      if (!active) return;
      const widths = [...node.querySelectorAll<HTMLElement>('[data-label-measure]')].map(n => n.getBoundingClientRect().width);
      const overflow = [0, ...[...node.querySelectorAll<HTMLElement>('[data-overflow-measure]')].map(n => n.getBoundingClientRect().width)];
      const next = labelPillLayout(node.getBoundingClientRect().width, widths, overflow);
      setLayout(old => JSON.stringify(old) === JSON.stringify(next) ? old : next);
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(node);
    window.addEventListener('resize', measure);
    void document.fonts?.ready.then(measure);
    return () => { active = false; observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [key]);
  if (!markers.length) return null;
  return <span className="label-pills" ref={root} aria-label={`Labels: ${markers.join(', ')}`}>
    <span className="label-measure" aria-hidden="true">{markers.map(label => <span key={label} className="label-pill" data-label-measure>{label}</span>)}{markers.map((_, i) => <span key={i} className="label-pill" data-overflow-measure>+{i + 1}</span>)}</span>
    <span className="label-pills-visible" aria-hidden="true">{layout.widths.map((width, i) => <span key={markers[i]} className="label-pill" style={{ width }} title={markers[i]}>{markers[i]}</span>)}{layout.hidden > 0 && <span className="label-pill label-overflow" title={markers.slice(layout.widths.length).join(', ')}>+{layout.hidden}</span>}</span>
  </span>;
}

export function LabelsFilter({ rows, value, onChange, onNewChat }: { rows: readonly DesktopThread[]; value: LabelFilter; onChange: (filter: LabelFilter) => void; onNewChat?: () => void }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false), [allChips, setAllChips] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); root.current?.querySelector<HTMLButtonElement>('[aria-label="Filter sessions"]')?.focus(); } };
    document.addEventListener('mousedown', dismiss); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', key); };
  }, [open]);
  const candidates = labelCandidates(rows).filter(label => label.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const clear = () => { onChange(emptyLabelFilter()); setSearch(''); setAllChips(false); };
  const shown = allChips ? value.labels : value.labels.slice(0, 2);
  return <div className="labels-filter" ref={root}>
    <div className="sidebar-new-chat-row">{onNewChat && <button type="button" className="sidebar-new-chat" onClick={onNewChat}>✎ New chat</button>}<button type="button" className="sidebar-filter-icon" aria-label="Filter sessions" title="Filter sessions" aria-expanded={open} aria-pressed={labelFilterActive(value)} onClick={() => setOpen(old => !old)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg></button></div>
    {labelFilterActive(value) && <div className="sidebar-filter-chips">{shown.map(label => <span className="sidebar-filter-chip" key={label}><button type="button" title={label} onClick={() => setOpen(true)}>{label}</button><button type="button" aria-label={`Remove filter label ${label}`} onClick={() => onChange({ ...value, labels: value.labels.filter(item => item !== label) })}>×</button></span>)}{!allChips && value.labels.length > shown.length && <button type="button" onClick={() => setAllChips(true)}>+{value.labels.length - shown.length}</button>}{value.noLabels && <span className="sidebar-filter-chip">No labels<button type="button" aria-label="Remove no-label filter" onClick={() => onChange({ ...value, noLabels: false })}>×</button></span>}<button type="button" aria-label="Add label filter" onClick={() => setOpen(true)}>＋</button><button type="button" className="text-button" onClick={clear}>Clear</button></div>}
    {open && <div className="labels-filter-popover" role="group" aria-label="Filter sessions by labels">
      <input autoFocus aria-label="Search labels" placeholder="Search labels" value={search} onChange={event => setSearch(event.target.value)} />
      <label><input type="checkbox" checked={value.noLabels} onChange={event => onChange({ ...value, noLabels: event.target.checked })} />No labels</label>
      <div className="labels-filter-candidates">{candidates.map(label => <label key={label} title={label}><input type="checkbox" aria-label={`Label: ${label}`} checked={value.labels.includes(label)} onChange={event => onChange({ ...value, labels: event.target.checked ? [...value.labels, label] : value.labels.filter(s => s !== label) })} /><span>{label}</span></label>)}</div>
      {!candidates.length && <p>No matching labels</p>}
      <button type="button" className="text-button" disabled={!labelFilterActive(value)} onClick={clear}>Clear filters</button>
    </div>}
  </div>;
}

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
