import { useCallback, useEffect, useRef, useState } from 'react';
import type { FindAction } from '../shared/desktop-api';

/**
 * Find in page for the app's own tab pages. The matches are painted with the CSS Custom Highlight API,
 * so the page DOM, its selection and the composer stay unchanged. Matching ignores case and runs across
 * inline elements (a word split by bold or code still matches), but not across blocks.
 */

const ALL = 'hermes-find', CURRENT = 'hermes-find-current', MAX_MATCHES = 2000;
const INLINE = new Set(['A', 'ABBR', 'B', 'BDI', 'BDO', 'CITE', 'CODE', 'DATA', 'DFN', 'EM', 'I', 'KBD', 'MARK', 'Q', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR', 'DEL', 'INS']);
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'TEMPLATE', 'SVG']);

const blockOf = (node: Node): Element | null => {
  let element = node.parentElement;
  while (element && INLINE.has(element.tagName)) element = element.parentElement;
  return element;
};
const visible = (element: Element | null): boolean => {
  if (!element || element.closest('[hidden], [aria-hidden="true"]')) return false;
  // A closed <details> shows only its summary.
  const details = element.closest('details:not([open])');
  return !details || element.closest('summary')?.parentElement === details;
};
/** Lower case per character, keeping every UTF-16 offset of the original text (a character that changes length stays as is). */
const fold = (value: string): string => [...value].map(char => { const lower = char.toLocaleLowerCase(); return lower.length === char.length ? lower : char; }).join('');

/** Ranges of every case-insensitive match of `query` in the text under `root`, in document order. Skips `exclude`. */
export function findRanges(root: Node, query: string, exclude?: Element | null): Range[] {
  const needle = fold(query);
  if (!needle.trim()) return [];
  const nodes: Text[] = [], starts: number[] = [];
  let text = '', previousBlock: Element | null | undefined;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: node => {
    const parent = node.parentElement;
    if (!parent || !node.nodeValue || (exclude && exclude.contains(node))) return NodeFilter.FILTER_REJECT;
    for (let item: Element | null = parent; item && item !== root; item = item.parentElement) if (SKIP.has(item.tagName.toUpperCase())) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  } });
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const block = blockOf(node);
    if (!visible(block)) continue;
    // A block boundary separates the text, so a match never joins two paragraphs.
    if (previousBlock !== undefined && block !== previousBlock) text += '\n';
    previousBlock = block; nodes.push(node); starts.push(text.length); text += node.nodeValue ?? '';
  }
  const folded = fold(text);
  const locate = (offset: number): [Text, number] => {
    let low = 0, high = nodes.length - 1;
    while (low < high) { const middle = (low + high + 1) >> 1; if (starts[middle] <= offset) low = middle; else high = middle - 1; }
    return [nodes[low], Math.min(offset - starts[low], nodes[low].length)];
  };
  const ranges: Range[] = [];
  for (let index = folded.indexOf(needle); index >= 0 && ranges.length < MAX_MATCHES; index = folded.indexOf(needle, index + needle.length)) {
    const range = document.createRange(), [startNode, startOffset] = locate(index), [endNode, endOffset] = locate(index + needle.length);
    range.setStart(startNode, startOffset); range.setEnd(endNode, endOffset); ranges.push(range);
  }
  return ranges;
}

const highlights = () => (globalThis.CSS as unknown as { highlights?: Map<string, unknown> } | undefined)?.highlights;
const HighlightType = () => (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
function paint(ranges: Range[], current: number): void {
  const registry = highlights(), Highlight = HighlightType();
  if (!registry || !Highlight) return;
  registry.set(ALL, new Highlight(...ranges.filter((_, index) => index !== current)));
  if (ranges[current]) registry.set(CURRENT, new Highlight(ranges[current])); else registry.delete(CURRENT);
}
const clear = () => { highlights()?.delete(ALL); highlights()?.delete(CURRENT); };
const reveal = (range: Range | undefined) => {
  const element = range?.startContainer.parentElement; if (!element) return;
  const box = range!.getBoundingClientRect(), view = { top: 56, bottom: window.innerHeight - 140 };
  if (box.top >= view.top && box.bottom <= view.bottom) return;
  element.scrollIntoView({ block: 'center', inline: 'nearest' });
};

/** The selected text of the page, also inside a text field. */
export function pageSelection(): string {
  const active = document.activeElement;
  if ((active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) && active.selectionStart !== null && active.selectionEnd !== null && active.selectionEnd > active.selectionStart)
    return active.value.slice(active.selectionStart, active.selectionEnd);
  return window.getSelection()?.toString() ?? '';
}
const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 500);

const FindIcon = ({ d }: { d: string }) => <svg viewBox="0 0 20 20" aria-hidden="true"><path d={d} /></svg>;
const UP = 'M5 12.5l5-5 5 5', DOWN = 'M5 7.5l5 5 5-5', CLOSE = 'M5.5 5.5l9 9M14.5 5.5l-9 9';

export function FindBar() {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [count, setCount] = useState(0), [current, setCurrent] = useState(0);
  const bar = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), ranges = useRef<Range[]>([]);
  const state = useRef({ open, query, current }); state.current = { open, query, current };
  const restore = useRef<Element | null>(null);

  // Searches `text`; `wanted` is the match to show (kept when the page content changes).
  const run = useCallback((text: string, wanted: number, scroll: boolean) => {
    const found = findRanges(document.body, text, bar.current);
    const index = found.length ? Math.min(Math.max(wanted, 0), found.length - 1) : 0;
    ranges.current = found; setCount(found.length); setCurrent(index); paint(found, index);
    if (scroll) reveal(found[index]);
  }, []);
  const step = useCallback((direction: 1 | -1) => {
    const total = ranges.current.length; if (!total) return;
    const index = (state.current.current + direction + total) % total;
    setCurrent(index); paint(ranges.current, index); reveal(ranges.current[index]);
  }, []);
  const [focusRequest, setFocusRequest] = useState(0);
  // Opens the bar with `text`, or with the last query (searched again: the page may have changed).
  const show = useCallback((text?: string) => {
    if (!state.current.open) restore.current = document.activeElement;
    const next = text ?? state.current.query;
    setOpen(true); setQuery(next); setFocusRequest(value => value + 1);
    if (next) run(next, text === undefined ? state.current.current : 0, true);
  }, [run]);
  // After the bar renders: keyboard focus in the field, with the query selected so typing replaces it.
  useEffect(() => { if (focusRequest) { input.current?.focus(); input.current?.select(); } }, [focusRequest]);
  const close = useCallback(() => {
    setOpen(false); clear(); ranges.current = [];
    // Leave the current match selected, as a browser does, so Copy works on it.
    const target = restore.current; restore.current = null;
    if (target instanceof HTMLElement && target.isConnected) target.focus();
  }, []);

  useEffect(() => window.hermesDesktop?.onFind?.((action: FindAction, text?: string) => {
    if (action === 'open') show(text === undefined ? undefined : oneLine(text));
    else if (action === 'selection') { const selected = oneLine(pageSelection()); show(selected || undefined); }
    else if (!state.current.open || !state.current.query) show();
    else step(action === 'next' ? 1 : -1);
  }), [show, step]);
  useEffect(() => clear, []);
  // New messages, history pages and edits change the text; search again and keep the place.
  useEffect(() => {
    if (!open || !query) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(records => {
      if (records.every(record => bar.current?.contains(record.target))) return;
      clearTimeout(timer); timer = setTimeout(() => run(state.current.query, state.current.current, false), 200);
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['open', 'hidden', 'aria-hidden'] });
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, [open, query, run]);

  if (!open) return null;
  const status = !query ? '' : count ? `${current + 1} of ${count >= MAX_MATCHES ? `${MAX_MATCHES}+` : count}` : 'No results';
  return <div ref={bar} className="find-bar" role="search" aria-label="Find in page">
    <input ref={input} type="search" aria-label="Find in page" placeholder="Find in page" value={query} spellCheck={false}
      onChange={event => { setQuery(event.target.value); run(event.target.value, 0, true); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') { event.preventDefault(); step(event.shiftKey ? -1 : 1); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      }} />
    <span className="find-bar-count" aria-live="polite">{status}</span>
    <button type="button" className="find-bar-button" aria-label="Previous match" title="Previous match (⇧⌘G)" disabled={!count} onClick={() => step(-1)}><FindIcon d={UP} /></button>
    <button type="button" className="find-bar-button" aria-label="Next match" title="Next match (⌘G)" disabled={!count} onClick={() => step(1)}><FindIcon d={DOWN} /></button>
    <button type="button" className="find-bar-button" aria-label="Close find" title="Close (Esc)" onClick={close}><FindIcon d={CLOSE} /></button>
  </div>;
}
