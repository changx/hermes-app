import type { ReactNode } from 'react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { DesktopAppIconId, DesktopAppIconState, DesktopSnapshot } from '../shared/desktop-api';
import { ConnectionPage, ConnectionSettings } from './connection-settings';
import { DEFAULT_FONT_SIZE, FONT_SIZES, fontLoadFailed, getFontSize, setFontSize } from './font-preference';

/**
 * Settings are grouped by where they take effect:
 * - Connections: each saved Hermes. Its page separates settings on that Hermes
 *   (every device) from settings kept on this device.
 * - This device: preferences stored only in this app on this computer, for every connection.
 */
export type SettingsPage = 'connection' | `connection:${string}` | 'font' | 'icon' | 'shortcuts';
type Page = SettingsPage;
type NavItem = { id: Page; label: string; detail?: string; issue?: boolean };

const APP_ICON_CHOICES: readonly { id: DesktopAppIconId; label: string }[] = [
  { id: 'mochi', label: 'Mochi' }, { id: 'bubble', label: 'Bubble' }, { id: 'orb', label: 'Orb' },
];

function AppIconSettings() {
  const [state, setState] = useState<DesktopAppIconState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    window.hermesDesktop.getAppIcon().then(value => { if (live) setState(value); })
      .catch(() => { if (live) setError('Your app icon choice could not be loaded.'); });
    return () => { live = false; };
  }, []);
  const choose = (icon: DesktopAppIconId) => {
    if (saving || state?.icon === icon) return;
    setSaving(true); setError('');
    window.hermesDesktop.setAppIcon(icon).then(setState)
      .catch(() => setError('Could not change the app icon. Your current icon is still in use.'))
      .finally(() => setSaving(false));
  };
  return <div className="settings-section">
    <p className="settings-description">Changes the Hermes icon in the Dock on this computer while Hermes is open. Finder and Launchpad keep the default icon.</p>
    {state && !state.dock && <p className="settings-description">The Dock icon is available on macOS. Your choice is saved for this computer.</p>}
    <div className="settings-icon-options" role="radiogroup" aria-label="App icon">{APP_ICON_CHOICES.map(choice => {
      const selected = state?.icon === choice.id;
      return <button key={choice.id} type="button" role="radio" aria-checked={selected} disabled={!state || saving}
        className={selected ? 'selected' : undefined} onClick={() => choose(choice.id)}>
        <img src={`app-icons/${choice.id}.png`} alt="" width={64} height={64} /><span>{choice.label}</span>
      </button>;
    })}</div>
    {error && <p role="alert">{error}</p>}
  </div>;
}

function FontSettings() {
  const [size, setSize] = useState(getFontSize);
  const [error, setError] = useState(() => fontLoadFailed() ? 'Your saved text size could not be loaded. Choose a size to save it again.' : '');
  const change = (value: number) => {
    const saved = setFontSize(value); setSize(getFontSize());
    setError(saved ? '' : 'This text size applies now, but could not be saved. It may reset when you reopen the app.');
  };
  return <div className="settings-section">
    <p className="settings-description">Applies to interface and message text on this device, for every connection. Changes apply immediately and remain after you reopen the app.</p>
    <label className="settings-field">Text size<select autoFocus aria-label="Text size" value={size} onChange={event => change(Number(event.target.value))}>{FONT_SIZES.map(value => <option key={value} value={value}>{value} px{value === DEFAULT_FONT_SIZE ? ' (default)' : ''}</option>)}</select></label>
    <div className="settings-preview"><span className="settings-description">Preview</span><p>The quick brown fox jumps over the lazy dog.</p><code>const message = 'Hello, Hermes';</code></div>
    {error && <p role="alert">{error}</p>}
    <button type="button" className="secondary" onClick={() => change(DEFAULT_FONT_SIZE)}>Reset to 16</button>
  </div>;
}

function Shortcuts() {
  const mac = window.hermesDesktop.getRuntimeInfo().platform === 'darwin';
  const modifier = mac ? '⌘' : 'Ctrl';
  const rows = [
    ['Send message', ['Enter']], ['New line', ['Shift', 'Enter']],
    ['Find a session', [modifier, 'K']], ['New chat', [modifier, 'N']],
    ['New tab', [modifier, 'T']], ['Close current tab', [modifier, 'W']],
    ['Next tab', [modifier, 'Tab']], ['Previous tab', [modifier, 'Shift', 'Tab']],
    ['Mark or remove todo', [modifier, 'Shift', 'L']],
    ['Paste text or files', [modifier, 'V']], ['Open Settings', [modifier, ',']], ['Close Settings or dialog', ['Esc']],
  ] as const;
  return <div className="settings-section"><p className="settings-description">Keyboard shortcuts work while Hermes is focused. These shortcuts are fixed in this version.</p><dl className="settings-shortcuts">{rows.map(([label, keys]) => <div key={label}><dt>{label}</dt><dd>{keys.map(key => <kbd key={key}>{key}</kbd>)}</dd></div>)}</dl></div>;
}

const PAGE_KEY = 'hermes.desktop.settings-page';
const savedPage = (): string | undefined => {
  try { return window.localStorage.getItem(PAGE_KEY) ?? undefined; } catch { return undefined; }
};
/** DOM-safe element id; connection ids are stored data, not trusted selector text. */
export const settingsTabId = (page: string) => `settings-tab-${page.startsWith('connection:')
  ? 'connection-' + Array.from(page.slice(11), c => /[A-Za-z0-9_-]/.test(c) ? c : `_${c.charCodeAt(0).toString(16)}`).join('') : page}`;

/** Full content of the native Settings window: grouped left navigation, right content. */
export function SettingsPage({ snapshot }: { snapshot: DesktopSnapshot }) {
  const root = useRef<HTMLElement>(null);
  const rows = snapshot.connections ?? [];
  const groups: { title: string; items: NavItem[] }[] = [
    { title: 'Connections', items: [{ id: 'connection', label: 'All connections' },
      ...rows.map(row => ({ id: `connection:${row.id}` as Page, label: row.name, detail: row.server, issue: row.state === 'blocked' }))] },
    { title: 'This device', items: [{ id: 'font', label: 'Font size' }, { id: 'icon', label: 'App icon' }, { id: 'shortcuts', label: 'Shortcuts' }] },
  ];
  const items = groups.flatMap(group => group.items);
  const known = (value?: string): value is Page => !!value && items.some(item => item.id === value);
  // The window's first snapshot can be empty; until the user chooses, the default
  // follows the current connection once the real snapshot arrives.
  const [chosen, updatePage] = useState<string | undefined>(savedPage);
  const fallback = rows.find(row => row.connectionKey && row.connectionKey === snapshot.connectionKey) ?? rows.find(row => row.connectionKey);
  // Unknown, removed or former ("model") pages resolve to the current connection, else the overview.
  const page: Page = known(chosen) ? chosen : fallback && (chosen === undefined || chosen === 'model') ? `connection:${fallback.id}` : 'connection';
  // After the user picks a page, later snapshots never move focus.
  const userChose = useRef(false);
  const setPage = (value: Page) => { userChose.current = true; updatePage(value); try { window.localStorage.setItem(PAGE_KEY, value); } catch { /* Navigation still works for this window. */ } };
  const shown = page;
  // The first snapshot can be empty, so the default page can change once the real one
  // arrives. Until the user chooses, keep focus on the page actually shown; otherwise the
  // old tab keeps a focus ring beside the new selection.
  useEffect(() => {
    if (userChose.current) return;
    root.current?.querySelector<HTMLElement>(shown === 'font' ? '[aria-label="Text size"]' : '[role="tab"][aria-selected="true"]')?.focus();
  }, [shown]);
  const navigationKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (!delta && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + delta + items.length) % items.length;
    setPage(items[next].id); root.current?.querySelector<HTMLButtonElement>(`#${settingsTabId(items[next].id)}`)?.focus();
  };
  const current = items.find(item => item.id === shown);
  // Mount a connection page on first visit, then keep it until Settings closes.
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set());
  if (shown.startsWith('connection:') && !visited.has(shown)) setVisited(new Set(visited).add(shown));
  return <main ref={root} className="settings-window" aria-label="Settings">
    <div className="settings-layout"><nav className="settings-nav" role="tablist" aria-label="Settings sections" aria-orientation="vertical">{groups.map(group => <div key={group.title} className="settings-nav-group" role="presentation">
      <div className="settings-nav-title" role="presentation">{group.title}</div>
      {group.items.map(item => <button key={item.id} id={settingsTabId(item.id)} type="button" role="tab" className={item.id.startsWith('connection:') ? 'settings-nav-connection' : undefined} aria-selected={shown === item.id} aria-controls="settings-panel" tabIndex={shown === item.id ? 0 : -1} title={item.detail} onClick={() => setPage(item.id)} onKeyDown={event => navigationKey(event, items.indexOf(item))}>{item.label}{item.issue && <span className="settings-nav-issue"> · Needs attention</span>}</button>)}
    </div>)}</nav>
      <section className="settings-content" id="settings-panel" role="tabpanel" aria-labelledby={settingsTabId(shown)} tabIndex={0}>
        <h3>{shown === 'connection' ? 'Connections' : current?.label}</h3>
        {shown === 'connection' && <ConnectionSettings snapshot={snapshot} onOpen={id => setPage(`connection:${id}`)} />}
        {/* Connection pages stay mounted so model drafts and warnings survive page switches. */}
        {rows.filter(row => visited.has(`connection:${row.id}`) || shown === `connection:${row.id}`).map(row => <div key={row.id} hidden={shown !== `connection:${row.id}`}><ConnectionPage row={row} disabled={!!snapshot.connectionsError} /></div>)}
        {shown === 'font' && <FontSettings />}
        {shown === 'icon' && <AppIconSettings />}
        {shown === 'shortcuts' && <Shortcuts />}
      </section>
    </div>
  </main>;
}

/** Opens (or focuses) the native Settings window. The current page stays visible and usable. */
// `tooltip`: the page draws an in-app tooltip (TooltipLayer) instead of the native title.
export function SettingsButton({ className, icon, tooltip }: { className?: string; icon?: ReactNode; tooltip?: boolean }) {
  const [error, setError] = useState('');
  return <><button type="button" className={className} title={tooltip ? undefined : "Settings"} data-tooltip={tooltip ? "Settings" : undefined} aria-label="Settings" onClick={() => { setError(''); void window.hermesDesktop.openSettings().catch(() => setError('Settings could not be opened. Try again.')); }}>{icon ?? '⚙'}</button>{error && <span role="alert" className="settings-open-error">{error}</span>}</>;
}
