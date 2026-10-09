import { useRef, type InputHTMLAttributes, type KeyboardEvent } from 'react';
import type { DesktopSnapshot, DesktopThread } from '../shared/desktop-api';
import { orderedThreads } from './thread-navigation';
import { removeQueryLabel, sessionQueryScore, type SessionQuery } from '../../../../packages/client/src/sessionSearch';

/** Sessions matching a query, best match first; ties keep the sidebar order (running, then newest). */
export function searchSessions(snapshot: Pick<DesktopSnapshot, 'channels'>, threads: readonly DesktopThread[], query: SessionQuery): DesktopThread[] {
  const names = new Map(snapshot.channels.map(channel => [channel.id, channel.name]));
  return orderedThreads(threads).map((thread, order) => ({ thread, order, score: sessionQueryScore(thread, query, names.get(thread.channelId) ?? '') }))
    .filter(item => Number.isFinite(item.score)).sort((a, b) => a.score - b.score || a.order - b.order).map(item => item.thread);
}

/** Decorative magnifier; the search input carries the accessible name. */
export const SearchIcon = () => <svg className="search-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></svg>;

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>;

/**
 * Selected labels as removable chips, then the keyword input. Backspace in an
 * empty input removes the last label. IME composition never triggers keys.
 */
export function SessionQueryInput({ query, onChange, className = '', inputProps = {} }: { query: SessionQuery; onChange: (query: SessionQuery) => void; className?: string; inputProps?: InputProps }) {
  const input = useRef<HTMLInputElement>(null), composing = useRef(false);
  const { onKeyDown, ...rest } = inputProps;
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) { event.stopPropagation(); return; }
    if (event.key === 'Backspace' && !query.text && query.labels.length) { event.preventDefault(); onChange(removeQueryLabel(query, query.labels[query.labels.length - 1])); return; }
    onKeyDown?.(event);
  };
  return <div className={`session-query ${className}`} onMouseDown={event => { if (event.target === event.currentTarget) { event.preventDefault(); input.current?.focus(); } }}>
    {query.labels.map(label => <span className="session-query-chip" key={label}><span title={label}>{label}</span>
      <button type="button" aria-label={`Remove label ${label} from search`} onMouseDown={event => event.preventDefault()} onClick={() => { onChange(removeQueryLabel(query, label)); input.current?.focus(); }}>×</button></span>)}
    <input ref={input} type="text" spellCheck={false} autoComplete="off" {...rest} value={query.text}
      onChange={event => onChange({ ...query, text: event.target.value })}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={keyDown} />
  </div>;
}
