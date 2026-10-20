import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { withoutTodo } from '../../../../packages/client/src/todo';
import type { DesktopSnapshot, DesktopThread } from '../shared/desktop-api';
import { connectionHint } from './navigation-panel';
import { isSessionMenuAction, sessionMenuItems, type SessionMenuAction } from './session-menu';

const safely = (task: Promise<unknown>) => void task.catch(() => {});
const stateName: Record<DesktopSnapshot['connectionState'], string> = { online: 'Online', connecting: 'Connecting', syncing: 'Connecting', retrying: 'Reconnecting', suspended: 'Offline', blocked: 'Needs attention' };
// Todo flag: the pennant fills when the Session is flagged.
const TodoIcon = ({ on }: { on: boolean }) => <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 17V3.5" /><path className={on ? 'todo-pennant-on' : undefined} d="M5.5 4h9.5l-2.4 3.5 2.4 3.5H5.5z" /></svg>;
const MoreIcon = () => <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h.01M10 10h.01M15 10h.01" /></svg>;

/** A native menu opens at the pointer for a click and under the button for the keyboard. View coordinates. */
const menuPoint = (event: MouseEvent<HTMLElement>) => {
  if (event.detail > 0) return { x: event.clientX, y: event.clientY };
  const box = event.currentTarget.getBoundingClientRect(); return { x: box.left, y: box.bottom };
};

/**
 * Labels on one line. Labels that do not fit move into a "+N" button; its menu
 * searches for one of them. Every chip stays in the DOM so its width can be
 * measured; a chip that does not fit is taken out of the flow, hidden and inert.
 */
function StatusLabels({ markers, onSearch }: { markers: readonly string[]; onSearch: (label: string) => void }) {
  const box = useRef<HTMLDivElement>(null), more = useRef<HTMLButtonElement>(null), menuOpen = useRef(false);
  const [shown, setShown] = useState(markers.length);
  const key = markers.join('\n');
  useLayoutEffect(() => {
    const element = box.current; if (!element) return;
    const fit = () => {
      const chips = [...element.querySelectorAll<HTMLElement>('.status-label')], gap = parseFloat(getComputedStyle(element).columnGap) || 0;
      const widths = chips.map(chip => chip.offsetWidth), room = element.clientWidth;
      const total = widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, widths.length - 1);
      if (total <= room) { setShown(widths.length); return; }
      const reserve = (more.current?.offsetWidth ?? 32) + gap;
      let used = 0, count = 0;
      for (const width of widths) { const next = used + (count ? gap : 0) + width; if (next + reserve > room) break; used = next; count++; }
      setShown(count);
    };
    fit(); const observer = new ResizeObserver(fit); observer.observe(element);
    return () => observer.disconnect();
  }, [key]);
  if (!markers.length) return null;
  const hidden = markers.slice(shown);
  const openMore = (event: MouseEvent<HTMLButtonElement>) => {
    if (menuOpen.current || !hidden.length) return;
    menuOpen.current = true; const point = menuPoint(event);
    void window.hermesDesktop.showContextMenu(hidden.map((label, index) => ({ id: `label-${index}`, label: label.length > 80 ? `${label.slice(0, 79)}…` : label })), point.x, point.y)
      .then(choice => { const label = choice?.startsWith('label-') ? hidden[Number(choice.slice(6))] : undefined; if (label) onSearch(label); }, () => {})
      .finally(() => { menuOpen.current = false; });
  };
  return <div ref={box} className="status-labels" role="group" aria-label={`Labels: ${markers.join(', ')}`}>
    {markers.map((label, index) => <button key={label} type="button" className={`label-pill status-label${index >= shown ? ' status-label-hidden' : ''}`} aria-hidden={index >= shown || undefined} inert={index >= shown || undefined}
      aria-label={`Find sessions labeled ${label}`} data-tooltip="Find sessions with this label" onClick={() => onSearch(label)}>{label}</button>)}
    {/* Always rendered so its width is known; shown only when labels do not fit. */}
    <button ref={more} type="button" className={`label-pill status-label-more${hidden.length ? '' : ' status-label-hidden'}`} aria-hidden={!hidden.length || undefined} inert={!hidden.length || undefined}
      aria-haspopup="menu" aria-label={`${hidden.length} more labels`} data-tooltip={hidden.join(', ')} onClick={openMore}>+{Math.max(hidden.length, 1)}</button>
  </div>;
}

/**
 * The Session page's bottom status bar, left to right: where the Session is
 * (connection state and name, then Project), the todo flag, the More menu, and
 * the labels, which take the rest of the row.
 */
export function SessionStatusBar({ snapshot, thread, todo, todoBusy, todoTooltip, onToggleTodo, onAction }: {
  snapshot: DesktopSnapshot; thread?: DesktopThread; todo: boolean; todoBusy: boolean; todoTooltip: string;
  onToggleTodo: () => void; onAction: (action: SessionMenuAction) => void;
}) {
  const menuOpen = useRef(false);
  const channel = snapshot.channels.find(c => c.id === (thread?.channelId ?? snapshot.selectedChannelId));
  const connection = snapshot.connections?.find(row => row.connectionKey && row.connectionKey === snapshot.connectionKey);
  const connectionName = channel?.connectionName ?? connection?.name ?? snapshot.connectionName ?? 'Connection';
  const state = snapshot.connectionState, online = state === 'online', hint = connectionHint[state];
  const labels = snapshot.supportsSessionLabels === true;
  const openMenu = (event: MouseEvent<HTMLButtonElement>) => {
    if (menuOpen.current || !thread) return;
    menuOpen.current = true; const point = menuPoint(event);
    void window.hermesDesktop.showContextMenu(sessionMenuItems({ todo, labels, online, exportable: snapshot.supportsThreadExport === true }), point.x, point.y)
      .then(choice => { if (isSessionMenuAction(choice)) onAction(choice); }, () => {})
      .finally(() => { menuOpen.current = false; });
  };
  return <div className="session-status-bar" role="group" aria-label="Session status">
    <nav className="status-location" aria-label="Session location">
      <button type="button" className="status-connection" aria-label={`Connection ${connectionName}, ${stateName[state]}`} data-tooltip="Connection settings"
        onClick={() => safely(connection ? window.hermesDesktop.openSettings(connection.id) : window.hermesDesktop.openSettings())}>
        <span className={`status-dot status-dot-${state}`} aria-hidden="true" /><span className="status-connection-name">{connectionName}</span>{hint && <span className="status-connection-hint">{hint}</span>}
      </button>
      {channel && <><span className="status-separator" aria-hidden="true">›</span>
        <button type="button" className="status-project" aria-label={`Project ${channel.name}`} data-tooltip="Show in sidebar" onClick={() => safely(window.hermesDesktop.revealProject(channel.id))}>{channel.name}</button></>}
    </nav>
    <div className="status-actions">
      {labels && <button type="button" className={`todo-toggle${todo ? ' todo-on' : ''}`} aria-pressed={todo} aria-label={todo ? 'Remove todo' : 'Mark as todo'} data-tooltip={todoTooltip}
        disabled={todoBusy || !thread || !online} onClick={onToggleTodo}><TodoIcon on={todo} /></button>}
      <button type="button" className="status-more" aria-haspopup="menu" aria-label="More session actions" data-tooltip="More" disabled={!thread} onClick={openMenu}><MoreIcon /></button>
    </div>
    {labels && <StatusLabels markers={withoutTodo(thread?.markers)} onSearch={label => safely(window.hermesDesktop.searchLabel(label))} />}
  </div>;
}
