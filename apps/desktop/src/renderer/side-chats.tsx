import { useMemo, type MouseEvent } from 'react';
import { sideChatsByAnchor, sideMarkLabel } from '../../../../packages/client/src/sideChats';
import { runningFirst } from '../../../../packages/client/src/todo';
import type { DesktopSnapshot, DesktopThread } from '../shared/desktop-api';
import { MessageIcon } from './message-toolbar';

/** Side chats of one Session (docs/side-chat.md), running first, then newest activity; and by anchor message. */
export function useSideChats(snapshot: DesktopSnapshot): { all: readonly DesktopThread[]; byAnchor: ReadonlyMap<number, readonly DesktopThread[]> } {
  const id = snapshot.selectedThreadId, threads = snapshot.threads;
  return useMemo(() => {
    const all = id ? threads.filter(thread => thread.sideOf?.threadId === id && thread.id !== id).sort(runningFirst) : [];
    return { all, byAnchor: sideChatsByAnchor(all, thread => thread.sideOf?.anchorRefSeq) };
  }, [id, threads]);
}

const safely = (task: Promise<unknown>) => void task.catch(() => {});
const rowLabel = (thread: DesktopThread) => [thread.title.length > 80 ? `${thread.title.slice(0, 79)}…` : thread.title, thread.running && 'Running', thread.completedUnread && 'Unread'].filter(Boolean).join(' · ');

/** One side chat opens at once; several show a native menu (at the pointer, or under the button for the keyboard). */
export function openSideChats(sides: readonly DesktopThread[], event: MouseEvent<HTMLElement>): void {
  if (sides.length === 1) { safely(window.hermesDesktop.openSideChat(sides[0].id)); return; }
  const box = event.currentTarget.getBoundingClientRect(), point = event.detail > 0 ? { x: event.clientX, y: event.clientY } : { x: box.left, y: box.bottom };
  void window.hermesDesktop.showContextMenu(sides.map((thread, index) => ({ id: `side-${index}`, label: rowLabel(thread) })), point.x, point.y)
    .then(choice => { const thread = choice?.startsWith('side-') ? sides[Number(choice.slice(5))] : undefined; if (thread) safely(window.hermesDesktop.openSideChat(thread.id)); }, () => {});
}

export const SideIcon = () => <MessageIcon name="side" />;

/** The mark under an anchor message: not a message, never in history, search or export. */
export function SideMark({ sides }: { sides: readonly DesktopThread[] }) {
  const running = sides.some(thread => thread.running), unread = sides.some(thread => thread.completedUnread);
  const states = [running && 'running', unread && 'unread result'].filter(Boolean).join(', ');
  return <div className="side-mark-row">
    <button type="button" className="side-mark" aria-haspopup={sides.length > 1 ? 'menu' : undefined}
      aria-label={`${sideMarkLabel(sides.length)}${states ? `, ${states}` : ''}`} onClick={event => openSideChats(sides, event)}>
      <SideIcon /><span>{sideMarkLabel(sides.length)}</span>
      {running && <span className="side-mark-dot side-mark-running" aria-hidden="true" />}
      {unread && <span className="side-mark-dot side-mark-unread" aria-hidden="true" />}
    </button>
  </div>;
}
