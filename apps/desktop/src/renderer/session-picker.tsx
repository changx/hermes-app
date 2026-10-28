import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { DesktopFileHit, DesktopMessageHit, DesktopSnapshot } from '../shared/desktop-api';
import { addQueryLabel, emptySessionQuery, sessionLabelSuggestions, sessionQueryActive, type SessionQuery } from '../../../../packages/client/src/sessionSearch';
import { searchSessions, SessionQueryInput } from './session-search';

export type SearchScope = 'all' | 'files';
type Option = { kind: 'label'; label: string } | { kind: 'session'; thread: DesktopSnapshot['threads'][number] } | { kind: 'message'; hit: DesktopMessageHit } | { kind: 'file'; file: DesktopFileHit };
/** `ranking`: the AI order is on its way. `refined`: rows are in the AI order; `none`: the AI found no fit. */
type Messages = { state: 'idle' | 'loading' | 'ready' | 'failed'; items: readonly DesktopMessageHit[]; ranking: boolean; refined: boolean; none: boolean; indexing: boolean; failed: readonly string[] };
const NO_MESSAGES: Messages = { state: 'idle', items: [], ranking: false, refined: false, none: false, indexing: false, failed: [] };
// The AI order costs a model call: ask for it only after the typing has paused.
const REFINE_DELAY_MS = 500;
const optionKey = (option: Option): string => option.kind === 'label' ? `label:${option.label}` : option.kind === 'session' ? option.thread.id
  : option.kind === 'message' ? `message:${option.hit.threadId}` : `file:${option.file.threadId}:${option.file.id}`;
type Files = { state: 'idle' | 'loading' | 'ready' | 'failed'; items: readonly DesktopFileHit[]; cursors: Readonly<Record<string, string>>; failed: readonly string[] };
const NO_FILES: Files = { state: 'idle', items: [], cursors: {}, failed: [] };
const FILE_DELAY_MS = 200;

const fileSize = (bytes: number): string => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const fileDate = (seconds: number): string => new Date(seconds * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/**
 * The one search (Cmd+K; Shift+Cmd+F starts with files only). A keyword plus exact labels, all
 * required. Results: matching labels (choosing one adds it to the search), Sessions from the
 * directory by title, Sessions whose messages match (keywords and meaning at once, then the AI
 * order a few seconds later), then files that the Agent delivered or the user sent, from every server that
 * searches files. Typing highlights no row: Enter in the input starts the search at once (no
 * typing pause, no wait for the AI order). Up/Down highlight a row; then Enter opens it (a
 * message row opens its Session at the best message; a file opens its Session at the message
 * with the file; Cmd+Enter opens the file itself; Option+Enter saves it). Up from the first row
 * returns to the input.
 */
export function SessionPicker({ snapshot, close, initialQuery, initialScope = 'all' }: { snapshot: DesktopSnapshot; close: () => void; initialQuery?: SessionQuery; initialScope?: SearchScope }) {
  const [query, setQuery] = useState<SessionQuery>(() => initialQuery ?? emptySessionQuery()), [selected, setSelected] = useState(-1);
  const [scope, setScope] = useState<SearchScope>(initialScope), [files, setFiles] = useState<Files>(NO_FILES), [error, setError] = useState('');
  const [messages, setMessages] = useState<Messages>(NO_MESSAGES), pinned = useRef<string | null>(null);
  const listId = useId(), list = useRef<HTMLDivElement>(null), request = useRef(0), messageRequest = useRef(0);
  // Searches that wait for a typing pause; Enter runs them now. `eager`: the message search whose AI order runs without a pause.
  const pending = useRef(new Map<string, () => void>()), eager = useRef(-1);
  const later = (key: string, ms: number, run: () => void) => {
    const timer = setTimeout(() => { pending.current.delete(key); run(); }, ms);
    const now = () => { clearTimeout(timer); pending.current.delete(key); run(); };
    pending.current.set(key, now);
    return () => { clearTimeout(timer); if (pending.current.get(key) === now) pending.current.delete(key); };
  };
  const searchNow = () => { eager.current = messageRequest.current; [...pending.current.values()].forEach(run => run()); };
  const active = sessionQueryActive(query), fileSearch = snapshot.supportsFileSearch === true, messageSearch = snapshot.supportsSessionSearch === true;
  const labels = useMemo(() => snapshot.supportsSessionLabels === true ? sessionLabelSuggestions(snapshot.threads, query) : [], [snapshot.threads, query, snapshot.supportsSessionLabels]);
  const sessions = useMemo(() => scope === 'files' ? [] : searchSessions(snapshot, snapshot.threads, query).slice(0, 24), [snapshot.threads, snapshot.channels, query, scope]);
  useEffect(() => {
    const id = ++request.current;
    if (!fileSearch || !active) { setFiles(NO_FILES); return; }
    setFiles(old => ({ ...old, state: 'loading' }));
    return later('files', FILE_DELAY_MS, () => {
      void window.hermesDesktop.searchFiles(query.text, query.labels).then(result => {
        if (id === request.current) setFiles({ state: 'ready', items: result.items, cursors: result.cursors, failed: result.failed });
      }, () => { if (id === request.current) setFiles({ ...NO_FILES, state: 'failed' }); });
    });
  }, [query, fileSearch, active]);
  useEffect(() => {
    const id = ++messageRequest.current, text = query.text.trim();
    if (!messageSearch || scope === 'files' || !text) { setMessages(NO_MESSAGES); return; }
    setMessages(old => ({ ...old, state: 'loading', ranking: false }));
    let cancelRefine = () => {};
    const cancel = later('messages', FILE_DELAY_MS, () => {
      void window.hermesDesktop.searchMessages(text, query.labels).then(result => {
        if (id !== messageRequest.current) return;
        const ranking = result.items.length > 0;
        setMessages({ state: 'ready', items: result.items, ranking, refined: false, none: false, indexing: result.indexing, failed: result.failed });
        if (!ranking) return;
        cancelRefine = later('refine', id === eager.current ? 0 : REFINE_DELAY_MS, () => {
          void window.hermesDesktop.searchMessages(text, query.labels, true).then(ai => {
            if (id !== messageRequest.current) return;
            // A server without AI ranking returns its first order again; keep the rows the user sees.
            setMessages(old => ai.refined ? { ...old, items: ai.items, ranking: false, refined: true, none: ai.none } : { ...old, ranking: false });
          }, () => { if (id === messageRequest.current) setMessages(old => ({ ...old, ranking: false })); });
        });
      }, () => { if (id === messageRequest.current) setMessages({ ...NO_MESSAGES, state: 'failed' }); });
    });
    return () => { cancel(); cancelRefine(); };
  }, [query, messageSearch, scope]);
  const more = () => {
    const id = request.current;
    void window.hermesDesktop.searchFiles(query.text, query.labels, files.cursors).then(result => {
      if (id === request.current) setFiles(old => ({ state: 'ready', items: [...old.items, ...result.items.filter(item => !old.items.some(row => row.id === item.id && row.threadId === item.threadId))], cursors: result.cursors, failed: result.failed }));
    }, () => { if (id === request.current) setError('More files could not be loaded. Try again.'); });
  };
  // A Session listed by title is not listed again under Messages.
  const byTitle = new Set(sessions.map(thread => thread.id));
  const found = messages.items.filter(hit => !byTitle.has(hit.threadId)).slice(0, 20);
  const options: Option[] = [...labels.map(label => ({ kind: 'label' as const, label })), ...sessions.map(thread => ({ kind: 'session' as const, thread })),
    ...found.map(hit => ({ kind: 'message' as const, hit })), ...files.items.map(file => ({ kind: 'file' as const, file }))];
  // No row is highlighted until Up/Down choose one (index -1: the input). The highlight stays on
  // the same row when the AI order or other results arrive later.
  const pinnedIndex = pinned.current === null ? -1 : options.findIndex(option => optionKey(option) === pinned.current);
  const index = selected < 0 ? -1 : pinnedIndex >= 0 ? pinnedIndex : Math.min(selected, options.length - 1);
  const select = (i: number) => { setSelected(i); pinned.current = options[i] ? optionKey(options[i]) : null; };
  useEffect(() => { if (index >= 0) list.current?.querySelector(`#${CSS.escape(`${listId}-${index}`)}`)?.scrollIntoView?.({ block: 'nearest' }); }, [index, options.length, listId]);
  const fail = (text: string) => () => setError(text);
  const choose = (option: Option | undefined, keys: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean } = {}) => {
    if (!option) return;
    setError('');
    if (option.kind === 'label') { setQuery(old => ({ ...addQueryLabel(old, option.label), text: '' })); setSelected(-1); pinned.current = null; }
    else if (option.kind === 'message') void (option.hit.refSeq !== undefined ? window.hermesDesktop.openMessage(option.hit.threadId, option.hit.refSeq)
      : window.hermesDesktop.selectThread(option.hit.threadId)).then(close, fail('The session could not be opened.'));
    else if (option.kind === 'session') void window.hermesDesktop.selectThread(option.thread.id).then(close, fail('The session could not be opened.'));
    // A file opens its Session at the message that carried it. Cmd+Enter opens the file itself; Option+Enter saves it.
    else if (keys.altKey || keys.metaKey || keys.ctrlKey) void window.hermesDesktop.openSessionFile(option.file.threadId, option.file.id, keys.altKey ? 'save' : 'open').then(() => { if (!keys.altKey) close(); }, fail(keys.altKey ? 'The file could not be saved.' : 'The file could not be opened.'));
    else if (option.file.refSeq !== undefined) void window.hermesDesktop.openMessage(option.file.threadId, option.file.refSeq).then(close, fail('The session could not be opened.'));
    else void window.hermesDesktop.selectThread(option.file.threadId).then(close, fail('The session could not be opened.'));
  };
  const name = (channelId: string) => snapshot.channels.find(c => c.id === channelId)?.name;
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); event.stopPropagation();
      select(options.length ? Math.max(-1, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))) : -1);
    } else if (event.key === 'Enter') {
      // Enter after typing searches; only a row chosen with Up/Down opens.
      event.preventDefault(); event.stopPropagation();
      if (index >= 0) choose(options[index], event); else searchNow();
    }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  };
  const row = (option: Option, i: number) => <button id={`${listId}-${i}`} key={optionKey(option)}
    type="button" role="option" tabIndex={-1} className={option.kind === 'label' ? 'palette-label-option' : option.kind === 'file' ? 'palette-file-option' : option.kind === 'message' ? 'palette-message-option' : undefined}
    aria-selected={i === index} disabled={option.kind === 'file' && option.file.state !== 'available'} onMouseDown={event => event.preventDefault()}
    onClick={(event: MouseEvent<HTMLButtonElement>) => choose(option, event)}>
    {option.kind === 'label' ? <><span className="palette-option-kind">Label</span><span className="label-pill">{option.label}</span></>
      : option.kind === 'session' ? <>{option.thread.title}<small>{[name(option.thread.channelId), ...(option.thread.markers ?? [])].filter(Boolean).join(' · ')}</small></>
      : option.kind === 'message' ? <>{option.hit.title}{option.hit.snippet && <span className="palette-snippet">{option.hit.snippet}</span>}
          <small>{[option.hit.channelName, option.hit.connectionName, ...option.hit.markers].filter(Boolean).join(' · ')}</small></>
      : <><span className="palette-file-name">{option.file.name}</span><small>{[option.file.threadTitle, option.file.channelName ?? name(option.file.channelId), option.file.connectionName,
          option.file.list === 'delivered' ? 'From Hermes' : 'You sent', fileSize(option.file.size), fileDate(option.file.createdAt), option.file.state !== 'available' ? 'No longer available' : undefined].filter(Boolean).join(' · ')}</small></>}
  </button>;
  const firstSession = labels.length, firstMessage = firstSession + sessions.length, firstFile = firstMessage + found.length;
  const nothing = active && !options.length && files.state !== 'loading' && messages.state !== 'loading' && !messages.ranking && !messages.none;
  const messageTitle = messages.ranking ? 'Messages · AI is ranking…' : messages.refined ? 'Messages · ranked by AI' : 'Messages';
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}>
    <section className="editor-dialog palette" role="dialog" aria-modal="true" aria-label="Search" onMouseDown={event => event.stopPropagation()}>
      <SessionQueryInput query={query} onChange={next => { setQuery(next); setSelected(-1); pinned.current = null; setError(''); }} className="palette-query" inputProps={{
        autoFocus: true, role: 'combobox', 'aria-label': 'Search', placeholder: scope === 'files' ? 'Search files or labels…' : messageSearch ? 'Search sessions, messages, files or labels…' : 'Search sessions, files or labels…', 'aria-expanded': true,
        'aria-controls': listId, 'aria-autocomplete': 'list', 'aria-activedescendant': index >= 0 ? `${listId}-${index}` : undefined, onKeyDown: keyDown }} />
      {fileSearch && <div className="palette-scope" role="radiogroup" aria-label="Search in">
        {(['all', 'files'] as const).map(value => <button key={value} type="button" role="radio" aria-checked={scope === value} onMouseDown={event => event.preventDefault()}
          onClick={() => { setScope(value); setSelected(-1); pinned.current = null; }}>{value === 'all' ? 'Sessions and files' : 'Files'}</button>)}
      </div>}
      <div className="palette-results" id={listId} ref={list} role="listbox" aria-label="Search results">
        {options.slice(0, firstSession).map((option, i) => row(option, i))}
        {sessions.length > 0 && <div className="palette-section" role="presentation">Sessions</div>}
        {options.slice(firstSession, firstMessage).map((option, i) => row(option, firstSession + i))}
        {(found.length > 0 || messages.ranking) && <div className="palette-section" role="presentation">{messageTitle}</div>}
        {options.slice(firstMessage, firstFile).map((option, i) => row(option, firstMessage + i))}
        {files.items.length > 0 && <div className="palette-section" role="presentation">Files</div>}
        {options.slice(firstFile).map((option, i) => row(option, firstFile + i))}
        {Object.keys(files.cursors).length > 0 && <button type="button" className="palette-more" tabIndex={-1} onMouseDown={event => event.preventDefault()} onClick={more}>More files</button>}
      </div>
      {messages.none && <p className="palette-note" role="status">AI found no message that answers this.</p>}
      {messages.state === 'failed' && <p className="palette-note" role="alert">Messages could not be searched. Check the connection and try again.</p>}
      {messages.failed.length > 0 && <p className="palette-note" role="status">Messages on {messages.failed.join(', ')} could not be searched.</p>}
      {messages.indexing && <p className="palette-note" role="status">Older messages are still being indexed. Some may be missing.</p>}
      {files.state === 'loading' && !files.items.length && <p className="palette-note" role="status">Searching files…</p>}
      {files.state === 'failed' && <p className="palette-note" role="alert">Files could not be searched. Check the connection and try again.</p>}
      {files.failed.length > 0 && <p className="palette-note" role="status">Files on {files.failed.join(', ')} could not be searched.</p>}
      {nothing && <p role="status">{scope === 'files' ? 'No files found.' : messageSearch ? 'No sessions, messages or files found.' : 'No sessions or files found.'}</p>}
      {!active && scope === 'files' && <p className="palette-note">Type a file name, a session title or choose a label.</p>}
      {error && <p className="palette-note" role="alert">{error}</p>}
      {files.items.length > 0 && <p className="palette-hint">↑↓ choose · Enter shows the file in its session · ⌘Enter opens the file · ⌥Enter saves it</p>}
    </section>
  </div>;
}
