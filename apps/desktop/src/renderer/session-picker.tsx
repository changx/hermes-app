import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { DesktopSnapshot } from '../shared/desktop-api';
import { orderedThreads } from './thread-navigation';
import { sessionSearchScore } from '../../../../packages/client/src/sessionSearch';

export function SessionPicker({ snapshot, close }: { snapshot: DesktopSnapshot; close: () => void }) {
  const [query, setQuery] = useState(''), [selected, setSelected] = useState(0);
  const listId = useId(), list = useRef<HTMLDivElement>(null), composing = useRef(false);
  const rows = useMemo(() => orderedThreads(snapshot.threads).map(thread => ({ thread,
    score: sessionSearchScore(thread, query, snapshot.channels.find(c => c.id === thread.channelId)?.name ?? '') }))
    .filter(item => Number.isFinite(item.score)).sort((a, b) => a.score - b.score).slice(0, 24).map(item => item.thread),
  [snapshot.threads, snapshot.channels, query]);
  const index = Math.min(selected, Math.max(0, rows.length - 1));
  useEffect(() => { list.current?.children[index]?.scrollIntoView?.({ block: 'nearest' }); }, [index, rows]);
  const open = (id: string) => { void window.hermesDesktop.selectThread(id).then(close).catch(() => {}); };
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}>
    <section className="editor-dialog palette" role="dialog" aria-modal="true" aria-label="Find a session" onMouseDown={event => event.stopPropagation()}>
      <input autoFocus role="combobox" aria-label="Find a session" placeholder="Find a session…" aria-expanded="true"
        aria-controls={listId} aria-autocomplete="list" aria-activedescendant={rows.length ? `${listId}-${index}` : undefined}
        value={query} onChange={event => { setQuery(event.target.value); setSelected(0); }}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) { event.stopPropagation(); return; }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); event.stopPropagation();
            setSelected(rows.length ? Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))) : 0);
          } else if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (rows[index]) open(rows[index].id); }
          else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        }} />
      <div className="palette-results" id={listId} ref={list} role="listbox" aria-label="Sessions">
        {rows.map((thread, i) => <button id={`${listId}-${i}`} key={thread.id} type="button" role="option" tabIndex={-1}
          aria-selected={i === index} onMouseMove={() => setSelected(i)} onMouseDown={event => event.preventDefault()}
          onClick={() => open(thread.id)}>{thread.title}<small>{snapshot.channels.find(c => c.id === thread.channelId)?.name}</small></button>)}
      </div>
      {!rows.length && <p role="status">No sessions found.</p>}
    </section>
  </div>;
}
