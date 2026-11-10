import { useCallback, useEffect, useRef, useState } from 'react';
import type RFB from '@novnc/novnc';
import type { DesktopSnapshot } from '../shared/desktop-api';
import { failureText, PortChannel, type RemoteScreenFailure } from '../shared/remote-screen';
import { macShortcut, CONTROL_L } from '../shared/remote-screen-keys';

export const ScreenIcon = () => <svg className="search-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="9" rx="1.5" /><path d="M5.5 14h5M8 11.5V14" /></svg>;

/** Retry delays while the screen is down; the page stays quiet until a retry fails. */
const RETRY_MS = [2_000, 5_000, 10_000, 30_000];
/** A hidden tab keeps its screen this long, then disconnects to save bandwidth. */
const HIDDEN_DISCONNECT_MS = 30_000;
const PORT_WAIT_MS = 10_000;

let library: Promise<typeof RFB> | undefined;
/** noVNC is its own script (novnc.js); only this page loads it, once per tab. */
function loadNoVNC(): Promise<typeof RFB> {
  const ready = () => (window as unknown as { HermesNoVNC?: typeof RFB }).HermesNoVNC;
  library ??= new Promise<typeof RFB>((resolve, reject) => {
    const loaded = ready(); if (loaded) { resolve(loaded); return; }
    const script = document.createElement('script');
    script.src = './novnc.js';
    script.onload = () => { const value = ready(); if (value) resolve(value); else reject(new Error('failed')); };
    script.onerror = () => reject(new Error('failed'));
    document.head.appendChild(script);
  }).catch(error => { library = undefined; throw error; });
  return library;
}

let requests = 0;
/** Asks the main process for this tab's screen and waits for its MessagePort. */
function openPort(): Promise<MessagePort> {
  const id = `rs-${Date.now()}-${++requests}`;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { window.removeEventListener('message', receive); reject(new Error('failed')); }, PORT_WAIT_MS);
    function receive(event: MessageEvent) {
      if (event.source !== window || event.data?.type !== 'hermes-remote-screen-port' || event.data.id !== id || !event.ports[0]) return;
      window.clearTimeout(timer); window.removeEventListener('message', receive); resolve(event.ports[0]);
    }
    window.addEventListener('message', receive);
    window.hermesDesktop.connectRemoteScreen(id).catch((error: Error) => {
      window.clearTimeout(timer); window.removeEventListener('message', receive);
      reject(new Error(/offline/.test(error.message) ? 'offline' : 'failed'));
    });
  });
}

type Phase = 'connecting' | 'connected' | 'down';

/** A Remote browser tab: the host's screen through noVNC (docs/remote-screen.md). */
export function RemoteScreenPage({ snapshot }: { snapshot: DesktopSnapshot }) {
  const name = snapshot.remoteScreen?.name ?? 'Remote browser';
  const online = snapshot.remoteScreen?.online === true;
  const active = snapshot.tabActive === true;
  const target = useRef<HTMLDivElement>(null);
  const rfb = useRef<RFB | null>(null);
  const [phase, setPhase] = useState<Phase>('connecting');
  const [failure, setFailure] = useState<RemoteScreenFailure | undefined>();
  const [control, setControl] = useState(false);
  const [wanted, setWanted] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const controlRef = useRef(control);
  controlRef.current = control;

  const disconnect = useCallback(() => { const current = rfb.current; rfb.current = null; current?.disconnect(); }, []);

  // Hidden for a while: disconnect; shown again: connect.
  useEffect(() => {
    if (active) { setWanted(true); return; }
    const timer = window.setTimeout(() => setWanted(false), HIDDEN_DISCONNECT_MS);
    return () => window.clearTimeout(timer);
  }, [active]);

  useEffect(() => {
    const element = target.current;
    if (!element || !wanted || !online) { if (!online) { setPhase('down'); setFailure('offline'); } return; }
    let cancelled = false, channel: PortChannel | undefined;
    setPhase('connecting');
    void Promise.all([loadNoVNC(), openPort()]).then(([NoVNC, port]) => {
      if (cancelled) { port.close(); return; }
      channel = new PortChannel(port);
      const view = new NoVNC(element, channel as unknown as WebSocket, { shared: true });
      view.scaleViewport = true; view.resizeSession = false; view.clipViewport = false;
      view.viewOnly = !controlRef.current; view.focusOnClick = true; view.showDotCursor = true;
      view.background = 'rgb(30, 30, 30)';
      view.addEventListener('connect', () => { if (!cancelled) { setPhase('connected'); setFailure(undefined); setAttempt(0); } });
      view.addEventListener('disconnect', () => {
        if (cancelled || rfb.current !== view) return;
        rfb.current = null; setPhase('down'); setFailure(channel?.failure ?? 'failed');
      });
      view.addEventListener('clipboard', (event: Event) => {
        const text = (event as CustomEvent<{ text?: string }>).detail?.text;
        if (typeof text === 'string' && text) void window.hermesDesktop.copyText(text).catch(() => {});
      });
      rfb.current = view;
    }, (error: Error) => {
      if (cancelled) return;
      setPhase('down'); setFailure(error.message === 'offline' ? 'offline' : 'failed');
    });
    return () => { cancelled = true; disconnect(); };
  }, [wanted, online, attempt, disconnect]);

  // Quiet automatic retry while the screen is down for a reason that can pass.
  useEffect(() => {
    if (phase !== 'down' || !wanted || !online || failure === 'unauthorized' || failure === 'unavailable') return;
    const timer = window.setTimeout(() => setAttempt(value => value + 1), RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]);
    return () => window.clearTimeout(timer);
  }, [phase, failure, wanted, online, attempt]);

  useEffect(() => {
    const view = rfb.current;
    if (!view) return;
    view.viewOnly = !control;
    if (control) view.focus();
  }, [control, phase]);

  // Mac shortcuts drive the Linux browser: Cmd+C/V/X/A/Z/F/L/R and friends become Ctrl.
  // Cmd+V first sends this Mac's clipboard text to the screen. Cmd itself never reaches it.
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const key = (event: KeyboardEvent) => {
      const view = rfb.current;
      if (!view || !controlRef.current) return;
      const shortcut = macShortcut(event);
      if (shortcut === undefined) return;
      event.preventDefault(); event.stopPropagation();
      if (shortcut === null || event.type !== 'keydown') return;
      const press = () => {
        if (shortcut.ctrl) view.sendKey(CONTROL_L, 'ControlLeft', true);
        view.sendKey(shortcut.keysym, shortcut.code);
        if (shortcut.ctrl) view.sendKey(CONTROL_L, 'ControlLeft', false);
      };
      if (shortcut.paste) void window.hermesDesktop.remoteScreenClipboard().catch(() => '').then(text => { if (text) view.clipboardPasteFrom(text); press(); });
      else press();
    };
    element.addEventListener('keydown', key, true);
    element.addEventListener('keyup', key, true);
    return () => { element.removeEventListener('keydown', key, true); element.removeEventListener('keyup', key, true); };
  }, []);

  const retry = () => { setFailure(undefined); setWanted(true); setAttempt(value => value + 1); };
  const message = phase === 'down' ? failureText(failure, name) : '';
  return <main className={`remote-screen-page${control && phase === 'connected' ? ' remote-screen-control' : ''}`}>
    <header className="remote-screen-header">
      <h1>{name}</h1>
      {phase === 'connected' && <span className="remote-screen-mode">{control ? 'You are using the screen' : 'View only'}</span>}
      <span className="remote-screen-spacer" />
      {phase === 'connected' && <button type="button" className="remote-screen-button" aria-pressed={control} onClick={() => setControl(value => !value)}>
        {control ? 'Stop using' : 'Use the screen'}</button>}
    </header>
    <div className="remote-screen-view" ref={target} />
    {message && <div className="remote-screen-notice" role="status"><p>{message}</p>
      {failure !== 'unavailable' && failure !== 'offline' && failure !== 'unauthorized' && <button type="button" className="remote-screen-button" onClick={retry}>Try again</button>}</div>}
  </main>;
}
