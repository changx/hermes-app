import { useEffect, useRef, useState } from 'react';
import type { DesktopBrowserMode, DesktopBrowserState } from '../shared/desktop-api';

// Decorative stroke icons; each button carries its accessible name.
const PopOutIcon = () => <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.5 4.5h-4v11h11v-4M11.5 4.5h4v4M15.5 4.5l-6.5 6.5" /></svg>;
const DockIcon = () => <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 4.5h13v11h-13zM11.5 4.5v11" /></svg>;

/**
 * Browser toolbar and page slot. `mode="sidebar"`: right side of the main window.
 * `mode="window"`: the whole content of a Session's separate browser window.
 */
export function BrowserSidebar({ state, visible, mode = 'sidebar' }: { state: DesktopBrowserState; visible: boolean; mode?: DesktopBrowserMode }) {
  const [address, setAddress] = useState(state.url), [error, setError] = useState('');
  const content = useRef<HTMLDivElement>(null);
  const separate = mode === 'window';
  useEffect(() => { setAddress(state.url); setError(''); }, [state.url]);
  const invoke = (operation: Promise<void>) => { setError(''); void operation.catch(() => setError('The browser action failed. Use an HTTP or HTTPS address and try again.')); };
  const switchMode = () => { setError(''); void window.hermesDesktop.setBrowserMode(separate ? 'sidebar' : 'window').catch(() => setError('The browser could not be moved. Try again.')); };
  useEffect(() => {
    const element = content.current; if (!element) return;
    let disposed = false;
    const update = () => { const bounds = element.getBoundingClientRect(); void window.hermesDesktop.setBrowserBounds({ x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height, visible }).catch(() => { if (!disposed) setError('The browser view could not be positioned.'); }); };
    update(); const observer = new ResizeObserver(update); observer.observe(element); window.addEventListener('resize', update);
    return () => { disposed = true; observer.disconnect(); window.removeEventListener('resize', update); };
  }, [visible, !!state.error, !!error, state.control, !!state.notice]);
  const switchButton = <button type="button" className="browser-mode-toggle" aria-label={separate ? 'Show in sidebar' : 'Open in separate window'} title={separate ? 'Show in sidebar' : 'Open in separate window'} onClick={switchMode}>{separate ? <DockIcon /> : <PopOutIcon />}</button>;
  return <aside className={`browser-sidebar${separate ? ' browser-window' : ''}`} aria-label={separate ? 'Browser' : 'Attachment preview and browser'}>
    {!separate && <div className="browser-title"><span title={state.title}>{state.title || 'Browser'}</span>{switchButton}<button type="button" aria-label="Close preview sidebar" onClick={() => invoke(window.hermesDesktop.browserAction('close'))}>×</button></div>}
    <form className="browser-toolbar" onSubmit={event => { event.preventDefault(); invoke(window.hermesDesktop.openBrowser(address)); }}>
      <button type="button" aria-label="Back" disabled={!state.canGoBack} onClick={() => invoke(window.hermesDesktop.browserAction('back'))}>‹</button>
      <button type="button" aria-label="Forward" disabled={!state.canGoForward} onClick={() => invoke(window.hermesDesktop.browserAction('forward'))}>›</button>
      <button type="button" aria-label={state.loading ? 'Stop loading' : 'Reload'} onClick={() => invoke(window.hermesDesktop.browserAction(state.loading ? 'stop' : 'reload'))}>{state.loading ? '×' : '↻'}</button>
      <input aria-label="Browser address" type="text" spellCheck={false} autoComplete="off" maxLength={4096} value={address} placeholder="Enter web address" onChange={event => setAddress(event.target.value)} />
      <button type="submit" aria-label="Open address">→</button>
      {separate && switchButton}
    </form>
    {state.control && <div className={`browser-control browser-control-${state.control}`} role="status" aria-live="polite">
      <span>{state.controlMessage}</span>
      {state.control === 'agent' && <button type="button" onClick={() => invoke(window.hermesDesktop.browserControl('stop'))}>Stop</button>}
      {state.control === 'user' && <button type="button" onClick={() => invoke(window.hermesDesktop.browserControl('resume'))}>Let Hermes continue</button>}
      {state.control === 'waiting' && <button type="button" onClick={() => invoke(window.hermesDesktop.browserControl('done'))}>Done</button>}
    </div>}
    {(error || state.error) && <p className="browser-error" role="alert">{error || state.error}</p>}
    {!error && !state.error && state.notice && <p className="browser-notice" role="status">{state.notice}</p>}
    <div ref={content} className="browser-view-slot" aria-label="Browser page" />
  </aside>;
}
