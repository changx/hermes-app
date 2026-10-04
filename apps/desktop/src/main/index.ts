import { app, BrowserWindow, clipboard, ipcMain, powerMonitor, shell } from "electron";
import { parseSessionLink } from "../../../../packages/client/src/sessionLinks";
import { join } from "node:path";
import type { ChannelInput, PairingRequest, SendMessageInput, ThreadInput } from "../shared/desktop-api";
import { DesktopConnectionService } from "./connection-service";
import type { DesktopSnapshot } from "../shared/desktop-api";
import { snapshotDelta } from "../shared/snapshot-delta";
import { isAllowedExternalUrl, isSameDocumentNavigation } from "./security";

const SNAPSHOT_EVENT = "desktop:snapshot";
let mainWindow: BrowserWindow | null = null;
let publishedSnapshot: DesktopSnapshot | undefined;

const service = new DesktopConnectionService((snapshot) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(SNAPSHOT_EVENT, publishedSnapshot ? snapshotDelta(publishedSnapshot,snapshot) : snapshot);
    publishedSnapshot = snapshot;
  }
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
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid desktop request");
  return value as Record<string, unknown>;
};
const texts = (value: unknown, maximumItems: number, maximumLength: number): string[] => {
  if (!Array.isArray(value) || value.length > maximumItems) throw new Error("Invalid desktop request");
  return value.map((item) => text(item, maximumLength));
};

const registerDesktopApi = (): void => {
  ipcMain.handle("desktop:open-session-link", (event, value: unknown) => { trustedSender(event); service.openSessionLink(text(value, 4096)); });
  ipcMain.handle("desktop:copy-session-link", (event) => { trustedSender(event); clipboard.writeText(service.sessionLink()); });
  ipcMain.handle("desktop:get-snapshot", (event) => { trustedSender(event); return service.snapshot(); });
  ipcMain.handle("desktop:pair", async (event, value: unknown) => {
    trustedSender(event);
    if (!value || typeof value !== "object") throw new Error("Invalid desktop request");
    const request = value as Partial<PairingRequest>;
    await service.pair({ baseUrl: text(request.baseUrl, 300), code: text(request.code, 32), deviceName: text(request.deviceName, 64) });
  });
  ipcMain.handle("desktop:cancel-pairing", async (event) => { trustedSender(event); await service.cancelPairing(); });
  ipcMain.handle("desktop:forget-connection", async (event) => { trustedSender(event); await service.forgetConnection(); });
  ipcMain.handle("desktop:load-local-drafts", (event, id: unknown) => { trustedSender(event); return service.loadLocalDrafts(text(id, 24)); });
  ipcMain.handle("desktop:save-local-draft", (event, id: unknown, threadId: unknown, draft: unknown) => { trustedSender(event); return service.saveLocalDraft(text(id, 24), text(threadId, 200), draft); });
  ipcMain.handle("desktop:select-channel", async (event, id: unknown) => { trustedSender(event); await service.selectChannel(text(id, 200)); });
  ipcMain.handle("desktop:select-thread", async (event, id: unknown) => { trustedSender(event); await service.selectThread(text(id, 200)); });
  ipcMain.handle("desktop:result-read", async (event, id: unknown, version: unknown, ref: unknown) => { trustedSender(event); if (typeof version === "number" && typeof ref === "number") await service.markResultRead(text(id, 200), version, ref); });
  ipcMain.handle("desktop:retry-connection", async (event) => { trustedSender(event); await service.retryConnection(); });
  ipcMain.handle("desktop:create-channel", async (event, value: unknown) => { trustedSender(event); const input = object(value); await service.createChannel({ name: text(input.name, 120), description: text(input.description, 4000) } satisfies ChannelInput); });
  ipcMain.handle("desktop:update-channel", async (event, id: unknown, value: unknown) => { trustedSender(event); const input = object(value); await service.updateChannel(text(id, 200), { name: text(input.name, 120), description: text(input.description, 4000) }); });
  ipcMain.handle("desktop:delete-channel", async (event, id: unknown) => { trustedSender(event); await service.deleteChannel(text(id, 200)); });
  ipcMain.handle("desktop:create-thread", async (event, value: unknown) => { trustedSender(event); const input = object(value); return service.createThread({ title: text(input.title, 200), clientThreadId: text(input.clientThreadId, 80), ...(input.channelId === undefined ? {} : { channelId: text(input.channelId, 200) }) } satisfies ThreadInput); });
  ipcMain.handle("desktop:rename-thread", async (event, id: unknown, title: unknown) => { trustedSender(event); await service.renameThread(text(id, 200), text(title, 200)); });
  ipcMain.handle("desktop:archive-thread", async (event, id: unknown) => { trustedSender(event); await service.archiveThread(text(id, 200)); });
  ipcMain.handle("desktop:load-older", async (event) => { trustedSender(event); await service.loadOlder(); });
  ipcMain.handle("desktop:get-channel-info", async (event, id: unknown) => { trustedSender(event); return service.getChannelInfo(text(id, 200)); });
  ipcMain.handle("desktop:send-message", async (event, value: unknown) => { trustedSender(event); const input = object(value); await service.sendMessage({ text: text(input.text, 100_000), attachmentIds: texts(input.attachmentIds, 8, 200) } satisfies SendMessageInput); });
  ipcMain.handle("desktop:retry-message", async (event, id: unknown) => { trustedSender(event); await service.retryMessage(text(id, 128)); });
  ipcMain.handle("desktop:stop-thread", async (event) => { trustedSender(event); await service.stopThread(); });
  ipcMain.handle("desktop:cancel-queued", async (event, id: unknown) => { trustedSender(event); await service.cancelQueued(text(id, 200)); });
  ipcMain.handle("desktop:answer-interaction", async (event, id: unknown, choice: unknown) => { trustedSender(event); await service.answerInteraction(text(id, 200), text(choice, 4000)); });
  ipcMain.handle("desktop:pick-attachments", async (event, threadId: unknown) => { trustedSender(event); return service.pickAndUploadAttachments(threadId === undefined ? undefined : text(threadId, 200)); });
  ipcMain.handle("desktop:drop-attachments", async (event, paths: unknown, threadId: unknown) => { trustedSender(event); return service.uploadAttachmentPaths(texts(paths, 8, 4096), threadId === undefined ? undefined : text(threadId, 200)); });
  ipcMain.handle("desktop:delete-attachment", async (event, id: unknown) => { trustedSender(event); await service.deleteUnattachedAttachment(text(id, 200)); });
  ipcMain.handle("desktop:preview-image", async (event, id: unknown) => { trustedSender(event); return service.previewAttachmentImage(text(id, 200)); });
  ipcMain.handle("desktop:download-attachment", async (event, id: unknown, action: unknown) => { trustedSender(event); if (action !== "save" && action !== "open") throw new Error("Invalid desktop request"); await service.downloadAttachment(text(id, 200), action); });
};

const createMainWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    title: "Hermes",
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 520,
    show: false,
    backgroundColor: "#f9fafb",
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
    if (parseSessionLink(url)) service.openSessionLink(url);
    else if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (parseSessionLink(url)) { event.preventDefault(); service.openSessionLink(url); return; }
    if (!isSameDocumentNavigation(window.webContents.getURL(), url)) event.preventDefault();
  });
  window.webContents.on("will-redirect", (event) => event.preventDefault());
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => { if (mainWindow === window) mainWindow = null; });
  void window.loadFile(join(__dirname, "../renderer/index.html"));
  return window;
};

const focusSessionLink = (url: string): void => {
  if (!url.startsWith("hermesapp:")) return;
  service.openSessionLink(url);
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
  else if (app.isReady()) createMainWindow();
};
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on("open-url", (event, url) => { event.preventDefault(); if (ownsInstance) focusSessionLink(url); });
app.on("second-instance", (_event, argv) => { const url = argv.find(value => value.startsWith("hermesapp:")); if (url) focusSessionLink(url); });
app.whenReady().then(async () => {
  if (!ownsInstance) return;
  // Installed applications only; do not change OS associations in development.
  if (app.isPackaged) app.setAsDefaultProtocolClient("hermesapp");
  registerDesktopApi();
  powerMonitor.on("resume", () => { void service.resumeConnection(); });
  createMainWindow();
  await service.initialize();
  const url = process.argv.find(value => value.startsWith("hermesapp:"));
  if (url) focusSessionLink(url);
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
});

let readyToQuit = false;
let flushingDrafts = false;
app.on("before-quit", event => {
  if (readyToQuit) { service.close(); return; }
  event.preventDefault();
  if (flushingDrafts) return;
  flushingDrafts = true;
  void service.flushLocalDrafts().finally(() => { readyToQuit = true; app.quit(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
