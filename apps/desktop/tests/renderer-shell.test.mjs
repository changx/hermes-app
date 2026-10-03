import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

const desktopRoot = new URL("..", import.meta.url).pathname;
const result = await build({
  stdin: {
    contents: `
      import { createElement } from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { DesktopShellView } from "./src/renderer/shell.tsx";
      export const markup = renderToStaticMarkup(createElement(DesktopShellView, { snapshot: {
        revision: 1,
        phase: "connected",
        connectionState: "suspended",
        connectionLabel: "Offline",
        channels: [],
        threads: [],
        messages: [],
        interactions: [],
        canLoadOlder: false,
      }}));
      export const toolMarkup = renderToStaticMarkup(createElement(DesktopShellView, { snapshot: {
        revision: 1, phase: "connected", connectionState: "online", connectionLabel: "Connected",
        channels: [], threads: [], selectedThreadId: "fixture-thread", selectedThreadTitle: "Fixture",
        messages: [{ id: "fixture-message", role: "assistant", text: "Public explanation", attachments: [],
          toolCalls: [{ id: "first-tool", name: "terminal", label: "Run command", detail: "printf '<hello>'" },
            { id: "second-tool", name: "read_file", label: "Read file" }] }],
        interactions: [], canLoadOlder: false,
      }}));
    `,
    loader: "tsx",
    resolveDir: desktopRoot,
  },
  bundle: true,
  external: ["react", "react-dom/server", "react/jsx-runtime"],
  format: "cjs",
  platform: "node",
  write: false,
});
const renderedModule = { exports: {} };
const loadBundle = new Function(
  "require",
  "module",
  "exports",
  result.outputFiles[0].text,
);
loadBundle(
  createRequire(import.meta.url),
  renderedModule,
  renderedModule.exports,
);
const markup = renderedModule.exports.markup;
const styles = await readFile(
  new URL("../src/renderer/styles.css", import.meta.url),
  "utf8",
);
const rendererEntry = await readFile(
  new URL("../src/renderer/index.tsx", import.meta.url),
  "utf8",
);
const errorBoundary = await readFile(
  new URL("../src/renderer/error-boundary.tsx", import.meta.url),
  "utf8",
);

test("renderer shell contains activity rail, tree panel and conversation", () => {
  assert.match(markup, /<main[^>]+aria-label="Hermes desktop"/);
  assert.match(markup, /aria-label="Navigation tools"/);
  assert.match(markup, /aria-labelledby="navigation-heading"/);
  assert.match(markup, /aria-labelledby="conversation-heading"/);
  assert.match(markup, /aria-label="Channels and threads"/);
  assert.match(markup, /aria-label="Toggle navigation"/);
  assert.match(markup, /aria-label="Switch thread"/);
  assert.match(markup, /Choose a thread/);
});

test("write actions reflect the current selection", () => {
  assert.match(markup, /aria-label="Create a channel"/);
  assert.doesNotMatch(markup, /aria-label="Create a channel"[^>]+disabled/);
  assert.match(markup, /aria-label="Create a session"[^>]+disabled/);
  assert.match(markup, /aria-label="Message"[^>]+disabled/);
  assert.match(markup, /aria-label="Send message"[^>]+disabled/);
});

test("narrow layout keeps rail and exposes panel as an overlay", () => {
  assert.match(styles, /@media \(max-width: 900px\)/);
  assert.match(styles, /\.navigation-panel\s*{[^}]*position: fixed/s);
  assert.match(styles, /\.navigation-panel\[hidden\]\s*{\s*display: none;/);
  assert.match(styles, /\.desktop-shell\.panel-collapsed/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});

test("window stays fixed while each pane scrolls its own content", () => {
  assert.match(styles, /html,\s*body,\s*#root\s*{[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/s);
  assert.match(styles, /\.desktop-shell\s*{[^}]*height:\s*100dvh;[^}]*overflow:\s*hidden;/s);
  assert.match(styles, /\.pane\s*{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
  assert.match(styles, /\.navigation-panel\s*{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto;/s);
  assert.match(styles, /\.item-list\s*{[^}]*min-height:\s*0;[^}]*overflow:\s*auto;/s);
  assert.match(styles, /\.timeline-wrap\s*{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
  assert.match(styles, /\.message-list\s*{[^}]*height:\s*100%;[^}]*overflow:\s*auto;/s);
});

test("renderer has a user-safe top-level error boundary", () => {
  assert.match(rendererEntry, /<ShellErrorBoundary>/);
  assert.match(errorBoundary, /getDerivedStateFromError/);
  assert.match(errorBoundary, /role="alert"/);
  assert.match(errorBoundary, /Hermes couldn’t open/);
  assert.doesNotMatch(errorBoundary, /error\.message|error\.stack/);
});

test("tool records render expanded, in order, and escape command text", () => {
  const tools = renderedModule.exports.toolMarkup;
  assert.doesNotMatch(tools, /<details\b|<summary\b/);
  assert.match(tools, /class="tool-record" aria-label="Run command"/);
  assert.match(tools, /<pre class="tool-command">printf &#x27;&lt;hello&gt;&#x27;<\/pre>/);
  assert.ok(tools.indexOf('aria-label="Run command"') < tools.indexOf('aria-label="Read file"'));
});

test("conversation uses compact fixed gutters without a centered width cap", () => {
  assert.match(styles, /\.message-list\s*{[^}]*padding:\s*18px 0;/);
  assert.match(styles, /\.message\s*{[^}]*padding-inline:\s*14px;/);
  assert.match(styles, /\.message\s*{[^}]*max-width:\s*none;[^}]*margin:\s*0 0 20px;/);
  assert.doesNotMatch(styles, /padding:[^;]*8vw/);
});

test("renderer source has no Node or Electron imports", () => {
  const rendererSource = `${rendererEntry}\n${errorBoundary}`;
  assert.doesNotMatch(rendererSource, /from ["'](?:electron|node:)/);
  assert.doesNotMatch(rendererSource, /\brequire\s*\(/);
});