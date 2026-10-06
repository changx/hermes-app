import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ShellErrorBoundary } from "./error-boundary";
import { DesktopShell } from "./shell";
import { SettingsPage } from './settings';
import { useDesktopSnapshot } from './desktop-store';
import { initializeFontSize } from './font-preference';

initializeFontSize();

const SettingsWindow = () => <SettingsPage snapshot={useDesktopSnapshot()} />;
const settingsWindow = window.hermesDesktop?.getRuntimeInfo?.().viewRole === 'settings';
if (settingsWindow) document.title = 'Settings';

const root = document.querySelector("#root");
if (!(root instanceof HTMLElement)) throw new Error("Desktop root is unavailable");

createRoot(root).render(
  <StrictMode>
    <ShellErrorBoundary>
      {settingsWindow ? <SettingsWindow /> : <DesktopShell />}
    </ShellErrorBoundary>
  </StrictMode>,
);