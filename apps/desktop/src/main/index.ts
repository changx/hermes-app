import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";

const isAllowedExternalUrl = (rawUrl: string): boolean => {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:";
  } catch {
    return false;
  }
};

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
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });

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
