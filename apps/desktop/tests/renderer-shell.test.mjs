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

test("renderer shell contains three labelled desktop regions", () => {
  assert.match(markup, /<main[^>]+aria-label="Hermes desktop"/);
  assert.match(markup, /aria-labelledby="channels-heading"/);
  assert.match(markup, /aria-labelledby="threads-heading"/);
  assert.match(markup, /aria-labelledby="conversation-heading"/);
  assert.match(markup, />Channels</);
  assert.match(markup, />Threads</);
  assert.match(markup, />Choose a thread</);
});

test("write actions reflect the current selection", () => {
  assert.match(markup, /aria-label="Create a channel"/);
  assert.doesNotMatch(markup, /aria-label="Create a channel"[^>]+disabled/);
  assert.match(markup, /aria-label="Create a topic"[^>]+disabled/);
  assert.match(markup, /aria-label="Message"[^>]+disabled/);
  assert.match(markup, /<button[^>]+disabled[^>]*>Send<\/button>/);
});

test("responsive layout hides panes without conditionally unmounting them", () => {
  assert.match(styles, /@media \(max-width: 1024px\)/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /\.channels-pane\s*{\s*display: none;/);
  assert.match(styles, /\.threads-pane\s*{\s*display: none;/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});

test("window stays fixed while each pane scrolls its own content", () => {
  assert.match(styles, /html,\s*body,\s*#root\s*{[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/s);
  assert.match(styles, /\.desktop-shell\s*{[^}]*height:\s*100dvh;[^}]*overflow:\s*hidden;/s);
  assert.match(styles, /\.pane\s*{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
  assert.match(styles, /\.channels-pane\s*{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto;/s);
  assert.match(styles, /\.threads-pane\s*{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);
  assert.match(styles, /\.threads-pane \.item-list\s*{[^}]*flex:\s*1;/s);
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

test("renderer source has no Node or Electron imports", () => {
  const rendererSource = `${rendererEntry}\n${errorBoundary}`;
  assert.doesNotMatch(rendererSource, /from ["'](?:electron|node:)/);
  assert.doesNotMatch(rendererSource, /\brequire\s*\(/);
});