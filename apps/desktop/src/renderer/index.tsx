import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const DesktopShell = () => (
  <main className="desktop-shell">
    <aside>Channels</aside>
    <aside>Threads</aside>
    <section>Conversation</section>
  </main>
);

const root = document.querySelector("#root");
if (!(root instanceof HTMLElement)) throw new Error("Desktop root is unavailable");

createRoot(root).render(
  <StrictMode>
    <DesktopShell />
  </StrictMode>,
);