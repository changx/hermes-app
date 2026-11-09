import { useEffect, useRef, useState, type RefObject } from 'react';
import type { SessionCardRequest } from '../shared/desktop-api';
import { usageDescription, usageText, useThreadUsage } from './thread-usage';

/**
 * Sidebar Session card: the full title and details of the Session row under
 * the pointer (or with keyboard focus). It replaces the native `title`
 * tooltip, which shows late, uses small system text and holds one line.
 *
 * The card opens to the right of the sidebar, level with the row, so it never
 * covers the sidebar. The Session page there is a separate native view, so the
 * main process shows the card in its own small window (SessionCardWindow).
 * This component decides when and what; it draws only an accessible description.
 */
export const SHOW_DELAY_MS = 250;
/** After a card closes, a card for the next row in this time shows at once. */
export const WARM_MS = 500;
export const SESSION_CARD_ID = 'sidebar-session-card';

export type SessionCardInfo = Readonly<{
  title: string; project?: string; connection?: string; statuses: readonly string[]; labels: readonly string[]; lastMessageAt?: number;
}>;

const rowOf = (root: HTMLElement, node: EventTarget | null) => {
  const row = node instanceof Element ? node.closest<HTMLElement>('[data-thread-id]') : null;
  return row && root.contains(row) ? row : null;
};

export const lastMessageText = (seconds?: number) => {
  if (!seconds) return undefined;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return undefined;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString(undefined, { ...(sameYear ? {} : { year: 'numeric' }), month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const send = (card: SessionCardRequest | null) => { void window.hermesDesktop?.showSessionCard?.(card)?.catch?.(() => {}); };

export function SessionHoverCard({ root, describe }: { root: RefObject<HTMLElement | null>; describe: (threadId: string) => SessionCardInfo | undefined }) {
  const [row, setRow] = useState<HTMLElement | null>(null);
  const shown = useRef(false);
  useEffect(() => {
    const element = root.current;
    if (!element || typeof element.addEventListener !== 'function') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: HTMLElement | null = null, open = false, closedAt = 0;
    // After a click the row's card stays closed until the pointer leaves that row.
    let pressed: HTMLElement | null = null;
    const hide = () => {
      clearTimeout(timer);
      if (open) closedAt = Date.now();
      current?.removeAttribute('aria-describedby');
      current = null; open = false; setRow(null);
    };
    const show = (target: HTMLElement, delay: number) => {
      if (target === current) return;
      const warm = open || Date.now() - closedAt < WARM_MS;
      hide();
      current = target;
      const reveal = () => { if (current !== target || !target.isConnected) return; open = true; target.setAttribute('aria-describedby', SESSION_CARD_ID); setRow(target); };
      if (warm || delay === 0) reveal(); else timer = setTimeout(reveal, delay);
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
    // No window `blur` rule: focus moving into the Session page blurs this page too. Main hides the card when the window loses focus.
    window.addEventListener('resize', hide);
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
      window.removeEventListener('resize', hide);
    };
  }, [root]);
  const threadId = row?.dataset.threadId ?? '';
  const info = row?.isConnected ? describe(threadId) : undefined;
  const lastMessage = lastMessageText(info?.lastMessageAt);
  // Token usage arrives after the card opens; the card then grows by one line. Readings are reused.
  const tokens = useThreadUsage(info ? threadId : undefined, info?.statuses.includes('Running') ?? false, info?.lastMessageAt);
  const usage = tokens ? usageText(tokens) : undefined;
  // Live state (Running, labels, usage) can change while the card is open; resend only on a real change.
  const key = info ? JSON.stringify([info.title, info.project, info.connection, info.statuses, info.labels, lastMessage, usage]) : '';
  useEffect(() => {
    const container = root.current;
    if (!info || !row || !container) { if (shown.current) { shown.current = false; send(null); } return; }
    const box = row.getBoundingClientRect(), sidebar = (container.closest('aside') ?? container).getBoundingClientRect();
    const fontSize = parseFloat(getComputedStyle(row).fontSize) || 16;
    shown.current = true;
    send({ title: info.title, project: info.project, connection: info.connection, statuses: [...info.statuses], labels: [...info.labels], lastMessage, usage,
      rowTop: box.top, rowBottom: box.bottom, sidebarRight: sidebar.right, fontSize });
  }, [row, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (shown.current) { shown.current = false; send(null); } }, []);
  if (!info) return null;
  // Screen readers read this through the row's aria-describedby; the visible card is the native popup.
  const where = [info.project, info.connection].filter(Boolean).join(' · ');
  return <div id={SESSION_CARD_ID} className="visually-hidden">
    {[info.title, where, info.statuses.join(', '), info.labels.length ? `Labels: ${info.labels.join(', ')}` : '', tokens ? usageDescription(tokens) : '', lastMessage ? `Last message ${lastMessage}` : ''].filter(Boolean).join('. ')}
  </div>;
}
