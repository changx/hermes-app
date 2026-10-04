import { app, BrowserWindow, clipboard, ipcMain, powerMonitor, shell } from "electron";
import { parseSessionLink } from "../../../../packages/client/src/sessionLinks";
import { validateLabels, labelTimestamp } from '../../../../packages/client/src/sessionLabels';
import { join } from "node:path";
import type { ChannelInput, PairingRequest, SendMessageInput, ThreadInput } from "../shared/desktop-api";
import { DesktopConnectionService } from "./connection-service";
import { DesktopTabManager } from './tab-manager';
import type { DesktopSnapshot } from "../shared/desktop-api";
import { snapshotDelta } from "../shared/snapshot-delta";
import { isAllowedExternalUrl, isSameDocumentNavigation } from "./security";

const SNAPSHOT_EVENT = "desktop:snapshot";
let mainWindow: BrowserWindow | null = null;
let publishedSnapshot: DesktopSnapshot | undefined;
let tabs: DesktopTabManager | undefined;

const service = new DesktopConnectionService((snapshot) => {
  if (tabs) { tabs.sync(snapshot); return; }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(SNAPSHOT_EVENT, publishedSnapshot ? snapshotDelta(publishedSnapshot,snapshot) : snapshot);
    publishedSnapshot = snapshot;
  }
});

const trustedSender = (event: Electron.IpcMainInvokeEvent): void => {
  if (!mainWindow || event.senderFrame !== event.sender.mainFrame) {
    throw new Error("Untrusted desktop request");
  }
  if (tabs) { tabs.authorize(event.sender, event.senderFrame?.url); return; }
  if (event.sender !== mainWindow.webContents || event.senderFrame?.url !== mainWindow.webContents.getURL()) throw new Error('Untrusted desktop request');
};
const shellSender = (event: Electron.IpcMainInvokeEvent): void => { trustedSender(event); if (event.sender !== mainWindow?.webContents) throw new Error('Shell action required'); };
const target = (event: Electron.IpcMainInvokeEvent): string => { trustedSender(event); if (!tabs) throw new Error('Window unavailable'); return tabs.target(event.sender); };

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
  ipcMain.handle('desktop:new-tab', (event, channelId: unknown) => { trustedSender(event); tabs?.newTab(channelId === undefined ? undefined : text(channelId, 200)); });
  ipcMain.handle('desktop:activate-tab', (event, id: unknown) => { shellSender(event); tabs?.activate(text(id, 200)); });
  ipcMain.handle('desktop:close-tab', (event, id: unknown) => { shellSender(event); tabs?.close(text(id, 200)); });
  ipcMain.handle('desktop:complete-new-tab', event => { trustedSender(event); tabs?.complete(event.sender); });
  ipcMain.handle('desktop:content-bounds', (event, value: unknown) => { shellSender(event); const bounds = object(value); tabs?.setBounds({ x: Number(bounds.x), y: Number(bounds.y), width: Number(bounds.width), height: Number(bounds.height), visible: bounds.visible === true }); });
  ipcMain.handle("desktop:open-session-link", (event, value: unknown) => { trustedSender(event); service.openSessionLink(text(value, 4096)); });
  ipcMain.handle("desktop:copy-session-link", (event) => { clipboard.writeText(service.sessionLink(target(event))); });
  ipcMain.handle("desktop:get-snapshot", (event) => { trustedSender(event); return tabs?.snapshot(event.sender) ?? service.snapshot(); });
  ipcMain.handle("desktop:pair", async (event, value: unknown) => {
    shellSender(event);
    if (!value || typeof value !== "object") throw new Error("Invalid desktop request");
    const request = value as Partial<PairingRequest>;
    await service.pair({ baseUrl: text(request.baseUrl, 300), code: text(request.code, 32), deviceName: text(request.deviceName, 64) });
  });
  ipcMain.handle("desktop:cancel-pairing", async (event) => { trustedSender(event); await service.cancelPairing(); });
  ipcMain.handle("desktop:forget-connection", async (event) => { shellSender(event); await service.forgetConnection(); });
  ipcMain.handle("desktop:load-local-drafts", async (event, id: unknown) => { trustedSender(event); const identity = text(id, 24), manager = tabs, tab = manager?.sender(event.sender), saved = await service.loadLocalDrafts(identity); if (manager !== tabs || identity !== service.snapshot().draftIdentity) throw new Error('Draft identity changed'); if (!tab) { manager?.draftThreads.clear(); for (const [threadId, draft] of Object.entries(saved)) if (draft.text.trim() || draft.attachments.length) manager?.draftThreads.add(threadId); manager?.publish(); return saved; } return tab.threadId && saved[tab.threadId] ? { [tab.threadId]: saved[tab.threadId] } : {}; });
  ipcMain.handle("desktop:save-local-draft", async (event, id: unknown, threadId: unknown, value: unknown) => { trustedSender(event); const targetId = text(threadId, 200), manager = tabs; if (manager?.sender(event.sender) && targetId !== target(event)) throw new Error('Draft target mismatch'); await service.saveLocalDraft(text(id, 24), targetId, value); if (manager !== tabs) return; const draft = object(value); if (typeof draft.text === 'string' && (draft.text.trim() || Array.isArray(draft.attachments) && draft.attachments.length)) manager?.draftThreads.add(targetId); else manager?.draftThreads.delete(targetId); manager?.publish(); });
  ipcMain.handle("desktop:select-channel", async (event, id: unknown) => { shellSender(event); await service.selectChannel(text(id, 200)); });
  ipcMain.handle("desktop:select-thread", async (event, id: unknown) => { trustedSender(event); await service.selectThread(text(id, 200)); });
  ipcMain.handle("desktop:close-session-page", (event, id: unknown) => { shellSender(event); const tab = [...tabs?.tabs.values() ?? []].find(item => item.threadId === text(id, 200)); if (tab) tabs?.close(tab.id); });
  ipcMain.handle("desktop:result-read", async (event, id: unknown, version: unknown, ref: unknown) => { const threadId = target(event), tab = tabs?.sender(event.sender); if (text(id, 200) !== threadId || tab && (tab.id !== tabs?.activeTabId || !tabs?.snapshot(event.sender).tabActive) || !mainWindow?.isFocused() || mainWindow.isMinimized()) return; if (typeof version === "number" && typeof ref === "number") await service.markResultRead(threadId, version, ref); });
  ipcMain.handle("desktop:retry-connection", async (event) => { trustedSender(event); await service.retryConnection(); });
  ipcMain.handle("desktop:create-channel", async (event, value: unknown) => { trustedSender(event); const input = object(value); await service.createChannel({ name: text(input.name, 120), description: text(input.description, 4000) } satisfies ChannelInput); });
  ipcMain.handle("desktop:update-channel", async (event, id: unknown, value: unknown) => { trustedSender(event); const input = object(value); await service.updateChannel(text(id, 200), { name: text(input.name, 120), description: text(input.description, 4000) }); });
  ipcMain.handle("desktop:delete-channel", async (event, id: unknown) => { trustedSender(event); await service.deleteChannel(text(id, 200)); });
  ipcMain.handle("desktop:create-thread", async (event, value: unknown) => {
    trustedSender(event); const input = object(value), tab = tabs?.sender(event.sender);
    const request = { title: text(input.title, 200), clientThreadId: text(input.clientThreadId, 80), ...(input.channelId === undefined ? {} : { channelId: text(input.channelId, 200) }) } satisfies ThreadInput;
    if (!tab) return service.createThread(request);
    if (tab.kind !== 'new' || tab.threadId && tab.threadId !== request.clientThreadId) throw new Error('Tab target mismatch');
    if (tab.busy) throw new Error('Action already in progress');
    tab.threadId = request.clientThreadId; tab.busy = true;
    try { const id = await service.createThread(request, false); if (!tabs?.tabs.has(tab.id) || tab.connectionKey !== service.snapshot().connectionKey || id !== request.clientThreadId) throw new Error('Session creation not confirmed'); return id; }
    finally { tab.busy = false; tabs?.publish(); }
  });
  ipcMain.handle("desktop:rename-thread", async (event, id: unknown, title: unknown) => { trustedSender(event); if (tabs?.sender(event.sender) && text(id, 200) !== target(event)) throw new Error('Tab target mismatch'); await service.renameThread(text(id, 200), text(title, 200)); });
  ipcMain.handle('desktop:save-thread-labels', async (event, id: unknown, markers: unknown, timestamp: unknown, connectionKey: unknown) => { trustedSender(event); if (tabs?.sender(event.sender) && text(id, 200) !== target(event)) throw new Error('Tab target mismatch'); return service.saveThreadLabels(text(id, 200), validateLabels(markers), labelTimestamp(timestamp), text(connectionKey, 200)); });
  ipcMain.handle("desktop:archive-thread", async (event, id: unknown) => { trustedSender(event); if (tabs?.sender(event.sender) && text(id, 200) !== target(event)) throw new Error('Tab target mismatch'); await service.archiveThread(text(id, 200)); });
  ipcMain.handle("desktop:load-older", async (event) => { await service.loadOlder(target(event)); });
  ipcMain.handle("desktop:get-channel-info", async (event, id: unknown) => { trustedSender(event); return service.getChannelInfo(text(id, 200)); });
  ipcMain.handle("desktop:send-message", async (event, value: unknown) => { const threadId = target(event), input = object(value), tab = tabs?.sender(event.sender), manager = tabs; if (tab?.busy) throw new Error('Action already in progress'); if (tab) tab.busy = true; try { await service.sendMessage({ text: text(input.text, 100_000), attachmentIds: texts(input.attachmentIds, 8, 200), ...(input.clientMessageId === undefined ? {} : { clientMessageId: text(input.clientMessageId, 100) }) } satisfies SendMessageInput, threadId); if (manager === tabs) { manager?.draftThreads.delete(threadId); manager?.publish(); } } finally { if (tab) tab.busy = false; } });
  ipcMain.handle("desktop:retry-message", async (event, id: unknown) => { await service.retryMessage(text(id, 128), target(event)); });
  ipcMain.handle("desktop:stop-thread", async (event) => { await service.stopThread(target(event)); });
  ipcMain.handle("desktop:cancel-queued", async (event, id: unknown) => { await service.cancelQueued(text(id, 200), target(event)); });
  ipcMain.handle("desktop:answer-interaction", async (event, id: unknown, choice: unknown) => { await service.answerInteraction(text(id, 200), text(choice, 4000), target(event)); });
  ipcMain.handle("desktop:pick-attachments", async (event, threadId: unknown) => { const id = target(event); if (threadId !== undefined && text(threadId, 200) !== id) throw new Error('Tab target mismatch'); return service.pickAndUploadAttachments(id); });
  ipcMain.handle("desktop:drop-attachments", async (event, paths: unknown, threadId: unknown) => { const id = target(event), tab = tabs?.sender(event.sender); if (threadId !== undefined && text(threadId, 200) !== id) throw new Error('Tab target mismatch'); if (tab?.busy) throw new Error('Action already in progress'); if (tab) tab.busy = true; try { return await service.uploadAttachmentPaths(texts(paths, 8, 4096), id); } finally { if (tab) tab.busy = false; } });
  ipcMain.handle("desktop:delete-attachment", async (event, id: unknown) => { await service.deleteUnattachedAttachment(text(id, 200), target(event)); });
  ipcMain.handle("desktop:preview-image", async (event, id: unknown) => { return service.previewAttachmentImage(text(id, 200), target(event)); });
  ipcMain.handle("desktop:download-attachment", async (event, id: unknown, action: unknown) => { const threadId = target(event); if (action !== "save" && action !== "open") throw new Error("Invalid desktop request"); await service.downloadAttachment(text(id, 200), action, threadId); });
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
  publishedSnapshot = undefined;
  tabs = new DesktopTabManager(window, service, __dirname, contents => {
    contents.session.setPermissionCheckHandler(() => false);
    contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => { if (parseSessionLink(url)) service.openSessionLink(url); else if (isAllowedExternalUrl(url)) void shell.openExternal(url); return { action: 'deny' }; });
    contents.on('will-navigate', (event, url) => { if (parseSessionLink(url)) { event.preventDefault(); service.openSessionLink(url); } else if (!isSameDocumentNavigation(contents.getURL(), url)) event.preventDefault(); });
    contents.on('will-redirect', event => event.preventDefault());
  });

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
  window.on('close', () => { tabs?.dispose(); });
  window.on("closed", () => {
    if (mainWindow !== window) return;
    mainWindow = null;
    tabs?.dispose(); tabs = undefined;
    publishedSnapshot = undefined;
    service.closeSessionPages();
  });
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
