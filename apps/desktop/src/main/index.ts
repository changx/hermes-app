import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, powerMonitor, protocol, shell } from "electron";
import { DesktopBrowserSidebar, browserPartition } from './browser-sidebar';
import { DesktopBrowserControl } from './browser-control';
import { MacDriver } from './mac-control';
import { claudeConfigPath, McpHost, type McpConfirmation, type McpConfirmRequest } from './mcp-host';
import { McpConfigError } from '../shared/mcp-config';
import type { DesktopMcpResult } from '../shared/desktop-api';
import { BrowserControlError, MAC_ACTION, MCP_ACTION } from '../shared/browser-control';
import { hostname } from 'node:os';
import { localPreview } from './local-preview';
import { browserUrl } from '../shared/browser-policy';
import { parseSessionLink } from "../../../../packages/client/src/sessionLinks";
import { validateLabels, labelTimestamp } from '../../../../packages/client/src/sessionLabels';
import { join } from "node:path";
import type { ChannelInput, PairingRequest, SendMessageInput, StartThreadInput, ThreadInput } from "../shared/desktop-api";
import { DesktopConnections } from "./connections";
import { attachmentInputs } from '../shared/attachment-input';
import { DesktopTabManager } from './tab-manager';
import { contextMenuItems, menuPosition } from './context-menu';
import { pageMenuEntries, searchText, webSearchUrl, type PageMenuAction } from './page-menu';
import { DesktopSettingsWindow } from './settings-window';
import { DesktopAppIcon } from './app-icon';
import { SessionCardWindow, sessionCardRequest } from './session-card-window';
import type { DesktopSnapshot } from "../shared/desktop-api";
import { snapshotDelta } from "../shared/snapshot-delta";
import { isAllowedExternalUrl, isSameDocumentNavigation, isSystemBrowserUrl, opensInSystemBrowser } from "./security";
import { installHttpKeepAlive } from "./transport";
import { allowUnloadDuringQuit, closeWindows, runShutdown, type ShutdownRecord } from "./shutdown";
import { socketsClosed } from "./socket-registry";

installHttpKeepAlive();

const SNAPSHOT_EVENT = "desktop:snapshot";
let mainWindow: BrowserWindow | null = null;
let publishedSnapshot: DesktopSnapshot | undefined;
let tabs: DesktopTabManager | undefined;
let browser: DesktopBrowserSidebar | undefined;
let browserControl: DesktopBrowserControl | undefined;
// One Cua Driver session for the app run: window snapshots must survive between Agent actions.
const macDriver = new MacDriver({ encodeImage: png => encodeJpeg(png) });
const encodeJpeg = (bytes: Buffer) => {
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) return undefined;
  const { width, height } = image.getSize();
  return { jpegBase64: image.toJPEG(80).toString('base64'), width, height };
};
// Approval for MCP servers set to "ask". The plugin allows 5 minutes for the answer.
const MCP_CONFIRM_MS = 290_000;
const confirmMcp = async ({ server, tool, summary, signal }: McpConfirmRequest): Promise<McpConfirmation> => {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), MCP_CONFIRM_MS);
  const bounce = app.dock?.bounce('critical');
  try {
    const options: Electron.MessageBoxOptions = {
      type: 'question', buttons: ['Allow', 'Deny'], defaultId: 1, cancelId: 1, noLink: true, title: 'Hermes',
      message: `Allow Hermes to use ${tool} from ${server}?`,
      detail: `Hermes wants to run this tool on this computer with:\n${summary}`,
      checkboxLabel: `Allow all ${server} tools until Hermes quits`,
      signal: AbortSignal.any([signal, timeout.signal]),
    };
    const parent = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized() ? mainWindow : undefined;
    const answer = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
    if (timeout.signal.aborted) return 'timeout';
    if (signal.aborted || answer.response !== 0) return 'deny';
    return answer.checkboxChecked ? 'allow-all' : 'allow';
  } finally { clearTimeout(timer); if (bounce !== undefined) app.dock?.cancelBounce(bounce); }
};
// MCP servers configured on this computer, run for the Agent (docs/desktop-mcp-host.md).
const mcpHost = new McpHost({
  file: join(app.getPath('userData'), 'mcp.json'), claudeFile: claudeConfigPath(),
  confirm: confirmMcp, encodeImage: encodeJpeg, onServersChanged: () => browserControl?.sync(),
});
const mcpResult = (change: () => DesktopMcpResult): DesktopMcpResult => {
  try { return change(); } catch (error) {
    return { ok: false, error: error instanceof McpConfigError ? error.message : 'The configuration could not be saved. Try again.' };
  }
};
protocol.registerSchemesAsPrivileged([{ scheme: 'hermes-preview', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const secureSettings = (contents: Electron.WebContents): void => {
  contents.session.setPermissionCheckHandler(() => false);
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => { if (!isSameDocumentNavigation(contents.getURL(), url)) event.preventDefault(); });
  contents.on('will-redirect', event => event.preventDefault());
};
const settingsWindow = new DesktopSettingsWindow(__dirname, () => service.snapshot(), secureSettings);
// Dock icon chosen in Settings (this computer only). Images are packaged with the renderer thumbnails.
const appIcon = new DesktopAppIcon<Electron.NativeImage>(join(app.getPath('userData'), 'app-icon.json'), join(__dirname, '../renderer/app-icons'),
  { fromBuffer: buffer => nativeImage.createFromBuffer(buffer) }, app.dock);
// Sidebar Session card: a native popup right of the sidebar. It has no IPC of its own.
const sessionCard = new SessionCardWindow(() => mainWindow, __dirname, secureSettings);

const service = new DesktopConnections((snapshot) => {
  settingsWindow.publish();
  browserControl?.sync();
  if (tabs) { tabs.sync(snapshot); return; }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(SNAPSHOT_EVENT, publishedSnapshot ? snapshotDelta(publishedSnapshot,snapshot) : snapshot);
    publishedSnapshot = snapshot;
  }
});

/** Opens a web link in the browser panel of the sender's tab (or of the active tab), else in the system browser. */
const openWebLink = (contents: Electron.WebContents, url: string, disposition = 'foreground-tab') => {
  // Cmd+click: the system browser.
  if (opensInSystemBrowser(disposition)) { if (isSystemBrowserUrl(url)) void shell.openExternal(url); return; }
  try { if (!/^https?:/i.test(url)) return; const validated = browserUrl(url), tab = tabs?.sender(contents) ?? (tabs?.activeTabId ? tabs.tabs.get(tabs.activeTabId) : undefined);
    if (tab) void browser?.open(tab.id, validated); else if (isAllowedExternalUrl(url)) void shell.openExternal(url);
  } catch { /* Reject unsupported schemes and embedded credentials. */ }
};
/** The right-click menu of the main window and the tab pages: copy, web search, find in page, Hermes search. */
const attachPageMenu = (contents: Electron.WebContents): void => {
  contents.on('context-menu', (_event, params) => {
    const owner = mainWindow, manager = tabs;
    if (!owner || owner.isDestroyed() || !manager || contents.isDestroyed()) return;
    const entries = pageMenuEntries(params, !!manager.findTarget(contents));
    const run = (action: PageMenuAction) => {
      if (contents.isDestroyed() || manager !== tabs) return;
      // Edit commands act on the focused page; the right-click target may not have the focus yet.
      if (['cut', 'copy', 'paste', 'select-all'].includes(action)) contents.focus();
      if (action === 'cut') contents.cut(); else if (action === 'copy') contents.copy(); else if (action === 'paste') contents.paste();
      else if (action === 'select-all') contents.selectAll(); else if (action === 'copy-link') clipboard.writeText(params.linkURL);
      else if (action === 'search-web') { const url = webSearchUrl(params.selectionText); if (url) openWebLink(contents, url); }
      else if (action === 'find') manager.find(contents, 'open', searchText(params.selectionText) || undefined);
      else manager.openSearch('all', searchText(params.selectionText) || undefined);
    };
    // The accelerators are shown only; tab-manager.ts and the pages handle the keys.
    Menu.buildFromTemplate(entries.map(entry => 'separator' in entry ? { type: 'separator' as const }
      : { label: entry.label, enabled: entry.enabled !== false, accelerator: entry.accelerator, registerAccelerator: false, click: () => run(entry.action) })).popup({ window: owner });
  });
};
const trustedSender = (event: Electron.IpcMainInvokeEvent): void => {
  if (event.senderFrame !== event.sender.mainFrame) throw new Error("Untrusted desktop request");
  // Reached only through the Settings channel allowlist in registerDesktopApi.
  if (settingsWindow.owns(event.sender)) { if (event.senderFrame?.url !== event.sender.getURL()) throw new Error("Untrusted desktop request"); return; }
  // A separate browser window's toolbar; reached only through BROWSER_WINDOW_CHANNELS.
  if (browser?.ownsWindow(event.sender)) { if (event.senderFrame?.url !== event.sender.getURL()) throw new Error("Untrusted desktop request"); return; }
  if (!mainWindow) throw new Error("Untrusted desktop request");
  if (tabs) { tabs.authorize(event.sender, event.senderFrame?.url); return; }
  if (event.sender !== mainWindow.webContents || event.senderFrame?.url !== mainWindow.webContents.getURL()) throw new Error('Untrusted desktop request');
};
/** The main window, or a separate browser window acting on its own Session's page. */
const browserSender = (event: Electron.IpcMainInvokeEvent): void => { trustedSender(event); if (event.sender !== mainWindow?.webContents && !browser?.ownsWindow(event.sender)) throw new Error('Browser action required'); };
const shellSender = (event: Electron.IpcMainInvokeEvent): void => { trustedSender(event); if (event.sender !== mainWindow?.webContents) throw new Error('Shell action required'); };
const settingsSender = (event: Electron.IpcMainInvokeEvent): void => { trustedSender(event); if (!settingsWindow.owns(event.sender) && event.sender !== mainWindow?.webContents) throw new Error('Settings action required'); };
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

// The Settings window may use only these channels. All other workspace,
// Session, browser and attachment actions reject it before any handler runs.
const SETTINGS_CHANNELS = new Set(['desktop:get-snapshot', 'desktop:get-model-settings', 'desktop:set-model-settings', 'desktop:add-connection', 'desktop:remove-connection', 'desktop:rename-connection', 'desktop:get-app-icon', 'desktop:set-app-icon', 'desktop:get-mcp', 'desktop:save-mcp', 'desktop:set-mcp-approval', 'desktop:import-claude-mcp', 'desktop:show-mcp-file']);
// A separate browser window may use only its own browser controls.
const BROWSER_WINDOW_CHANNELS = new Set(['desktop:get-snapshot', 'desktop:open-browser', 'desktop:browser-bounds', 'desktop:browser-action', 'desktop:browser-control', 'desktop:set-browser-mode']);
const registerDesktopApi = (): void => {
  const handle = (channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args) => {
      if (settingsWindow.owns(event.sender) && !SETTINGS_CHANNELS.has(channel)) throw new Error('Settings action unavailable');
      if (browser?.ownsWindow(event.sender) && !BROWSER_WINDOW_CHANNELS.has(channel)) throw new Error('Browser window action unavailable');
      return listener(event, ...args);
    });
  };
  // A Session page's status bar names its connection; Settings opens on that connection's page.
  handle('desktop:open-settings', (event, connectionId: unknown) => {
    trustedSender(event);
    if (connectionId === undefined) { settingsWindow.open(); return; }
    const id = text(connectionId, 40);
    settingsWindow.open(service.snapshot().connections?.some(row => row.id === id) ? `connection:${id}` : undefined);
  });
  handle('desktop:add-connection', async (event, value: unknown) => {
    settingsSender(event); const request = object(value);
    await service.addConnection({ baseUrl: text(request.baseUrl, 300), code: text(request.code, 32), deviceName: text(request.deviceName, 64) });
  });
  handle('desktop:remove-connection', async (event, id: unknown) => {
    settingsSender(event); const selected = text(id, 40), key = service.snapshot().connections?.find(row => row.id === selected)?.connectionKey;
    if (key && [...tabs?.tabs.values() ?? []].some(tab => tab.connectionKey === key && tab.busy)) throw new Error('Wait for the current action before removing this connection.');
    await service.removeConnection(selected);
  });
  handle('desktop:rename-connection', async (event, id: unknown, name: unknown) => {
    settingsSender(event); await service.renameConnection(text(id, 40), text(name, 200));
  });
  handle('desktop:get-app-icon', event => { settingsSender(event); return appIcon.state(); });
  handle('desktop:set-app-icon', (event, icon: unknown) => { settingsSender(event); return appIcon.set(icon); });
  handle('desktop:get-mcp', event => { settingsSender(event); return mcpHost.state(); });
  handle('desktop:save-mcp', (event, value: unknown) => { settingsSender(event); const body = text(value, 512 * 1024); return mcpResult(() => ({ ok: true, state: mcpHost.save(body) })); });
  handle('desktop:set-mcp-approval', (event, name: unknown, approval: unknown) => {
    settingsSender(event); const server = text(name, 64);
    if (approval !== 'ask' && approval !== 'auto') throw new Error('Invalid desktop request');
    return mcpResult(() => ({ ok: true, state: mcpHost.setApproval(server, approval) }));
  });
  handle('desktop:import-claude-mcp', event => { settingsSender(event); return mcpResult(() => ({ ok: true, ...mcpHost.importClaude() })); });
  handle('desktop:show-mcp-file', event => { settingsSender(event); shell.showItemInFolder(mcpHost.ensureFile()); });
  handle('desktop:get-model-settings', (event, key: unknown) => { trustedSender(event); return service.getModelSettings(text(key, 200)); });
  handle('desktop:set-model-settings', (event, key: unknown, provider: unknown, model: unknown, confirm: unknown) => {
    trustedSender(event);
    if (typeof confirm !== 'boolean') throw new Error('Invalid desktop request');
    return service.setModelSettings(text(key, 200), text(provider, 256), text(model, 256), confirm);
  });
  const browserTab = (event: Electron.IpcMainInvokeEvent) => {
    trustedSender(event);
    const owned = browser?.paneForWindow(event.sender);
    if (owned !== undefined) { const tab = tabs?.tabs.get(owned); if (!tab) throw new Error('Open a conversation or new chat first.'); return tab; }
    const tab = tabs?.sender(event.sender) ?? (tabs?.activeTabId ? tabs.tabs.get(tabs.activeTabId) : undefined);
    if (!tab) throw new Error('Open a conversation or new chat first.');
    return tab;
  };
  handle('desktop:open-browser', (event, url: unknown) => browser?.open(browserTab(event).id, url === undefined ? undefined : text(url, 4096)));
  handle('desktop:browser-bounds', (event, value: unknown) => {
    browserSender(event); const b = object(value), bounds = { x: Number(b.x), y: Number(b.y), width: Number(b.width), height: Number(b.height), visible: b.visible === true };
    if (browser?.ownsWindow(event.sender)) browser.setWindowBounds(event.sender, bounds); else browser?.setBounds(bounds);
  });
  handle('desktop:browser-action', (event, action: unknown) => {
    browserSender(event); const tab = browserTab(event), fromShell = event.sender === mainWindow?.webContents;
    if (!['back', 'forward', 'reload', 'stop', 'close'].includes(action as string)) throw new Error('Invalid browser action');
    browser?.action(tab.id, action as 'back' | 'forward' | 'reload' | 'stop' | 'close');
    if (action === 'close' && fromShell) tab.view.webContents.focus();
  });
  handle('desktop:set-browser-mode', (event, mode: unknown) => {
    browserSender(event); if (mode !== 'sidebar' && mode !== 'window') throw new Error('Invalid browser mode');
    browser?.setMode(mode);
  });
  handle('desktop:browser-control', (event, action: unknown) => {
    browserSender(event); const tab = browserTab(event);
    if (!['stop', 'resume', 'done'].includes(action as string)) throw new Error('Invalid browser action');
    browser?.control(tab.id, action as 'stop' | 'resume' | 'done');
  });
  handle('desktop:preview-attachment', async (event, id: unknown, sequence: unknown) => {
    const tab = browserTab(event), thread = target(event), key = tab.connectionKey;
    const attachmentId = text(id, 200);
    if (sequence !== undefined && (!Array.isArray(sequence) || sequence.length > 500)) throw new Error('Invalid desktop request');
    const ids = sequence === undefined ? [] : sequence.map(value => text(value, 200));
    // A published HTML page opens at its own link, where its images and videos load.
    const page = service.attachmentPage(attachmentId, thread);
    if (page) { await browser?.open(tab.id, browserUrl(page)); return; }
    const current = () => tabs?.tabs.get(tab.id) === tab && tab.threadId === thread && tab.connectionKey === key && service.hasConnection(key);
    const sibling = (assets: Array<{ id: string; name: string }>) => async (name: string) => {
      const matches = assets.filter(item => item.name === name);
      if (!current() || matches.length !== 1) return undefined;
      const resource = await service.attachmentPreview(matches[0].id, thread);
      return current() ? resource : undefined;
    };
    // Several attachments: a gallery of all of them, opened at the chosen one.
    const items = ids.length > 1 ? service.previewItems(thread, ids) : [];
    const start = items.findIndex(item => item.id === attachmentId);
    if (items.length > 1 && start >= 0) {
      const request = browser?.startPreview(tab.id);
      if (!request?.current()) return;
      return browser?.gallery(tab.id, items, start, async index => {
        if (!current()) return undefined;
        const file = await service.attachmentPreview(items[index].id, thread);
        return current() ? file : undefined;
      }, sibling(service.previewResources(thread)));
    }
    const request = browser?.startPreview(tab.id);
    let file;
    try { file = await service.attachmentPreview(attachmentId, thread); } catch (error) { request?.failed(); throw error; }
    if (!current() || !request?.current()) return;
    return browser?.document(tab.id, file, sibling(service.previewResources(thread)));
  });
  handle('desktop:preview-local-file', async (event, input: unknown) => {
    const tab = browserTab(event);
    if (tab.kind !== 'new') throw new Error('Local preview is for new chat only.');
    const request = browser?.startPreview(tab.id);
    let file;
    try { file = await localPreview(input); } catch (error) { request?.failed(); throw error; }
    if (tabs?.tabs.get(tab.id) !== tab || tab.kind !== 'new' || !request?.current()) return;
    return browser?.document(tab.id, file);
  });
  handle('desktop:new-tab', (event, channelId: unknown, automation: unknown) => { trustedSender(event); if (automation !== undefined && typeof automation !== 'boolean') throw new Error('Invalid desktop request');
    tabs?.newTab(channelId === undefined ? undefined : text(channelId, 200), automation === true); });
  handle('desktop:activate-tab', (event, id: unknown) => { shellSender(event); tabs?.activate(text(id, 200)); });
  handle('desktop:close-tab', (event, id: unknown) => { shellSender(event); tabs?.close(text(id, 200)); });
  handle('desktop:tab-menu', (event, id: unknown, x: unknown, y: unknown) => {
    shellSender(event); const manager = tabs, tabId = text(id, 200);
    if (!manager || !mainWindow || mainWindow.isDestroyed()) return;
    const items = manager.menu(tabId);
    const position = menuPosition(x, y);
    Menu.buildFromTemplate(items.map(item => ({ label: item.label, enabled: item.enabled, click: () => {
      if (manager !== tabs || !manager.tabs.has(tabId)) return;
      try { manager.menuAction(tabId, item.action); } catch { /* A busy tab stays open. */ }
    } }))).popup({ window: mainWindow, ...position });
  });
  handle('desktop:session-card', async (event, value: unknown) => {
    shellSender(event); const card = sessionCardRequest(value);
    if (card) await sessionCard.show(card); else sessionCard.hide();
  });
  // Token usage: the sidebar (main window) reads any row; a Session page reads only its own Session.
  handle('desktop:thread-usage', async (event, id: unknown) => {
    trustedSender(event); const threadId = text(id, 200), page = tabs?.sender(event.sender);
    if (page) { if (threadId !== target(event)) throw new Error('Tab target mismatch'); }
    else if (event.sender !== mainWindow?.webContents) throw new Error('Shell action required');
    return service.threadUsage(threadId);
  });
  // Menus of the main window (sidebar Session rows) and of a Session page (its status bar).
  // The renderer builds the items; only the chosen id comes back. A Session page gives view coordinates.
  handle('desktop:context-menu', (event, items: unknown, x: unknown, y: unknown) => {
    trustedSender(event); const page = tabs?.sender(event.sender);
    if (event.sender !== mainWindow?.webContents && page?.kind !== 'session') throw new Error('Shell action required');
    const entries = contextMenuItems(items), owner = mainWindow;
    if (!owner || owner.isDestroyed()) return null;
    if (page && Number.isFinite(x) && Number.isFinite(y)) { const origin = tabs!.contentOrigin(); x = (x as number) + origin.x; y = (y as number) + origin.y; }
    return new Promise<string | null>(resolve => {
      let settled = false; const finish = (id: string | null) => { if (!settled) { settled = true; resolve(id); } };
      Menu.buildFromTemplate(entries.map(item => 'separator' in item ? { type: 'separator' as const } : { label: item.label, enabled: item.enabled !== false, click: () => finish(item.id) }))
        // macOS can report the close before the click; a short wait lets the click win.
        .popup({ window: owner, ...menuPosition(x, y), callback: () => setTimeout(() => finish(null), 150) });
    });
  });
  handle('desktop:complete-new-tab', event => { trustedSender(event); tabs?.complete(event.sender); });
  // Automations: the sidebar lists and opens jobs; an Automation tab reads only its own job.
  handle('desktop:list-automations', (event, value: unknown) => {
    trustedSender(event);
    if (event.sender !== mainWindow?.webContents && !tabs?.isAutomationList(event.sender)) throw new Error('Shell action required');
    if (value === undefined) return service.automations();
    const input = object(value), cursors: Record<string, string> = {};
    if (Object.keys(input).length > 20) throw new Error('Invalid desktop request');
    for (const [key, cursor] of Object.entries(input)) cursors[text(key, 200)] = text(cursor, 2000);
    return service.automations(cursors);
  });
  handle('desktop:open-automation-list', event => { shellSender(event); tabs?.openAutomationList(); });
  // An Automation tab changes only its own job; the renderer never names another job.
  handle('desktop:control-automation', async (event, control: unknown, schedule: unknown) => {
    trustedSender(event); const manager = tabs; if (!manager) throw new Error('Window unavailable');
    const tab = manager.automationTarget(event.sender);
    if (control !== 'pause' && control !== 'resume' && control !== 'run' && control !== 'schedule') throw new Error('Invalid desktop request');
    const job = await service.controlAutomation(tab.automationId, control, control === 'schedule' ? text(schedule, 200) : undefined);
    manager.setTabTitle(tab, job.name);
    return job;
  });
  // Delete closes every tab of the job and tells the lists to reload. Its conversations stay.
  handle('desktop:delete-automation', async event => {
    trustedSender(event); const manager = tabs; if (!manager) throw new Error('Window unavailable');
    const { automationId } = manager.automationTarget(event.sender);
    await service.deleteAutomation(automationId);
    manager.automationDeleted(automationId);
  });
  handle('desktop:open-automation-editor', async event => {
    trustedSender(event); const manager = tabs; if (!manager) throw new Error('Window unavailable');
    return service.automationEditor(manager.automationTarget(event.sender).automationId);
  });
  handle('desktop:open-automation', (event, id: unknown, title: unknown) => {
    trustedSender(event);
    if (event.sender !== mainWindow?.webContents && !tabs?.isAutomationList(event.sender)) throw new Error('Shell action required');
    tabs?.openAutomation(text(id, 300), text(title, 400));
  });
  handle('desktop:get-automation', async (event, before: unknown) => {
    trustedSender(event); const manager = tabs; if (!manager) throw new Error('Window unavailable');
    const tab = manager.automationTarget(event.sender);
    if (before !== undefined && (!Number.isSafeInteger(before) || (before as number) < 0)) throw new Error('Invalid desktop request');
    const page = await service.automation(tab.automationId, before as number | undefined);
    if (page.state === 'ok' && before === undefined) manager.setTabTitle(tab, page.automation.name);
    return page;
  });
  handle('desktop:content-bounds', (event, value: unknown) => { shellSender(event); const bounds = object(value); tabs?.setBounds({ x: Number(bounds.x), y: Number(bounds.y), width: Number(bounds.width), height: Number(bounds.height), visible: bounds.visible === true }); });
  handle("desktop:open-session-link", (event, value: unknown) => {
    trustedSender(event);
    // A tab's message can hold a short link; it resolves against that tab's Session.
    const context = tabs?.sender(event.sender) ? target(event) : undefined;
    service.openSessionLink(text(value, 4096), context);
  });
  handle("desktop:copy-session-link", (event, id: unknown) => {
    if (id === undefined) { clipboard.writeText(service.sessionLink(target(event))); return; }
    shellSender(event); clipboard.writeText(service.sessionLink(text(id, 200)));
  });
  // A Session page's status bar label: the main window opens its search with that label. Only the label text crosses windows.
  // The search dialog hides the Session view, so the main window's own page takes the keyboard focus.
  // Shift+Cmd+E in a page: search the web for the selected text, in that page's browser panel.
  handle("desktop:search-web", (event, value: unknown) => {
    trustedSender(event); if (event.sender !== mainWindow?.webContents && !tabs?.sender(event.sender)) throw new Error('Shell action required');
    const url = webSearchUrl(text(value, 4000)); if (url) openWebLink(event.sender, url);
  });
  handle("desktop:search-label", (event, label: unknown) => {
    trustedSender(event); const value = text(label, 1024);
    if (!value.trim() || !mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.focus();
    mainWindow.webContents.send("desktop:search-label", value);
  });
  // A Session page's Project name: the main window's sidebar shows that Project. Only the Project id crosses windows.
  handle("desktop:reveal-project", (event, channelId: unknown) => {
    trustedSender(event); const id = text(channelId, 200);
    if (!mainWindow || mainWindow.isDestroyed() || !service.snapshot().channels.some(channel => channel.id === id)) return;
    mainWindow.webContents.send("desktop:reveal-project", id);
  });
  handle("desktop:get-snapshot", (event) => { trustedSender(event); if (settingsWindow.owns(event.sender)) return settingsWindow.snapshot(); if (browser?.ownsWindow(event.sender)) return browser.windowSnapshot(event.sender); return tabs?.snapshot(event.sender) ?? service.snapshot(); });
  handle("desktop:pair", async (event, value: unknown) => {
    shellSender(event);
    if (!value || typeof value !== "object") throw new Error("Invalid desktop request");
    const request = value as Partial<PairingRequest>;
    await service.pair({ baseUrl: text(request.baseUrl, 300), code: text(request.code, 32), deviceName: text(request.deviceName, 64) });
  });
  handle("desktop:cancel-pairing", async (event) => { trustedSender(event); await service.cancelPairing(); });
  handle("desktop:forget-connection", async (event) => { shellSender(event); await service.forgetConnection(); });
  handle("desktop:load-local-drafts", async (event, id: unknown) => { trustedSender(event); const identity = text(id, 24), manager = tabs, tab = manager?.sender(event.sender), saved = tab ? await service.loadLocalDrafts(identity) : await service.loadWorkspaceDrafts(); if (manager !== tabs || !service.hasConnection(identity) || tab && identity !== tab.connectionKey) throw new Error('Draft identity changed'); if (!tab) { manager?.draftThreads.clear(); for (const [threadId, draft] of Object.entries(saved)) if (draft.text.trim() || draft.attachments.length) manager?.draftThreads.add(threadId); manager?.publish(); return saved; } return tab.threadId && saved[tab.threadId] ? { [tab.threadId]: saved[tab.threadId] } : {}; });
  handle("desktop:save-local-draft", async (event, id: unknown, threadId: unknown, value: unknown) => { trustedSender(event); const targetId = text(threadId, 200), manager = tabs; if (manager?.sender(event.sender) && targetId !== target(event)) throw new Error('Draft target mismatch'); await service.saveLocalDraft(text(id, 24), targetId, value); if (manager !== tabs) return; const draft = object(value); if (typeof draft.text === 'string' && (draft.text.trim() || Array.isArray(draft.attachments) && draft.attachments.length)) manager?.draftThreads.add(targetId); else manager?.draftThreads.delete(targetId); manager?.publish(); });
  handle("desktop:select-channel", async (event, id: unknown) => { shellSender(event); await service.selectChannel(text(id, 200)); });
  handle("desktop:select-thread", async (event, id: unknown) => { trustedSender(event); await service.selectThread(text(id, 200)); });
  handle("desktop:close-session-page", (event, id: unknown) => { shellSender(event); const tab = [...tabs?.tabs.values() ?? []].find(item => item.threadId === text(id, 200)); if (tab) tabs?.close(tab.id); });
  handle("desktop:result-read", async (event, id: unknown, version: unknown, ref: unknown) => { const threadId = target(event), tab = tabs?.sender(event.sender); if (text(id, 200) !== threadId || tab && (tab.id !== tabs?.activeTabId || !tabs?.snapshot(event.sender).tabActive) || !mainWindow?.isFocused() || mainWindow.isMinimized()) return; if (typeof version === "number" && typeof ref === "number") await service.markResultRead(threadId, version, ref); });
  handle("desktop:retry-connection", async (event) => { trustedSender(event); await service.retryConnection(); });
  handle("desktop:dismiss-error", (event, id: unknown) => { trustedSender(event); service.dismissError(typeof id === "string" && id ? text(id, 200) : undefined); });
  handle("desktop:create-channel", async (event, value: unknown) => { shellSender(event); const input = object(value); return service.createChannel(text(input.connectionKey, 24), { name: text(input.name, 120), description: text(input.description, 4000) } satisfies ChannelInput); });
  handle("desktop:get-project-workspace", async (event, id: unknown) => { shellSender(event); return service.getProjectWorkspace(text(id, 200)); });
  handle("desktop:save-project-agents", async (event, id: unknown, content: unknown, previous: unknown) => { shellSender(event); return service.saveProjectAgents(text(id, 200), text(content, 10 * 1024 * 1024), previous === null ? null : text(previous, 80)); });
  handle("desktop:set-project-folder", async (event, id: unknown, path: unknown) => { shellSender(event); return service.setProjectFolder(text(id, 200), path === null ? null : text(path, 4096)); });
  handle("desktop:update-channel", async (event, id: unknown, value: unknown) => { trustedSender(event); const input = object(value); await service.updateChannel(text(id, 200), { name: text(input.name, 120), description: text(input.description, 4000) }); });
  handle("desktop:delete-channel", async (event, id: unknown) => { trustedSender(event); await service.deleteChannel(text(id, 200)); });
  handle("desktop:archive-channel", async (event, id: unknown) => { trustedSender(event); await service.archiveChannel(text(id, 200)); });
  handle("desktop:create-thread", async (event, value: unknown) => {
    trustedSender(event); const input = object(value), tab = tabs?.sender(event.sender);
    const model = input.model === undefined ? undefined : object(input.model);
    if (input.confirmModel !== undefined && (typeof input.confirmModel !== 'boolean' || !model)) throw new Error('Invalid desktop request');
    const request = { title: text(input.title, 200), clientThreadId: text(input.clientThreadId, 80), ...(input.channelId === undefined ? {} : { channelId: text(input.channelId, 200) }),
      ...(model ? { model: { provider: text(model.provider, 256), model: text(model.model, 256) }, confirmModel: input.confirmModel === true } : {}) } satisfies ThreadInput;
    if (!tab) return service.createThread(request);
    const qualifiedId = service.threadIdentity(request.clientThreadId, request.channelId);
    if (tab.kind !== 'new' || tab.threadId && tab.threadId !== qualifiedId) throw new Error('Tab target mismatch');
    if (tab.busy) throw new Error('Action already in progress');
    tab.connectionKey = service.connectionForChannel(request.channelId); tab.initialChannelId = request.channelId;
    tab.threadId = qualifiedId; tab.busy = true;
    try {
      const id = await service.createThread(tab.automationEditor ? { ...request, automationEditor: true } : request, false);
      // Nothing was created (model needs confirmation or was rejected): the tab keeps its target for the retry.
      if (typeof id !== 'string') return id;
      if (!tabs?.tabs.has(tab.id) || !service.hasConnection(tab.connectionKey) || id !== qualifiedId) throw new Error('Session creation not confirmed'); return id;
    }
    finally { tab.busy = false; tabs?.publish(); }
  });
  handle("desktop:start-thread", async (event, value: unknown) => {
    trustedSender(event); const input = object(value), tab = tabs?.sender(event.sender);
    const request = { title: text(input.title, 200), clientThreadId: text(input.clientThreadId, 80), text: text(input.text, 100_000), clientMessageId: text(input.clientMessageId, 100),
      ...(input.channelId === undefined ? {} : { channelId: text(input.channelId, 200) }) } satisfies StartThreadInput;
    if (!tab) { const id = await service.startThread(request); void service.selectThread(id); return id; }
    const qualifiedId = service.threadIdentity(request.clientThreadId, request.channelId);
    if (tab.kind !== 'new' || tab.threadId && tab.threadId !== qualifiedId) throw new Error('Tab target mismatch');
    if (tab.busy) throw new Error('Action already in progress');
    tab.connectionKey = service.connectionForChannel(request.channelId); tab.initialChannelId = request.channelId;
    tab.threadId = qualifiedId; tab.busy = true;
    try {
      const id = await service.startThread(tab.automationEditor ? { ...request, automationEditor: true } : request);
      if (!tabs?.tabs.has(tab.id) || !service.hasConnection(tab.connectionKey) || id !== qualifiedId) throw new Error('Session start not confirmed');
      return id;
    }
    finally { tab.busy = false; tabs?.publish(); }
  });
  handle("desktop:rename-thread", async (event, id: unknown, title: unknown) => { trustedSender(event); if (tabs?.sender(event.sender) && text(id, 200) !== target(event)) throw new Error('Tab target mismatch'); await service.renameThread(text(id, 200), text(title, 200)); });
  handle('desktop:save-thread-labels', async (event, id: unknown, markers: unknown, timestamp: unknown, connectionKey: unknown) => { trustedSender(event); if (tabs?.sender(event.sender) && text(id, 200) !== target(event)) throw new Error('Tab target mismatch'); return service.saveThreadLabels(text(id, 200), validateLabels(markers), labelTimestamp(timestamp), text(connectionKey, 200)); });
  handle("desktop:archive-thread", async (event, id: unknown) => { trustedSender(event); if (tabs?.sender(event.sender) && text(id, 200) !== target(event)) throw new Error('Tab target mismatch'); await service.archiveThread(text(id, 200)); });
  handle("desktop:load-older", async (event) => { await service.loadOlder(target(event)); });
  handle("desktop:get-channel-info", async (event, id: unknown) => { trustedSender(event); return service.getChannelInfo(text(id, 200)); });
  handle("desktop:send-message", async (event, value: unknown) => { const threadId = target(event), input = object(value), tab = tabs?.sender(event.sender), manager = tabs; if (tab?.busy) throw new Error('Action already in progress'); if (tab) tab.busy = true; try { await service.sendMessage({ text: text(input.text, 100_000), attachmentIds: texts(input.attachmentIds, 8, 200), ...(input.clientMessageId === undefined ? {} : { clientMessageId: text(input.clientMessageId, 100) }) } satisfies SendMessageInput, threadId); if (manager === tabs) { manager?.draftThreads.delete(threadId); manager?.publish(); } } finally { if (tab) tab.busy = false; } });
  handle("desktop:retry-message", async (event, id: unknown) => { await service.retryMessage(text(id, 128), target(event)); });
  const refSeq = (value: unknown): number => { if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error('Invalid desktop request'); return value as number; };
  handle("desktop:branch-message", async (event, ref: unknown) => {
    const threadId = target(event), tab = tabs?.sender(event.sender);
    if (tab?.busy) return { ok: false, reason: 'busy' };
    if (tab) tab.busy = true;
    try { return await service.branchFromMessage(refSeq(ref), threadId); } finally { if (tab) tab.busy = false; }
  });
  handle("desktop:message-sources", async (event, ref: unknown) => service.messageSources(refSeq(ref), target(event)));
  handle("desktop:copy-text", (event, value: unknown) => { trustedSender(event); clipboard.writeText(text(value, 1_000_000)); });
  handle("desktop:export-message", async (event, value: unknown) => service.exportMessage(text(value, 1_000_000), target(event)));
  handle("desktop:export-conversation", async (event) => service.exportConversation(target(event)));
  handle("desktop:retry-latest", async (event) => { await service.retryLatest(target(event)); });
  handle("desktop:stop-thread", async (event) => { await service.stopThread(target(event)); });
  handle("desktop:cancel-queued", async (event, id: unknown) => { await service.cancelQueued(text(id, 200), target(event)); });
  handle("desktop:answer-interaction", async (event, id: unknown, choice: unknown) => { await service.answerInteraction(text(id, 200), text(choice, 4000), target(event)); });
  handle("desktop:pick-attachments", async (event, threadId: unknown) => { const id = target(event); if (threadId !== undefined && text(threadId, 200) !== id) throw new Error('Tab target mismatch'); return service.pickAndUploadAttachments(id); });
  handle("desktop:drop-attachments", async (event, paths: unknown, threadId: unknown) => { const id = target(event), tab = tabs?.sender(event.sender); if (threadId !== undefined && text(threadId, 200) !== id) throw new Error('Tab target mismatch'); if (tab?.busy) throw new Error('Action already in progress'); if (tab) tab.busy = true; try { return await service.uploadAttachmentInputs(attachmentInputs(paths), id); } finally { if (tab) tab.busy = false; } });
  handle("desktop:delete-attachment", async (event, id: unknown) => { await service.deleteUnattachedAttachment(text(id, 200), target(event)); });
  handle("desktop:list-session-files", (event, list: unknown, after: unknown) => {
    const threadId = target(event);
    if (list !== 'delivered' && list !== 'uploaded') throw new Error('Invalid desktop request');
    return service.sessionFiles(threadId, list, after === undefined ? undefined : text(after, 200));
  });
  handle("desktop:prepare-session-file", (event, id: unknown) => service.prepareSessionFile(target(event), text(id, 200)));
  handle("desktop:search-files", (event, query: unknown, labels: unknown, cursors: unknown) => {
    trustedSender(event); // The search dialog opens in the main window and in Session tabs.
    if (!Array.isArray(labels) || labels.length > 10) throw new Error('Invalid desktop request');
    const input = cursors === undefined ? undefined : object(cursors), next: Record<string, string> = {};
    if (input && Object.keys(input).length > 20) throw new Error('Invalid desktop request');
    for (const [key, cursor] of Object.entries(input ?? {})) next[text(key, 200)] = text(cursor, 200);
    return service.searchFiles(text(query, 200), labels.map(label => text(label, 1024)), input ? next : undefined);
  });
  handle("desktop:search-messages", (event, query: unknown, labels: unknown, refine: unknown) => {
    trustedSender(event); // Same dialog as file search.
    if (!Array.isArray(labels) || labels.length > 10 || typeof refine !== 'boolean') throw new Error('Invalid desktop request');
    return service.searchMessages(text(query, 200), labels.map(label => text(label, 1024)), refine);
  });
  handle("desktop:open-session-file", async (event, threadId: unknown, id: unknown, action: unknown) => {
    trustedSender(event);
    if (action !== 'open' && action !== 'save') throw new Error('Invalid desktop request');
    const thread = text(threadId, 200), attachmentId = text(id, 200);
    await service.openSessionFile(thread, attachmentId, action);
  });
  handle("desktop:open-message", async (event, threadId: unknown, refSeq: unknown) => {
    trustedSender(event);
    if (typeof refSeq !== 'number' || !Number.isSafeInteger(refSeq) || refSeq <= 0) throw new Error('Invalid desktop request');
    await service.openMessage(text(threadId, 200), refSeq);
  });
  handle("desktop:preview-image", async (event, id: unknown) => { return service.previewAttachmentImage(text(id, 200), target(event)); });
  handle("desktop:download-attachment", async (event, id: unknown, action: unknown) => {
    const threadId = target(event), attachmentId = text(id, 200);
    if (action !== "save" && action !== "open") throw new Error("Invalid desktop request");
    // Open externally on a published HTML page: the system browser loads the page with its resources.
    const page = action === "open" ? service.attachmentPage(attachmentId, threadId) : undefined;
    if (page) { if (!isSystemBrowserUrl(page)) throw new Error("Invalid desktop request"); await shell.openExternal(page); return; }
    // Progress goes only to the window that asked, at most about 5 times a second.
    let last = 0;
    await service.downloadAttachment(attachmentId, action, threadId, (received, total) => {
      const now = Date.now();
      if (received !== 0 && received !== total && now - last < 200) return;
      last = now;
      if (!event.sender.isDestroyed()) event.sender.send("desktop:download-progress", { attachmentId, received, total });
    });
  });
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
  browser = new DesktopBrowserSidebar(window, () => tabs?.publish(), (contents, skip) => tabs?.attachShortcuts(contents, skip), {
    preload: join(__dirname, '../preload/browser-page.cjs'),
    windowRenderer: { html: join(__dirname, '../renderer/index.html'), preload: join(__dirname, '../preload/index.cjs'), secure: secureSettings },
    focusChanged: () => browserControl?.sync(),
    // One persistent login partition per Project (Channel) and server.
    partitionFor: tabId => {
      const tab = tabs?.tabs.get(tabId);
      const channel = tab?.threadId ? service.snapshot(undefined, false).threads.find(thread => thread.id === tab.threadId)?.channelId : tab?.initialChannelId;
      return browserPartition(tab?.connectionKey, channel);
    },
  });
  tabs = new DesktopTabManager(window, service, __dirname, contents => {
    contents.session.setPermissionCheckHandler(() => false);
    contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.setWindowOpenHandler(({ url, disposition }) => { if (parseSessionLink(url)) service.openSessionLink(url); else openWebLink(contents, url, disposition); return { action: 'deny' }; });
    contents.on('will-navigate', (event, url) => { if (parseSessionLink(url)) { event.preventDefault(); service.openSessionLink(url); } else if (!isSameDocumentNavigation(contents.getURL(), url)) event.preventDefault(); });
    contents.on('will-redirect', event => event.preventDefault());
    attachPageMenu(contents);
  }, browser, () => settingsWindow.open(), () => browserControl?.sync());
  window.on('focus', () => { browserControl?.sync(); tabs?.windowFocused(); }); window.on('blur', () => browserControl?.sync());

  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url, disposition }) => {
    if (parseSessionLink(url)) service.openSessionLink(url);
    else openWebLink(window.webContents, url, disposition);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (parseSessionLink(url)) { event.preventDefault(); service.openSessionLink(url); return; }
    if (!isSameDocumentNavigation(window.webContents.getURL(), url)) event.preventDefault();
  });
  window.webContents.on("will-redirect", (event) => event.preventDefault());
  attachPageMenu(window.webContents);
  // The title comes from the active tab (tab-manager.ts), not from the page's <title>.
  window.on("page-title-updated", (event) => event.preventDefault());
  window.once("ready-to-show", () => { window.show(); sessionCard.prepare(); });
  // The card belongs to a row at a fixed place; any window change closes it.
  for (const name of ['blur', 'move', 'resize', 'minimize', 'hide', 'enter-full-screen', 'leave-full-screen'] as const) window.on(name as 'blur', () => sessionCard.hide());
  // Tear down in "closed" only: a "close" can still be cancelled, and a cancelled close must leave working tabs.
  window.on("closed", () => {
    if (mainWindow !== window) return;
    mainWindow = null;
    settingsWindow.close(); sessionCard.dispose();
    tabs?.dispose(); tabs = undefined; browser = undefined;
    publishedSnapshot = undefined;
    service.closeSessionPages();
  });
  void window.loadFile(join(__dirname, "../renderer/index.html"));
  return window;
};

const focusSessionLink = (url: string): void => {
  if (!url.startsWith("hermesapp:") || shutdownPhase !== "running") return;
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
  void appIcon.load();
  mcpHost.start();
  powerMonitor.on("resume", () => { void service.resumeConnection(); });
  createMainWindow();
  browserControl = new DesktopBrowserControl({
    accounts: () => service.browserAccounts(),
    tabs: () => [...(tabs?.tabs.values() ?? [])],
    // A focused separate browser window counts as the user's current Session.
    activeTabId: () => browser?.focusedPane() ?? tabs?.activeTabId,
    windowFocused: () => !!browser?.focusedPane() || !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused() && !mainWindow.isMinimized(),
    channels: () => new Map(service.snapshot(undefined, false).threads.map(thread => [thread.id, thread.channelId] as const)),
    ensureTab: async threadId => {
      if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
      try { if (!tabs) throw new Error('Window unavailable'); return tabs.ensureSessionTab(threadId); }
      catch { throw new BrowserControlError('not_ready', 'This conversation is not open on the computer yet. Try again in a moment.'); }
    },
    execute: (tabId, command, signal) => {
      if (!browser) throw new BrowserControlError('not_ready', 'Hermes is starting on the computer. Try again in a moment.');
      if (command.action === MAC_ACTION || command.action === MCP_ACTION) throw new BrowserControlError('failed', 'Not a browser action.');
      return browser.command(tabId, command.action, command.args, signal, command.timeoutMs);
    },
    mac: macDriver,
    mcp: mcpHost,
    deviceName: hostname(),
  });
  await service.initialize();
  const url = process.argv.find(value => value.startsWith("hermesapp:"));
  if (url) focusSessionLink(url);
  app.on("activate", () => { if (shutdownPhase === "running" && BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
});

// Graceful shutdown. Every quit request (Cmd+Q, the app menu, macOS logout or restart) runs one ordered
// sequence, and only then lets Electron quit. Electron's own window closing on quit is not used: any window
// whose close is refused cancels it, which left the app running without windows.
type ShutdownPhase = "running" | "stopping" | "done";
let shutdownPhase: ShutdownPhase = "running";
let lastShutdown: ShutdownRecord[] = [];
const gracefulShutdown = async (): Promise<void> => {
  lastShutdown = await runShutdown([
    // 1. No new work: Agent browser and Mac control stop taking commands; no new sends start.
    { name: "stop-intake", timeoutMs: 1_000, run: () => { browserControl?.close(); macDriver.close(); mcpHost.close(); } },
    // 2. Sends already in progress may finish; queued draft, outbox and credential writes complete.
    { name: "settle-and-save", timeoutMs: 4_000, run: () => service.prepareShutdown(3_000) },
    // 3. Windows close the normal way: helper windows first, then the main window (its tabs and pages).
    { name: "close-windows", timeoutMs: 4_000, run: async () => {
      allowUnloadDuringQuit();
      const helpers = BrowserWindow.getAllWindows().filter(window => window !== mainWindow);
      const forced = await closeWindows(helpers, 1_500);
      return [...forced, ...await closeWindows(mainWindow ? [mainWindow] : [], 2_000)];
    } },
    // 4. Server connections close and their WebSocket close handshakes finish.
    { name: "close-connections", timeoutMs: 1_500, run: async () => { service.close(); return { clean: await socketsClosed(1_000) }; } },
  ]);
};
app.on("before-quit", event => {
  if (shutdownPhase === "done") return;
  event.preventDefault();
  if (shutdownPhase === "stopping") return;
  shutdownPhase = "stopping";
  void gracefulShutdown().finally(() => {
    // Developer log only (main-process stdout): step, time and outcome; no user content.
    console.log("[shutdown] " + JSON.stringify(lastShutdown));
    shutdownPhase = "done"; app.quit();
  });
});
// Safety net only: the sequence above has already closed these.
app.on("will-quit", () => { browserControl?.close(); macDriver.close(); mcpHost.close(); service.close(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin" && shutdownPhase === "running") app.quit(); });
