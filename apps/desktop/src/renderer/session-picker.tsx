import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { DesktopSnapshot } from '../shared/desktop-api';
import { addQueryLabel, emptySessionQuery, sessionLabelSuggestions } from '../../../../packages/client/src/sessionSearch';
import { searchSessions, SessionQueryInput } from './session-search';

/**
 * Cmd+K. The same search as the sidebar box: a keyword (title or label text)
 * plus exact labels, all required. Matching labels are offered first; choosing
 * one adds it to the search instead of opening a session.
 */
export function SessionPicker({ snapshot, close }: { snapshot: DesktopSnapshot; close: () => void }) {
  const [query, setQuery] = useState(emptySessionQuery), [selected, setSelected] = useState(0);
  const listId = useId(), list = useRef<HTMLDivElement>(null);
  const labels = useMemo(() => snapshot.supportsSessionLabels === true ? sessionLabelSuggestions(snapshot.threads, query) : [], [snapshot.threads, query, snapshot.supportsSessionLabels]);
  const rows = useMemo(() => searchSessions(snapshot, snapshot.threads, query).slice(0, 24), [snapshot.threads, snapshot.channels, query]);
  const options = [...labels.map(label => ({ kind: 'label' as const, label })), ...rows.map(thread => ({ kind: 'session' as const, thread }))];
  const index = Math.min(selected, Math.max(0, options.length - 1));
  useEffect(() => { list.current?.children[index]?.scrollIntoView?.({ block: 'nearest' }); }, [index, options.length]);
  const open = (id: string) => { void window.hermesDesktop.selectThread(id).then(close).catch(() => {}); };
  const choose = (option: (typeof options)[number] | undefined) => {
    if (!option) return;
    if (option.kind === 'label') { setQuery(old => ({ ...addQueryLabel(old, option.label), text: '' })); setSelected(0); }
    else open(option.thread.id);
  };
  const name = (channelId: string) => snapshot.channels.find(c => c.id === channelId)?.name;
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}>
    <section className="editor-dialog palette" role="dialog" aria-modal="true" aria-label="Find a session" onMouseDown={event => event.stopPropagation()}>
      <SessionQueryInput query={query} onChange={next => { setQuery(next); setSelected(0); }} className="palette-query" inputProps={{
        autoFocus: true, role: 'combobox', 'aria-label': 'Find a session', placeholder: 'Find a session or label…', 'aria-expanded': true,
        'aria-controls': listId, 'aria-autocomplete': 'list', 'aria-activedescendant': options.length ? `${listId}-${index}` : undefined,
        onKeyDown: event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); event.stopPropagation();
            setSelected(options.length ? Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))) : 0);
          } else if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); choose(options[index]); }
          else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        } }} />
      <div className="palette-results" id={listId} ref={list} role="listbox" aria-label="Sessions">
        {options.map((option, i) => <button id={`${listId}-${i}`} key={option.kind === 'label' ? `label:${option.label}` : option.thread.id} type="button" role="option" tabIndex={-1}
          className={option.kind === 'label' ? 'palette-label-option' : undefined}
          aria-selected={i === index} onMouseMove={() => setSelected(i)} onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}>
          {option.kind === 'label'
            ? <><span className="palette-option-kind">Label</span><span className="label-pill">{option.label}</span></>
            : <>{option.thread.title}<small>{[name(option.thread.channelId), ...(option.thread.markers ?? [])].filter(Boolean).join(' · ')}</small></>}
        </button>)}
      </div>
      {!options.length && <p role="status">No sessions found.</p>}
    </section>
  </div>;
}
