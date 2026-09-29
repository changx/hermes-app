import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";
import type { PairingRequest } from "../shared/desktop-api";
import { DesktopConnectionService } from "./connection-service";
import { isAllowedExternalUrl, isSameDocumentNavigation } from "./security";

const SNAPSHOT_EVENT = "desktop:snapshot";
let mainWindow: BrowserWindow | null = null;

const service = new DesktopConnectionService((snapshot) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(SNAPSHOT_EVENT, snapshot);
});

const trustedSender = (event: Electron.IpcMainInvokeEvent): void => {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame?.url !== mainWindow.webContents.getURL()) {
    throw new Error("Untrusted desktop request");
  }
};

const text = (value: unknown, maximum: number): string => {
  if (typeof value !== "string" || value.length > maximum) throw new Error("Invalid desktop request");
  return value;
};

const registerDesktopApi = (): void => {
  ipcMain.handle("desktop:get-snapshot", (event) => { trustedSender(event); return service.snapshot(); });
  ipcMain.handle("desktop:pair", async (event, value: unknown) => {
    trustedSender(event);
    if (!value || typeof value !== "object") throw new Error("Invalid desktop request");
    const request = value as Partial<PairingRequest>;
    await service.pair({ baseUrl: text(request.baseUrl, 300), code: text(request.code, 32), deviceName: text(request.deviceName, 64) });
  });
  ipcMain.handle("desktop:cancel-pairing", async (event) => { trustedSender(event); await service.cancelPairing(); });
  ipcMain.handle("desktop:forget-connection", async (event) => { trustedSender(event); await service.forgetConnection(); });
  ipcMain.handle("desktop:select-channel", async (event, id: unknown) => { trustedSender(event); await service.selectChannel(text(id, 200)); });
  ipcMain.handle("desktop:select-thread", async (event, id: unknown) => { trustedSender(event); await service.selectThread(text(id, 200)); });
  ipcMain.handle("desktop:retry-connection", async (event) => { trustedSender(event); await service.retryConnection(); });
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
      webviewTag: false,
      allowRunningInsecureContent: false,
    },
  });
  mainWindow = window;

  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!isSameDocumentNavigation(window.webContents.getURL(), url)) event.preventDefault();
  });
  window.webContents.on("will-redirect", (event) => event.preventDefault());
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => { if (mainWindow === window) mainWindow = null; });
  void window.loadFile(join(__dirname, "../renderer/index.html"));
  return window;
};

app.whenReady().then(async () => {
  registerDesktopApi();
  createMainWindow();
  await service.initialize();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
});

app.on("before-quit", () => service.close());
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
