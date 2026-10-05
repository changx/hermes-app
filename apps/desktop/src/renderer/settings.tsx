import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { AgentModelSettings, ModelSelectionConfirmation } from '@hermes-app/client';
import type { DesktopSnapshot } from '../shared/desktop-api';
import { ConnectionSettings } from './connection-settings';
import { DEFAULT_FONT_SIZE, FONT_SIZES, fontLoadFailed, getFontSize, setFontSize } from './font-preference';

export type SettingsPage = 'model' | 'font' | 'shortcuts' | 'connection';
type Page = SettingsPage;
const pages: { id: Page; label: string }[] = [
  { id: 'model', label: 'Default agent model' }, { id: 'font', label: 'Font size' },
  { id: 'shortcuts', label: 'Shortcuts' }, { id: 'connection', label: 'Connections' },
];

function ModelSettings({ connectionKey }: { connectionKey?: string }) {
  const [current, setCurrent] = useState<AgentModelSettings | null>(null);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmation, setConfirmation] = useState<ModelSelectionConfirmation | null>(null);
  const [reload, setReload] = useState(0);
  const alive = useRef(false);
  const working = useRef(false);
  useEffect(() => {
    let active = true;
    alive.current = true;
    if (!connectionKey) return () => { alive.current = false; };
    setBusy(true); setError(''); setNotice(''); setConfirmation(null); setCurrent(null);
    void window.hermesDesktop.getModelSettings(connectionKey).then(value => {
      if (active) { setCurrent(value); setProvider(value.provider); setModel(value.model); }
    }, () => { if (active) setError('Could not load model settings. Try again.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; alive.current = false; };
  }, [connectionKey, reload]);
  const save = async (confirm = false) => {
    if (!connectionKey || !current || busy || working.current || error || !provider || !model.trim()) return;
    if (confirm && (!confirmation || confirmation.provider !== provider || confirmation.model !== model.trim())) return;
    working.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await window.hermesDesktop.setModelSettings(connectionKey, provider, model.trim(), confirm);
      if (!alive.current) return;
      if ('confirmation_required' in result) { setConfirmation(result); return; }
      setCurrent(result); setProvider(result.provider); setModel(result.model); setConfirmation(null);
      setNotice('Default model saved.');
    } catch { if (alive.current) setError('Could not confirm the change. Reload settings before trying again.'); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  };
  const edited = () => { setConfirmation(null); setNotice(''); };
  const selected = current?.providers.find(item => item.id === provider);
  return <div className="settings-section">
    <p className="settings-description">Default for the connected Agent, across devices. Conversations with their own model selection keep it. Running replies are not interrupted.</p>
    {!connectionKey ? <p>Connect to Hermes to choose a default model.</p> : <>
      {busy && !current && <p role="status">Loading model settings…</p>}
      {current && <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <label className="settings-field">Provider<select aria-label="Provider" value={provider} disabled={busy} onChange={event => {
          const value = event.target.value; setProvider(value); setModel(value === current.provider ? current.model : ''); edited();
        }}>
          {!current.providers.some(item => item.id === provider) && <option value={provider}>{provider}</option>}
          {current.providers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label className="settings-field">Model<input aria-label="Model" list="settings-model-options" value={model} maxLength={256} disabled={busy} autoComplete="off" spellCheck={false} placeholder="Choose or enter a model name" onChange={event => { setModel(event.target.value); edited(); }} /></label>
        <datalist id="settings-model-options">{selected?.models.map(id => <option key={id} value={id} />)}</datalist>
        <p className="settings-description">Choose a suggested model or enter its name.</p>
        {confirmation ? <div className="settings-warning" role="status"><p>{confirmation.warning}</p><div className="settings-actions"><button type="button" disabled={busy || !!error} onClick={() => void save(true)}>Confirm model selection</button><button type="button" className="secondary" disabled={busy} onClick={() => setConfirmation(null)}>Cancel model selection</button></div></div> :
          <button type="submit" disabled={busy || !!error || !provider || !model.trim() || (provider === current.provider && model.trim() === current.model)}>{busy ? 'Saving model…' : 'Save model'}</button>}
      </form>}
      {error && <><p role="alert">{error}</p><button type="button" className="secondary" disabled={busy} onClick={() => setReload(value => value + 1)}>Reload model settings</button></>}
      {notice && <p role="status" className="settings-success">{notice}</p>}
    </>}
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
    <p className="settings-description">Applies to interface and message text on this device. Changes apply immediately and remain after you reopen the app.</p>
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
    ['Paste text or files', [modifier, 'V']], ['Close dialog', ['Esc']],
  ] as const;
  return <div className="settings-section"><p className="settings-description">Keyboard shortcuts work while Hermes is focused. These shortcuts are fixed in this version.</p><dl className="settings-shortcuts">{rows.map(([label, keys]) => <div key={label}><dt>{label}</dt><dd>{keys.map(key => <kbd key={key}>{key}</kbd>)}</dd></div>)}</dl></div>;
}

export function SettingsDialog({ snapshot, close, initialPage, onPageChange }: { snapshot: DesktopSnapshot; close: () => void; initialPage?: Page; onPageChange?: (page: Page) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<Element | null>(document.activeElement);
  const [page, updatePage] = useState<Page>(initialPage ?? (snapshot.connectionKey ? 'model' : 'font'));
  const setPage = (value: Page) => { updatePage(value); onPageChange?.(value); };
  const [modelKey, setModelKey] = useState(snapshot.connectionKey);
  const modelConnections = (snapshot.connections ?? []).filter(row => row.connectionKey);
  useEffect(() => {
    if (snapshot.connections && !modelConnections.some(row => row.connectionKey === modelKey)) setModelKey(modelConnections[0]?.connectionKey);
  }, [snapshot.connections, modelKey]);
  useEffect(() => {
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLElement>(page === 'font' ? '[aria-label="Text size"]' : '[role="tab"][aria-selected="true"]')?.focus();
    return () => { if (returnFocus.current instanceof HTMLElement && returnFocus.current.isConnected) returnFocus.current.focus(); };
  }, []);
  const navigationKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (!delta && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? pages.length - 1 : (index + delta + pages.length) % pages.length;
    setPage(pages[next].id); dialog.current?.querySelector<HTMLButtonElement>(`#settings-tab-${pages[next].id}`)?.focus();
  };
  return createPortal(<dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title" onClose={close} onMouseDown={event => {
    if (event.target !== dialog.current) return;
    const rect = dialog.current.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.current.close();
  }}>
    <header className="settings-header"><h2 id="settings-title">Settings</h2><button type="button" className="settings-close" aria-label="Close Settings" title="Close Settings (Esc)" onClick={() => dialog.current?.close()}>×</button></header>
    <div className="settings-layout"><nav className="settings-nav" role="tablist" aria-label="Settings sections" aria-orientation="vertical">{pages.map((item, index) => <button key={item.id} id={`settings-tab-${item.id}`} type="button" role="tab" aria-selected={page === item.id} aria-controls={`settings-panel-${item.id}`} tabIndex={page === item.id ? 0 : -1} onClick={() => setPage(item.id)} onKeyDown={event => navigationKey(event, index)}>{item.label}</button>)}</nav>
      <section className="settings-content" id={`settings-panel-${page}`} role="tabpanel" aria-labelledby={`settings-tab-${page}`} tabIndex={0}>
        <h3>{pages.find(item => item.id === page)?.label}</h3>
        <div hidden={page !== 'model'}>{modelConnections.length > 1 && <label className="settings-field">Agent connection<select aria-label="Agent connection" value={modelKey ?? ''} onChange={event => setModelKey(event.target.value)}>{modelConnections.map(row => <option key={row.id} value={row.connectionKey}>{row.name} — {row.server}</option>)}</select></label>}<ModelSettings key={modelKey ?? 'unpaired'} connectionKey={modelKey} /></div>
        {page === 'font' && <FontSettings />}
        {page === 'shortcuts' && <Shortcuts />}
        {page === 'connection' && <ConnectionSettings snapshot={snapshot} />}
      </section>
    </div>
  </dialog>, document.body);
}

export function SettingsButton({ snapshot, className }: { snapshot: DesktopSnapshot; className?: string }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className={className} title="Settings" aria-label="Settings" aria-haspopup="dialog" onClick={() => setOpen(true)}>⚙</button>{open && <SettingsDialog snapshot={snapshot} close={() => setOpen(false)} />}</>;
}
