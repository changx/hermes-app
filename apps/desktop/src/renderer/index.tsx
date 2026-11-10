import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ShellErrorBoundary } from "./error-boundary";
import { DesktopShell } from "./shell";
import { SettingsPage } from './settings';
import { useDesktopSnapshot } from './desktop-store';
import { initializeFontSize } from './font-preference';
import { BrowserSidebar } from './browser-sidebar';
import { FindBar } from './find-bar';
import { RemoteScreenPage } from './remote-screen-page';

initializeFontSize();

const SettingsWindow = () => <SettingsPage snapshot={useDesktopSnapshot()} />;
const role = window.hermesDesktop?.getRuntimeInfo?.().viewRole;
const settingsWindow = role === 'settings';
if (settingsWindow) document.title = 'Settings';
// A Session's separate browser window: toolbar and page slot only.
// A connection's Remote browser window (docs/remote-screen.md): the remote screen only.
const RemoteScreenWindow = () => { const snapshot = useDesktopSnapshot(); return <RemoteScreenPage snapshot={snapshot} />; };
const BrowserWindowPage = () => { const snapshot = useDesktopSnapshot(); return snapshot.browser ? <main className="browser-window-page"><BrowserSidebar state={snapshot.browser} visible mode="window" /></main> : null; };

const root = document.querySelector("#root");
if (!(root instanceof HTMLElement)) throw new Error("Desktop root is unavailable");

createRoot(root).render(
  <StrictMode>
    <ShellErrorBoundary>
      {settingsWindow ? <SettingsWindow /> : role === 'browser' ? <BrowserWindowPage /> : role === 'remote-screen' ? <RemoteScreenWindow /> : <DesktopShell />}
      {role === 'tab' && <FindBar />}
    </ShellErrorBoundary>
  </StrictMode>,
);