// Page reader for the built-in browser. Runs as the browser pane preload, which Electron executes in
// an isolated world (contextIsolation): the page cannot see this script, its variables or its refs.
// It reads the DOM only. Refs live in this world's maps and are never written back into the page.
// No object is exposed to the page. The main process talks to it over IPC.
import { ipcRenderer } from 'electron';

const INTERACTIVE = [
  'a[href]', 'button', 'input:not([type=hidden])', 'select', 'textarea', 'summary', '[contenteditable=""]', '[contenteditable="true"]',
  '[role=button]', '[role=link]', '[role=checkbox]', '[role=radio]', '[role=tab]', '[role=menuitem]', '[role=option]',
  '[role=switch]', '[role=combobox]', '[role=textbox]', '[role=searchbox]', '[tabindex]:not([tabindex="-1"])',
].join(',');
const TEXT = 'h1,h2,h3,h4,h5,h6,p,li,td,th,dt,dd,label,figcaption,blockquote,pre';
const MAX_LINES = 600, MAX_CHARS = 14000;

const refs = new Map<string, WeakRef<Element>>();
const ids = new WeakMap<Element, string>();
let counter = 0;

const clean = (value: string | null | undefined, maximum = 80): string => {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > maximum ? text.slice(0, maximum - 1) + '…' : text;
};
const tag = (el: Element) => el.tagName.toLowerCase();
const refFor = (el: Element): string => {
  let id = ids.get(el);
  if (!id) { id = `e${++counter}`; ids.set(el, id); }
  refs.set(id, new WeakRef(el));
  return id;
};

function visible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const check = (el as HTMLElement & { checkVisibility?: (o: object) => boolean }).checkVisibility;
  if (check) return check.call(el, { checkVisibilityCSS: true });
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  return !style || (style.visibility !== 'hidden' && style.display !== 'none');
}

function roleOf(el: Element): string {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit.split(/\s+/)[0];
  const name = tag(el);
  if (name === 'a') return 'link';
  if (name === 'button' || name === 'summary') return 'button';
  if (name === 'select') return 'combobox';
  if (name === 'textarea') return 'textbox';
  if (name === 'input') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return ({ checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button', reset: 'button', image: 'button', range: 'slider', search: 'searchbox', file: 'file' } as Record<string, string>)[type] ?? 'textbox';
  }
  if ((el as HTMLElement).isContentEditable) return 'textbox';
  return 'generic';
}

function labelOf(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria && clean(aria)) return clean(aria);
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const joined = labelledBy.split(/\s+/).map(id => el.ownerDocument.getElementById(id)?.textContent ?? '').join(' ');
    if (clean(joined)) return clean(joined);
  }
  const name = tag(el);
  if (name === 'input' || name === 'textarea' || name === 'select') {
    if (el.id) {
      const label = el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label && clean(label.textContent)) return clean(label.textContent);
    }
    const wrapping = el.closest('label');
    if (wrapping && clean(wrapping.textContent)) return clean(wrapping.textContent);
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return clean(placeholder);
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (name === 'input' && ['button', 'submit', 'reset'].includes(type)) return clean((el as HTMLInputElement).value);
  }
  const alt = el.getAttribute('alt') || el.getAttribute('title');
  if (alt) return clean(alt);
  const image = el.querySelector('img[alt]');
  const text = clean((el as HTMLElement).innerText ?? el.textContent);
  return text || clean(image?.getAttribute('alt'));
}

function stateOf(el: Element): string {
  const parts: string[] = [];
  const name = tag(el), type = (el.getAttribute('type') || '').toLowerCase();
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') parts.push('disabled');
  if ((name === 'input' && ['checkbox', 'radio'].includes(type) && (el as HTMLInputElement).checked) || el.getAttribute('aria-checked') === 'true') parts.push('checked');
  const expanded = el.getAttribute('aria-expanded');
  if (expanded) parts.push(expanded === 'true' ? 'expanded' : 'collapsed');
  if (name === 'select') {
    const option = (el as HTMLSelectElement).selectedOptions?.[0];
    if (option) parts.push(`selected="${clean(option.textContent, 60)}"`);
  } else if ((name === 'input' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file'].includes(type)) || name === 'textarea') {
    const value = (el as HTMLInputElement).value;
    if (value) parts.push(type === 'password' ? 'value=(hidden)' : `value="${clean(value, 60)}"`);
  }
  return parts.length ? ' ' + parts.join(' ') : '';
}

function documents(root: Document): Document[] {
  const found = [root];
  for (const frame of Array.from(root.querySelectorAll('iframe,frame'))) {
    try { const inner = (frame as HTMLIFrameElement).contentDocument; if (inner && visible(frame)) found.push(...documents(inner)); }
    catch { /* Cross-origin frames are not readable. */ }
  }
  return found;
}

function snapshot() {
  const lines: string[] = [], seen = new Set<string>();
  let chars = 0, truncated = false;
  const push = (line: string) => {
    if (lines.length >= MAX_LINES || chars + line.length > MAX_CHARS) { truncated = true; return false; }
    lines.push(line); chars += line.length + 1; return true;
  };
  outer: for (const doc of documents(document)) {
    for (const el of Array.from(doc.querySelectorAll(`${TEXT},${INTERACTIVE}`))) {
      if (!visible(el)) continue;
      if (el.matches(INTERACTIVE)) {
        const role = roleOf(el), label = labelOf(el);
        if (!push(`[${refFor(el)}] ${role}${label ? ` "${label}"` : ''}${stateOf(el)}`)) break outer;
        continue;
      }
      if (el.closest(INTERACTIVE) || el.querySelector(INTERACTIVE)) continue;
      const heading = /^h[1-6]$/.exec(tag(el));
      const value = clean((el as HTMLElement).innerText ?? el.textContent, heading ? 120 : 220);
      if (!value || seen.has(value)) continue;
      seen.add(value);
      if (!push(heading ? `${'#'.repeat(Number(tag(el)[1]))} ${value}` : value)) break outer;
    }
  }
  const scroller = document.scrollingElement ?? document.documentElement;
  return { url: location.href, title: document.title, scrollY: Math.round(scroller.scrollTop), scrollHeight: Math.round(scroller.scrollHeight),
    viewportHeight: innerHeight, viewportWidth: innerWidth, text: lines.join('\n'), truncated, refs: lines.filter(line => line.startsWith('[e')).length };
}

function element(ref: unknown): Element {
  const el = typeof ref === 'string' ? refs.get(ref)?.deref() : undefined;
  if (!el || !el.isConnected) throw Object.assign(new Error('That element is no longer on the page. Take a new snapshot.'), { code: 'stale_ref' });
  return el;
}

/** Offset of an element's document inside the top-level viewport (same-origin frames only). */
function frameOffset(el: Element): { x: number; y: number } {
  let x = 0, y = 0, win = el.ownerDocument.defaultView;
  while (win && win !== window) {
    const frame = win.frameElement; if (!frame) break;
    const rect = frame.getBoundingClientRect();
    x += rect.left + frame.clientLeft; y += rect.top + frame.clientTop;
    win = frame.ownerDocument.defaultView;
  }
  return { x, y };
}

function locate(ref: unknown) {
  const el = element(ref);
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
  const rect = el.getBoundingClientRect(), offset = frameOffset(el);
  const localX = Math.min(Math.max(rect.left + rect.width / 2, rect.left + 1), rect.right - 1);
  const localY = Math.min(Math.max(rect.top + rect.height / 2, rect.top + 1), rect.bottom - 1);
  const hit = el.ownerDocument.elementFromPoint(localX, localY);
  const covered = !!hit && hit !== el && !el.contains(hit) && !(tag(el) === 'input' && hit.closest('label')?.control === el);
  const editable = ['input', 'textarea'].includes(tag(el)) || (el as HTMLElement).isContentEditable || roleOf(el) === 'textbox' || roleOf(el) === 'searchbox';
  return { x: Math.round(localX + offset.x), y: Math.round(localY + offset.y), covered, coveredBy: covered && hit ? `${roleOf(hit)} "${labelOf(hit)}"` : undefined,
    editable, password: (el.getAttribute('type') || '').toLowerCase() === 'password', role: roleOf(el), label: labelOf(el) };
}

function fieldValue(ref: unknown) {
  const el = element(ref);
  const value = ['input', 'textarea'].includes(tag(el)) ? (el as HTMLInputElement).value : (el as HTMLElement).innerText ?? '';
  const focused = el.ownerDocument.activeElement === el || el.contains(el.ownerDocument.activeElement);
  return { length: value.length, focused, password: (el.getAttribute('type') || '').toLowerCase() === 'password', preview: (el.getAttribute('type') || '').toLowerCase() === 'password' ? '' : clean(value, 80) };
}

function scrollState() {
  const scroller = document.scrollingElement ?? document.documentElement;
  return { scrollY: Math.round(scroller.scrollTop), scrollHeight: Math.round(scroller.scrollHeight), viewportHeight: innerHeight, viewportWidth: innerWidth };
}

function selectContent(ref: unknown) {
  const el = element(ref);
  if (['input', 'textarea'].includes(tag(el))) (el as HTMLInputElement).select();
  else el.ownerDocument.getSelection()?.selectAllChildren(el);
  return { selected: true };
}

const operations: Record<string, (args: Record<string, unknown>) => unknown> = {
  snapshot: () => snapshot(), locate: args => locate(args.ref), value: args => fieldValue(args.ref), scroll: () => scrollState(), select: args => selectContent(args.ref),
};

ipcRenderer.on('hermes-browser:request', (_event, message: { id?: unknown; op?: unknown; args?: unknown }) => {
  if (typeof message?.id !== 'string' || typeof message.op !== 'string' || !operations[message.op]) return;
  try {
    const result = operations[message.op](message.args && typeof message.args === 'object' ? message.args as Record<string, unknown> : {});
    ipcRenderer.send('hermes-browser:response', { id: message.id, ok: true, result });
  } catch (error) {
    const failure = error as Error & { code?: string };
    ipcRenderer.send('hermes-browser:response', { id: message.id, ok: false, code: failure.code ?? 'failed', message: String(failure.message ?? failure).slice(0, 300) });
  }
});

// Client Hints source of truth: the engine's own navigator.userAgentData (read, never modified).
const reportUserAgent = () => {
  const data = (navigator as Navigator & { userAgentData?: { brands: { brand: string; version: string }[]; mobile: boolean; platform: string } }).userAgentData;
  if (data) ipcRenderer.send('hermes-browser:user-agent', { brands: data.brands.map(b => ({ brand: b.brand, version: b.version })), mobile: data.mobile, platform: data.platform });
};
if (location.protocol === 'https:' || location.protocol === 'http:') reportUserAgent();
