import { useEffect, useRef, useState } from 'react';

// Session tabs are WebContentsViews; Electron does not reliably show native `title`
// tooltips there. Controls set `data-tooltip` instead and one layer per page draws it.
const SHOW_DELAY_MS = 450;
const GAP = 6;
const EDGE = 8;

type Tip = { text: string; target: HTMLElement };

const tooltipTarget = (node: EventTarget | null) => node instanceof Element ? node.closest<HTMLElement>('[data-tooltip]') : null;

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (typeof document.addEventListener !== 'function') return; // non-DOM test renderers
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: HTMLElement | null = null, at = '';
    const where = (target: HTMLElement) => { const box = target.getBoundingClientRect(); return `${Math.round(box.left)},${Math.round(box.top)}`; };
    const hide = () => { clearTimeout(timer); current = null; setTip(null); };
    // Scrolling elsewhere (a code block, the sidebar) keeps the tooltip; it hides only when its control moved.
    const scroll = () => { if (current && (!current.isConnected || where(current) !== at)) hide(); };
    const show = (target: HTMLElement, delay: number) => {
      if (target === current) return;
      clearTimeout(timer); current = target; at = where(target); setTip(null);
      timer = setTimeout(() => { const text = target.dataset.tooltip?.trim(); if (text && target.isConnected) setTip({ text, target }); }, delay);
    };
    const over = (event: PointerEvent) => { const target = tooltipTarget(event.target); if (target) show(target, SHOW_DELAY_MS); else if (current) hide(); };
    const focus = (event: FocusEvent) => { const target = tooltipTarget(event.target); if (target?.matches(':focus-visible')) show(target, 0); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
    // A click hides the tooltip; it stays hidden until the pointer leaves that control.
    const press = (event: PointerEvent) => { hide(); current = tooltipTarget(event.target); };
    document.addEventListener('pointerover', over);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', press, true);
    document.addEventListener('scroll', scroll, true);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', hide);
    document.documentElement.addEventListener('pointerleave', hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerover', over);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', press, true);
      document.removeEventListener('scroll', scroll, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('blur', hide);
      document.documentElement.removeEventListener('pointerleave', hide);
    };
  }, []);
  useEffect(() => {
    setPlace(null);
    if (!tip || !bubble.current) return;
    const anchor = tip.target.getBoundingClientRect(), size = bubble.current.getBoundingClientRect();
    const width = document.documentElement.clientWidth, height = document.documentElement.clientHeight;
    const left = Math.min(Math.max(EDGE, anchor.left + anchor.width / 2 - size.width / 2), Math.max(EDGE, width - EDGE - size.width));
    const below = anchor.bottom + GAP;
    const top = below + size.height <= height - EDGE ? below : Math.max(EDGE, anchor.top - GAP - size.height);
    setPlace({ left, top });
  }, [tip]);
  if (!tip) return null;
  return <div ref={bubble} className="app-tooltip" role="tooltip" aria-hidden="true" style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: 'hidden' }}>{tip.text}</div>;
}
