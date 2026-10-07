import { useEffect, useRef, useState } from 'react';
import type { DesktopBrowserState } from '../shared/desktop-api';

export function BrowserSidebar({ state, visible }: { state: DesktopBrowserState; visible: boolean }) {
  const [address, setAddress] = useState(state.url), [error, setError] = useState('');
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => { setAddress(state.url); setError(''); }, [state.url]);
  const invoke = (operation: Promise<void>) => { setError(''); void operation.catch(() => setError('The browser action failed. Use an HTTP or HTTPS address and try again.')); };
  useEffect(() => {
    const element = content.current; if (!element) return;
    let disposed = false;
    const update = () => { const bounds = element.getBoundingClientRect(); void window.hermesDesktop.setBrowserBounds({ x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height, visible }).catch(() => { if (!disposed) setError('The browser view could not be positioned.'); }); };
    update(); const observer = new ResizeObserver(update); observer.observe(element); window.addEventListener('resize', update);
    return () => { disposed = true; observer.disconnect(); window.removeEventListener('resize', update); };
  }, [visible, !!state.error, !!error, state.control, !!state.notice]);
  return <aside className="browser-sidebar" aria-label="Attachment preview and browser">
    <div className="browser-title"><span title={state.title}>{state.title || 'Browser'}</span><button type="button" aria-label="Close preview sidebar" onClick={() => invoke(window.hermesDesktop.browserAction('close'))}>×</button></div>
    <form className="browser-toolbar" onSubmit={event => { event.preventDefault(); invoke(window.hermesDesktop.openBrowser(address)); }}>
      <button type="button" aria-label="Back" disabled={!state.canGoBack} onClick={() => invoke(window.hermesDesktop.browserAction('back'))}>‹</button>
      <button type="button" aria-label="Forward" disabled={!state.canGoForward} onClick={() => invoke(window.hermesDesktop.browserAction('forward'))}>›</button>
      <button type="button" aria-label={state.loading ? 'Stop loading' : 'Reload'} onClick={() => invoke(window.hermesDesktop.browserAction(state.loading ? 'stop' : 'reload'))}>{state.loading ? '×' : '↻'}</button>
      <input aria-label="Browser address" type="text" spellCheck={false} autoComplete="off" maxLength={4096} value={address} placeholder="Enter web address" onChange={event => setAddress(event.target.value)} />
      <button type="submit" aria-label="Open address">→</button>
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
