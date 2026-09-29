import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { transform } from "esbuild";

const mainSource = await readFile(
  new URL("../src/main/index.ts", import.meta.url),
  "utf8",
);
const preloadSource = await readFile(
  new URL("../src/preload/index.ts", import.meta.url),
  "utf8",
);
const html = await readFile(
  new URL("../src/renderer/index.html", import.meta.url),
  "utf8",
);

const loadSecurityModule = async () => {
  const source = await readFile(
    new URL("../src/main/security.ts", import.meta.url),
    "utf8",
  );
  const { code } = await transform(source, { format: "esm", loader: "ts" });
  return import(`data:text/javascript,${encodeURIComponent(code)}`);
};

test("BrowserWindow keeps the required isolation boundary", () => {
  assert.match(mainSource, /nodeIntegration:\s*false/);
  assert.match(mainSource, /contextIsolation:\s*true/);
  assert.match(mainSource, /sandbox:\s*true/);
  assert.match(mainSource, /webSecurity:\s*true/);
  assert.match(mainSource, /webviewTag:\s*false/);
  assert.match(mainSource, /allowRunningInsecureContent:\s*false/);
});

test("desktop shell denies renderer permissions and embedded webviews", () => {
  assert.match(mainSource, /setPermissionCheckHandler\(\(\) => false\)/);
  assert.match(mainSource, /setPermissionRequestHandler/);
  assert.match(mainSource, /callback\(false\)/);
  assert.match(mainSource, /will-attach-webview/);
  assert.match(mainSource, /event\.preventDefault\(\)/);
});

test("preload exposes only frozen runtime information", () => {
  assert.match(preloadSource, /contextBridge\.exposeInMainWorld/);
  assert.match(preloadSource, /Object\.freeze/);
  assert.doesNotMatch(preloadSource, /ipcRenderer|shell|node:fs|child_process/);
});

test("external URL policy allows only credential-free HTTPS URLs", async () => {
  const { isAllowedExternalUrl, isSameDocumentNavigation } =
    await loadSecurityModule();

  assert.equal(isAllowedExternalUrl("https://example.com/docs"), true);
  assert.equal(isAllowedExternalUrl("https://user@example.com/docs"), false);
  assert.equal(isAllowedExternalUrl("http://example.com"), false);
  assert.equal(isAllowedExternalUrl("file:///etc/passwd"), false);
  assert.equal(isAllowedExternalUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedExternalUrl("not a URL"), false);
  assert.equal(isSameDocumentNavigation("file:///app/index.html", "file:///app/index.html"), true);
  assert.equal(isSameDocumentNavigation("file:///app/index.html", "https://example.com"), false);
});

test("renderer policy has no remote or inline script capability", () => {
  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'self'/);
  assert.doesNotMatch(html, /'unsafe-inline'|'unsafe-eval'|https:\s/);
});