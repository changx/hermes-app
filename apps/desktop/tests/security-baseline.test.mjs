import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const desktopRoot = new URL("..", import.meta.url);
const readDesktopFile = (path) =>
  readFile(new URL(path, desktopRoot), "utf8");

const mainSource = await readDesktopFile("src/main/index.ts");
const preloadSource = await readDesktopFile("src/preload/index.ts");
const rendererHtml = await readDesktopFile("src/renderer/index.html");

const assertSecureMainSource = (source) => {
  assert.doesNotMatch(source, /nodeIntegration:\s*true/);
  assert.doesNotMatch(source, /contextIsolation:\s*false/);
  assert.doesNotMatch(source, /sandbox:\s*false/);
  assert.doesNotMatch(source, /webSecurity:\s*false/);
  assert.doesNotMatch(source, /webviewTag:\s*true/);
  assert.doesNotMatch(source, /allowRunningInsecureContent:\s*true/);
};

const assertSecureCsp = (html) => {
  const policy = html.match(/Content-Security-Policy[^>]+content="([^"]+)"/)?.[1];
  assert.ok(policy, "renderer CSP must be declared in HTML");
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /script-src 'self'/);
  assert.match(policy, /style-src 'self'/);
  assert.match(policy, /img-src 'self' data:/);
  assert.doesNotMatch(policy, /'unsafe-inline'|'unsafe-eval'|https:|http:/);
};

test("security gate rejects dangerous Electron preference mutations", () => {
  assertSecureMainSource(mainSource);
  assert.throws(() =>
    assertSecureMainSource(`${mainSource}\nnodeIntegration: true`),
  );
  assert.throws(() =>
    assertSecureMainSource(`${mainSource}\ncontextIsolation: false`),
  );
  assert.throws(() =>
    assertSecureMainSource(`${mainSource}\nwebSecurity: false`),
  );
});

test("security gate rejects remote or evaluated renderer scripts", () => {
  assertSecureCsp(rendererHtml);
  assert.throws(() =>
    assertSecureCsp(
      rendererHtml.replace("script-src 'self'", "script-src 'self' https:"),
    ),
  );
  assert.throws(() =>
    assertSecureCsp(
      rendererHtml.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'"),
    ),
  );
});

test("preload surface matches the approved read-only snapshot", () => {
  const worldNames = [
    ...preloadSource.matchAll(/exposeInMainWorld\(\s*["']([^"']+)["']/g),
  ].map((match) => match[1]);
  const exposedMethods = [
    ...preloadSource.matchAll(/^\s+([a-zA-Z][a-zA-Z0-9]*):\s*\(/gm),
  ].map((match) => match[1]);

  assert.deepEqual(worldNames, ["hermesDesktop"]);
  assert.deepEqual(exposedMethods, ["getRuntimeInfo"]);
  assert.doesNotMatch(
    preloadSource,
    /ipcRenderer|shell|webFrame|node:fs|child_process|process\.env/,
  );
  assert.throws(() =>
    assert.doesNotMatch(
      `${preloadSource}\nipcRenderer.invoke(request.channel, request.payload)`,
      /ipcRenderer|shell|webFrame|node:fs|child_process|process\.env/,
    ),
  );
});

test("renderer source tree cannot import privileged runtimes", async () => {
  const rendererDirectory = new URL("src/renderer/", desktopRoot);
  const files = (await readdir(rendererDirectory)).filter((name) =>
    /\.(?:ts|tsx|js|jsx)$/.test(name),
  );
  const sources = await Promise.all(
    files.map(async (name) => [name, await readFile(new URL(name, rendererDirectory), "utf8")]),
  );

  for (const [name, source] of sources) {
    assert.doesNotMatch(source, /from ["'](?:electron|node:)/, name);
    assert.doesNotMatch(source, /\brequire\s*\(/, name);
    assert.doesNotMatch(source, /https?:\/\//, name);
  }
});

test("build output contains only the expected runtime file classes", async () => {
  const expected = {
    main: ["index.cjs", "index.cjs.map"],
    preload: ["index.cjs", "index.cjs.map"],
    renderer: ["index.html", "index.js", "index.js.map", "styles.css"],
  };

  for (const [directory, expectedFiles] of Object.entries(expected)) {
    const actualFiles = (await readdir(new URL(`dist/${directory}/`, desktopRoot))).sort();
    assert.deepEqual(actualFiles, expectedFiles, directory);
  }
});