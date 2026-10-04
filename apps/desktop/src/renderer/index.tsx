import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ShellErrorBoundary } from "./error-boundary";
import { DesktopShell } from "./shell";
import { initializeFontSize } from './font-preference';

initializeFontSize();

const root = document.querySelector("#root");
if (!(root instanceof HTMLElement)) throw new Error("Desktop root is unavailable");

createRoot(root).render(
  <StrictMode>
    <ShellErrorBoundary>
      <DesktopShell />
    </ShellErrorBoundary>
  </StrictMode>,
);