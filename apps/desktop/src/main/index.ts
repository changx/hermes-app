import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { isAllowedExternalUrl, isSameDocumentNavigation } from "./security";

const createMainWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    title: "Hermes",
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 520,
    show: false,
    backgroundColor: "#f5f3ef",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
    },
  });

  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );

  window.webContents.on("will-attach-webview", (event) => event.preventDefault());

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (!isSameDocumentNavigation(window.webContents.getURL(), url)) {
      event.preventDefault();
    }
  });

  window.webContents.on("will-redirect", (event) => event.preventDefault());

  window.once("ready-to-show", () => window.show());
  void window.loadFile(join(__dirname, "../renderer/index.html"));
  return window;
};

app.whenReady().then(() => {
  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
