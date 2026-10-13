import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * Sidebar Session card: the full title and details of the Session row under
 * the pointer (or with keyboard focus). It replaces the native `title`
 * tooltip, which shows late, uses small system text and holds one line.
 *
 * The Session page is a separate native view to the right of the sidebar, so
 * the card cannot cross the sidebar edge: it spans the sidebar width and wraps.
 */
export const SHOW_DELAY_MS = 250;
/** After a card closes, a card for the next row in this time shows at once. */
export const WARM_MS = 500;
const GAP = 4, INSET = 8, EDGE = 8;
export const SESSION_CARD_ID = 'sidebar-session-card';

export type SessionCardInfo = Readonly<{
  title: string; project?: string; connection?: string; statuses: readonly string[]; labels: readonly string[]; lastMessageAt?: number;
}>;

const rowOf = (root: HTMLElement, node: EventTarget | null) => {
  const row = node instanceof Element ? node.closest<HTMLElement>('[data-thread-id]') : null;
  return row && root.contains(row) ? row : null;
};

const lastMessage = (seconds?: number) => {
  if (!seconds) return undefined;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return undefined;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString(undefined, { ...(sameYear ? {} : { year: 'numeric' }), month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export function SessionHoverCard({ root, describe }: { root: RefObject<HTMLElement | null>; describe: (threadId: string) => SessionCardInfo | undefined }) {
  const [row, setRow] = useState<HTMLElement | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number; width: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element || typeof element.addEventListener !== 'function') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: HTMLElement | null = null, shown = false, closedAt = 0;
    // After a click the row's card stays closed until the pointer leaves that row.
    let pressed: HTMLElement | null = null;
    const hide = () => {
      clearTimeout(timer);
      if (shown) closedAt = Date.now();
      current?.removeAttribute('aria-describedby');
      current = null; shown = false; setRow(null);
    };
    const show = (target: HTMLElement, delay: number) => {
      if (target === current) return;
      const warm = shown || Date.now() - closedAt < WARM_MS;
      hide();
      current = target;
      const open = () => { if (current !== target || !target.isConnected) return; shown = true; target.setAttribute('aria-describedby', SESSION_CARD_ID); setRow(target); };
      if (warm || delay === 0) open(); else timer = setTimeout(open, delay);
    };
    const over = (event: PointerEvent) => {
      const target = rowOf(element, event.target);
      if (target !== pressed) pressed = null;
      if (!target) { if (current) hide(); return; }
      if (target !== pressed) show(target, SHOW_DELAY_MS);
    };
    const leave = () => { pressed = null; hide(); };
    const press = () => { pressed = current; hide(); };
    const focus = (event: FocusEvent) => { const target = rowOf(element, event.target); if (target?.matches(':focus-visible')) show(target, 0); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && current) hide(); };
    element.addEventListener('pointerover', over);
    element.addEventListener('pointerleave', leave);
    element.addEventListener('pointerdown', press, true);
    element.addEventListener('contextmenu', press, true);
    element.addEventListener('scroll', hide, { passive: true });
    element.addEventListener('focusin', focus);
    element.addEventListener('focusout', hide);
    element.addEventListener('keydown', key);
    window.addEventListener('blur', hide);
    return () => {
      hide();
      element.removeEventListener('pointerover', over);
      element.removeEventListener('pointerleave', leave);
      element.removeEventListener('pointerdown', press, true);
      element.removeEventListener('contextmenu', press, true);
      element.removeEventListener('scroll', hide);
      element.removeEventListener('focusin', focus);
      element.removeEventListener('focusout', hide);
      element.removeEventListener('keydown', key);
      window.removeEventListener('blur', hide);
    };
  }, [root]);
  const info = row?.isConnected ? describe(row.dataset.threadId ?? '') : undefined;
  useLayoutEffect(() => {
    const container = root.current;
    if (!info || !row || !card.current || !container) { setPlace(null); return; }
    const anchor = row.getBoundingClientRect(), side = container.getBoundingClientRect();
    const width = Math.max(120, side.width - INSET * 2);
    card.current.style.width = `${width}px`; // Measure the height at the final width.
    const height = card.current.getBoundingClientRect().height, bottom = document.documentElement.clientHeight - EDGE;
    const below = anchor.bottom + GAP;
    const top = below + height <= bottom ? below : Math.max(EDGE, anchor.top - GAP - height);
    setPlace(old => old && old.left === side.left + INSET && old.top === top && old.width === width ? old : { left: side.left + INSET, top, width });
  });
  if (!info) return null;
  const where = [info.project, info.connection].filter(Boolean).join(' · ');
  const when = lastMessage(info.lastMessageAt);
  return <div ref={card} id={SESSION_CARD_ID} className="session-hover-card" role="tooltip"
    style={place ? { left: place.left, top: place.top, width: place.width } : { left: 0, top: 0, width: 240, visibility: 'hidden' }}>
    <div className="session-hover-title">{info.title}</div>
    {where && <div className="session-hover-meta">{where}</div>}
    {info.statuses.length > 0 && <div className="session-hover-status">{info.statuses.join(' · ')}</div>}
    {info.labels.length > 0 && <div className="session-hover-labels">{info.labels.map(label => <span key={label} className="label-pill">{label}</span>)}</div>}
    {when && <div className="session-hover-meta">Last message {when}</div>}
  </div>;
}
