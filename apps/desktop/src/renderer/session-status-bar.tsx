import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { withoutTodo } from '../../../../packages/client/src/todo';
import type { DesktopSnapshot, DesktopThread } from '../shared/desktop-api';
import { connectionHint } from './navigation-panel';
import { MessageIcon } from './message-toolbar';
import { usageDescription, usageText, useThreadUsage } from './thread-usage';

const safely = (task: Promise<unknown>) => void task.catch(() => {});
const stateName: Record<DesktopSnapshot['connectionState'], string> = { online: 'Online', connecting: 'Connecting', syncing: 'Connecting', retrying: 'Reconnecting', suspended: 'Offline', blocked: 'Needs attention' };
// Todo flag: the pennant fills when the Session is flagged.
const TodoIcon = ({ on }: { on: boolean }) => <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 17V3.5" /><path className={on ? 'todo-pennant-on' : undefined} d="M5.5 4h9.5l-2.4 3.5 2.4 3.5H5.5z" /></svg>;
// Stroke icons for the status bar tools. Decorative: each button carries its accessible name.
const TOOL_ICONS = {
  link: 'M8.5 11.5l3-3M7 9.5l-1.6 1.6a2.6 2.6 0 003.7 3.7L10.7 13M13 10.5l1.6-1.6a2.6 2.6 0 00-3.7-3.7L9.3 6.8',
  label: 'M3.5 4.5v4.6l7.4 7.4 5.6-5.6-7.4-7.4H4.5zM7 7h.01',
  rename: 'M4 16h3l8.5-8.5-3-3L4 13zM11 6l3 3',
  archive: 'M3.5 4.5h13v3h-13zM4.5 7.5v8h11v-8M8 10.5h4',
  files: 'M5 3.5h6.5l3.5 3.5v9.5H5zM11.5 3.5V7H15M7.5 10.5h5M7.5 13h5',
} as const;
const ToolIcon = ({ name }: { name: keyof typeof TOOL_ICONS }) => <svg viewBox="0 0 20 20" aria-hidden="true"><path d={TOOL_ICONS[name]} /></svg>;
export type StatusAction = 'copy-link' | 'export' | 'files' | 'labels' | 'rename' | 'archive';

/** The +N label menu opens at the pointer for a click and under the button for the keyboard. View coordinates. */
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
 * (connection state and name, then Project), every Session tool as its own
 * button, and the labels, which take the rest of the row.
 */
export function SessionStatusBar({ snapshot, thread, todo, todoBusy, todoTooltip, onToggleTodo, onAction }: {
  snapshot: DesktopSnapshot; thread?: DesktopThread; todo: boolean; todoBusy: boolean; todoTooltip: string;
  onToggleTodo: () => void; onAction: (action: StatusAction) => void;
}) {
  const channel = snapshot.channels.find(c => c.id === (thread?.channelId ?? snapshot.selectedChannelId));
  const connection = snapshot.connections?.find(row => row.connectionKey && row.connectionKey === snapshot.connectionKey);
  const connectionName = channel?.connectionName ?? connection?.name ?? snapshot.connectionName ?? 'Connection';
  const state = snapshot.connectionState, online = state === 'online', hint = connectionHint[state];
  const labels = snapshot.supportsSessionLabels === true;
  const usage = useThreadUsage(thread?.id, thread?.running ?? false, thread?.lastMessageAt);
  return <div className="session-status-bar" role="group" aria-label="Session status">
    <nav className="status-location" aria-label="Session location">
      <button type="button" className="status-connection" aria-label={`Connection ${connectionName}, ${stateName[state]}`} data-tooltip="Connection settings"
        onClick={() => safely(connection ? window.hermesDesktop.openSettings(connection.id) : window.hermesDesktop.openSettings())}>
        <span className={`status-dot status-dot-${state}`} aria-hidden="true" /><span className="status-connection-name">{connectionName}</span>{hint && <span className="status-connection-hint">{hint}</span>}
      </button>
      {channel && <><span className="status-separator" aria-hidden="true">›</span>
        <button type="button" className="status-project" aria-label={`Project ${channel.name}`} data-tooltip="Show in sidebar" onClick={() => safely(window.hermesDesktop.revealProject(channel.id))}>{channel.name}</button></>}
    </nav>
    {/* Same tools, order, names and states as the former top toolbar. */}
    <div className="status-actions" role="toolbar" aria-label="Session tools">
      {labels && <button type="button" className={`todo-toggle${todo ? ' todo-on' : ''}`} aria-pressed={todo} aria-label={todo ? 'Remove todo' : 'Mark as todo'} data-tooltip={todoTooltip}
        disabled={todoBusy || !thread || !online} onClick={onToggleTodo}><TodoIcon on={todo} /></button>}
      <button type="button" aria-label="Copy link" data-tooltip="Copy link" onClick={() => onAction('copy-link')}><ToolIcon name="link" /></button>
      {snapshot.supportsSessionFiles && <button type="button" aria-label="Session files" data-tooltip="Session files" disabled={!thread} onClick={() => onAction('files')}><ToolIcon name="files" /></button>}
      {snapshot.supportsThreadExport && <button type="button" aria-label="Export conversation" data-tooltip="Export conversation" onClick={() => onAction('export')}><MessageIcon name="export" /></button>}
      {labels && <button type="button" aria-label="Edit labels" data-tooltip="Edit labels" disabled={!thread} onClick={() => onAction('labels')}><ToolIcon name="label" /></button>}
      <button type="button" aria-label="Rename" data-tooltip="Rename session" disabled={!thread} onClick={() => onAction('rename')}><ToolIcon name="rename" /></button>
      <button type="button" aria-label="Archive" data-tooltip="Archive session" onClick={() => onAction('archive')}><ToolIcon name="archive" /></button>
    </div>
    {labels && <StatusLabels markers={withoutTodo(thread?.markers)} onSearch={label => safely(window.hermesDesktop.searchLabel(label))} />}
    {/* Context after compaction and total tokens; read again when a turn ends. Focusable so the keyboard reaches the tooltip. */}
    {usage && <span className="status-usage" tabIndex={0} role="note" aria-label={usageDescription(usage)} data-tooltip={usageDescription(usage)}>{usageText(usage)}</span>}
  </div>;
}
