import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { DesktopFileHit, DesktopSnapshot } from '../shared/desktop-api';
import { addQueryLabel, emptySessionQuery, sessionLabelSuggestions, sessionQueryActive, type SessionQuery } from '../../../../packages/client/src/sessionSearch';
import { searchSessions, SessionQueryInput } from './session-search';

export type SearchScope = 'all' | 'files';
type Option = { kind: 'label'; label: string } | { kind: 'session'; thread: DesktopSnapshot['threads'][number] } | { kind: 'file'; file: DesktopFileHit };
type Files = { state: 'idle' | 'loading' | 'ready' | 'failed'; items: readonly DesktopFileHit[]; cursors: Readonly<Record<string, string>>; failed: readonly string[] };
const NO_FILES: Files = { state: 'idle', items: [], cursors: {}, failed: [] };
const FILE_DELAY_MS = 200;

const fileSize = (bytes: number): string => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const fileDate = (seconds: number): string => new Date(seconds * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/**
 * The one search (Cmd+K; Shift+Cmd+F starts with files only). A keyword plus exact labels, all
 * required. Results: matching labels (choosing one adds it to the search), Sessions from the
 * directory, then files that the Agent delivered or the user sent, from every server that
 * searches files. Enter opens the highlighted Session or file; Cmd+Enter opens a file's
 * Session; Option+Enter saves a file.
 */
export function SessionPicker({ snapshot, close, initialQuery, initialScope = 'all' }: { snapshot: DesktopSnapshot; close: () => void; initialQuery?: SessionQuery; initialScope?: SearchScope }) {
  const [query, setQuery] = useState<SessionQuery>(() => initialQuery ?? emptySessionQuery()), [selected, setSelected] = useState(0);
  const [scope, setScope] = useState<SearchScope>(initialScope), [files, setFiles] = useState<Files>(NO_FILES), [error, setError] = useState('');
  const listId = useId(), list = useRef<HTMLDivElement>(null), request = useRef(0);
  const active = sessionQueryActive(query), fileSearch = snapshot.supportsFileSearch === true;
  const labels = useMemo(() => snapshot.supportsSessionLabels === true ? sessionLabelSuggestions(snapshot.threads, query) : [], [snapshot.threads, query, snapshot.supportsSessionLabels]);
  const sessions = useMemo(() => scope === 'files' ? [] : searchSessions(snapshot, snapshot.threads, query).slice(0, 24), [snapshot.threads, snapshot.channels, query, scope]);
  useEffect(() => {
    const id = ++request.current;
    if (!fileSearch || !active) { setFiles(NO_FILES); return; }
    setFiles(old => ({ ...old, state: 'loading' }));
    const timer = setTimeout(() => {
      void window.hermesDesktop.searchFiles(query.text, query.labels).then(result => {
        if (id === request.current) setFiles({ state: 'ready', items: result.items, cursors: result.cursors, failed: result.failed });
      }, () => { if (id === request.current) setFiles({ ...NO_FILES, state: 'failed' }); });
    }, FILE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, fileSearch, active]);
  const more = () => {
    const id = request.current;
    void window.hermesDesktop.searchFiles(query.text, query.labels, files.cursors).then(result => {
      if (id === request.current) setFiles(old => ({ state: 'ready', items: [...old.items, ...result.items.filter(item => !old.items.some(row => row.id === item.id && row.threadId === item.threadId))], cursors: result.cursors, failed: result.failed }));
    }, () => { if (id === request.current) setError('More files could not be loaded. Try again.'); });
  };
  const options: Option[] = [...labels.map(label => ({ kind: 'label' as const, label })), ...sessions.map(thread => ({ kind: 'session' as const, thread })), ...files.items.map(file => ({ kind: 'file' as const, file }))];
  const index = Math.min(selected, Math.max(0, options.length - 1));
  useEffect(() => { list.current?.querySelector(`#${CSS.escape(`${listId}-${index}`)}`)?.scrollIntoView?.({ block: 'nearest' }); }, [index, options.length, listId]);
  const fail = (text: string) => () => setError(text);
  const choose = (option: Option | undefined, keys: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean } = {}) => {
    if (!option) return;
    setError('');
    if (option.kind === 'label') { setQuery(old => ({ ...addQueryLabel(old, option.label), text: '' })); setSelected(0); }
    else if (option.kind === 'session') void window.hermesDesktop.selectThread(option.thread.id).then(close, fail('The session could not be opened.'));
    else if (keys.metaKey || keys.ctrlKey) void window.hermesDesktop.selectThread(option.file.threadId).then(close, fail('The session could not be opened.'));
    else void window.hermesDesktop.openSessionFile(option.file.threadId, option.file.id, keys.altKey ? 'save' : 'open').then(() => { if (!keys.altKey) close(); }, fail(keys.altKey ? 'The file could not be saved.' : 'The file could not be opened.'));
  };
  const name = (channelId: string) => snapshot.channels.find(c => c.id === channelId)?.name;
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); event.stopPropagation();
      setSelected(options.length ? Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))) : 0);
    } else if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); choose(options[index], event); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  };
  const row = (option: Option, i: number) => <button id={`${listId}-${i}`} key={option.kind === 'label' ? `label:${option.label}` : option.kind === 'session' ? option.thread.id : `file:${option.file.threadId}:${option.file.id}`}
    type="button" role="option" tabIndex={-1} className={option.kind === 'label' ? 'palette-label-option' : option.kind === 'file' ? 'palette-file-option' : undefined}
    aria-selected={i === index} disabled={option.kind === 'file' && option.file.state !== 'available'} onMouseMove={() => setSelected(i)} onMouseDown={event => event.preventDefault()}
    onClick={(event: MouseEvent<HTMLButtonElement>) => choose(option, event)}>
    {option.kind === 'label' ? <><span className="palette-option-kind">Label</span><span className="label-pill">{option.label}</span></>
      : option.kind === 'session' ? <>{option.thread.title}<small>{[name(option.thread.channelId), ...(option.thread.markers ?? [])].filter(Boolean).join(' · ')}</small></>
      : <><span className="palette-file-name">{option.file.name}</span><small>{[option.file.threadTitle, option.file.channelName ?? name(option.file.channelId), option.file.connectionName,
          option.file.list === 'delivered' ? 'From Hermes' : 'You sent', fileSize(option.file.size), fileDate(option.file.createdAt), option.file.state !== 'available' ? 'No longer available' : undefined].filter(Boolean).join(' · ')}</small></>}
  </button>;
  const firstSession = labels.length, firstFile = labels.length + sessions.length;
  const nothing = active && !options.length && files.state !== 'loading';
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}>
    <section className="editor-dialog palette" role="dialog" aria-modal="true" aria-label="Search" onMouseDown={event => event.stopPropagation()}>
      <SessionQueryInput query={query} onChange={next => { setQuery(next); setSelected(0); setError(''); }} className="palette-query" inputProps={{
        autoFocus: true, role: 'combobox', 'aria-label': 'Search', placeholder: scope === 'files' ? 'Search files or labels…' : 'Search sessions, files or labels…', 'aria-expanded': true,
        'aria-controls': listId, 'aria-autocomplete': 'list', 'aria-activedescendant': options.length ? `${listId}-${index}` : undefined, onKeyDown: keyDown }} />
      {fileSearch && <div className="palette-scope" role="radiogroup" aria-label="Search in">
        {(['all', 'files'] as const).map(value => <button key={value} type="button" role="radio" aria-checked={scope === value} onMouseDown={event => event.preventDefault()}
          onClick={() => { setScope(value); setSelected(0); }}>{value === 'all' ? 'Sessions and files' : 'Files'}</button>)}
      </div>}
      <div className="palette-results" id={listId} ref={list} role="listbox" aria-label="Search results">
        {options.slice(0, firstSession).map((option, i) => row(option, i))}
        {sessions.length > 0 && <div className="palette-section" role="presentation">Sessions</div>}
        {options.slice(firstSession, firstFile).map((option, i) => row(option, firstSession + i))}
        {files.items.length > 0 && <div className="palette-section" role="presentation">Files</div>}
        {options.slice(firstFile).map((option, i) => row(option, firstFile + i))}
        {Object.keys(files.cursors).length > 0 && <button type="button" className="palette-more" tabIndex={-1} onMouseDown={event => event.preventDefault()} onClick={more}>More files</button>}
      </div>
      {files.state === 'loading' && !files.items.length && <p className="palette-note" role="status">Searching files…</p>}
      {files.state === 'failed' && <p className="palette-note" role="alert">Files could not be searched. Check the connection and try again.</p>}
      {files.failed.length > 0 && <p className="palette-note" role="status">Files on {files.failed.join(', ')} could not be searched.</p>}
      {nothing && <p role="status">{scope === 'files' ? 'No files found.' : 'No sessions or files found.'}</p>}
      {!active && scope === 'files' && <p className="palette-note">Type a file name, a session title or choose a label.</p>}
      {error && <p className="palette-note" role="alert">{error}</p>}
      {files.items.length > 0 && <p className="palette-hint">Enter opens the file · ⌘Enter opens its session · ⌥Enter saves the file</p>}
    </section>
  </div>;
}
