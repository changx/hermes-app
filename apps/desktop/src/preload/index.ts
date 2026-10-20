import { contextBridge, ipcRenderer, webUtils } from "electron";
import { filesForUpload } from './attachment-files';
import type { DesktopUpdate } from "../shared/snapshot-delta";
import type { ChannelInput, ContextMenuItem, ProjectCreationInput, DesktopAttachment, DesktopRuntimeInfo, DesktopSnapshot, HermesDesktopApi, PairingRequest, SendMessageInput, SessionCardRequest, StartThreadInput, ThreadCreation, ThreadInput } from "../shared/desktop-api";

const runtimeInfo: DesktopRuntimeInfo = Object.freeze({
  viewRole: process.argv.includes('--hermes-settings-view') ? 'settings' : process.argv.includes('--hermes-browser-view') ? 'browser' : process.argv.includes('--hermes-tab-view') ? 'tab' : 'workspace',
  platform: process.platform,
  versions: Object.freeze({ chrome: process.versions.chrome, electron: process.versions.electron }),
});

const api: HermesDesktopApi = Object.freeze({
  addConnection: (request: PairingRequest) => ipcRenderer.invoke('desktop:add-connection', request),
  removeConnection: (id: string) => ipcRenderer.invoke('desktop:remove-connection', id),
  renameConnection: (id: string, name: string) => ipcRenderer.invoke('desktop:rename-connection', id, name),
  getAppIcon: () => ipcRenderer.invoke('desktop:get-app-icon'),
  setAppIcon: (icon: string) => ipcRenderer.invoke('desktop:set-app-icon', icon),
  getMcp: () => ipcRenderer.invoke('desktop:get-mcp'),
  saveMcp: (text: string) => ipcRenderer.invoke('desktop:save-mcp', text),
  setMcpApproval: (name: string, approval: 'ask' | 'auto') => ipcRenderer.invoke('desktop:set-mcp-approval', name, approval),
  importClaudeMcp: () => ipcRenderer.invoke('desktop:import-claude-mcp'),
  showMcpFile: (): Promise<void> => ipcRenderer.invoke('desktop:show-mcp-file'),
  getModelSettings: (connectionKey: string) => ipcRenderer.invoke('desktop:get-model-settings', connectionKey),
  setModelSettings: (connectionKey: string, provider: string, model: string, confirmSelection: boolean) => ipcRenderer.invoke('desktop:set-model-settings', connectionKey, provider, model, confirmSelection),
  openBrowser: (url?: string): Promise<void> => ipcRenderer.invoke('desktop:open-browser', url),
  previewAttachment: (id: string, sequence?: readonly string[]): Promise<void> => ipcRenderer.invoke('desktop:preview-attachment', id, sequence),
  isDiskFile: (file: File): boolean => webUtils.getPathForFile(file) !== '',
  previewLocalFile: async (file: File): Promise<void> => ipcRenderer.invoke('desktop:preview-local-file', (await filesForUpload([file], item => webUtils.getPathForFile(item)))[0]),
  browserAction: (action: 'back' | 'forward' | 'reload' | 'stop' | 'close'): Promise<void> => ipcRenderer.invoke('desktop:browser-action', action),
  browserControl: (action: 'stop' | 'resume' | 'done'): Promise<void> => ipcRenderer.invoke('desktop:browser-control', action),
  setBrowserBounds: (bounds: { x: number; y: number; width: number; height: number; visible: boolean }): Promise<void> => ipcRenderer.invoke('desktop:browser-bounds', bounds),
  setBrowserMode: (mode: 'sidebar' | 'window'): Promise<void> => ipcRenderer.invoke('desktop:set-browser-mode', mode),
  newTab: (channelId?: string, automation?: boolean): Promise<void> => ipcRenderer.invoke('desktop:new-tab', channelId, automation === true),
  activateTab: (id: string): Promise<void> => ipcRenderer.invoke('desktop:activate-tab', id),
  closeTab: (id: string): Promise<void> => ipcRenderer.invoke('desktop:close-tab', id),
  showTabMenu: (id: string, x: number, y: number): Promise<void> => ipcRenderer.invoke('desktop:tab-menu', id, x, y),
  showContextMenu: (items: readonly ContextMenuItem[], x: number, y: number): Promise<string | null> => ipcRenderer.invoke('desktop:context-menu', items, x, y),
  showSessionCard: (card: SessionCardRequest | null): Promise<void> => ipcRenderer.invoke('desktop:session-card', card),
  completeNewTab: (): Promise<void> => ipcRenderer.invoke('desktop:complete-new-tab'),
  listAutomations: (cursors?: Readonly<Record<string, string>>) => ipcRenderer.invoke('desktop:list-automations', cursors),
  openAutomationList: (): Promise<void> => ipcRenderer.invoke('desktop:open-automation-list'),
  controlAutomation: (control: string, schedule?: string) => ipcRenderer.invoke('desktop:control-automation', control, schedule),
  openAutomationEditor: (): Promise<string> => ipcRenderer.invoke('desktop:open-automation-editor'),
  deleteAutomation: (): Promise<void> => ipcRenderer.invoke('desktop:delete-automation'),
  openAutomation: (id: string, title: string): Promise<void> => ipcRenderer.invoke('desktop:open-automation', id, title),
  getAutomation: (before?: number) => ipcRenderer.invoke('desktop:get-automation', before),
  setContentBounds: (bounds: { x: number; y: number; width: number; height: number; visible: boolean }): Promise<void> => ipcRenderer.invoke('desktop:content-bounds', bounds),
  getRuntimeInfo: (): DesktopRuntimeInfo => runtimeInfo,
  openSettings: (connectionId?: string): Promise<void> => connectionId === undefined ? ipcRenderer.invoke('desktop:open-settings') : ipcRenderer.invoke('desktop:open-settings', connectionId),
  getSnapshot: (): Promise<DesktopSnapshot> => ipcRenderer.invoke("desktop:get-snapshot"),
  subscribe(listener: (snapshot: DesktopUpdate) => void): () => void {
    const receive = (_event: Electron.IpcRendererEvent, snapshot: DesktopUpdate) => listener(snapshot);
    ipcRenderer.on("desktop:snapshot", receive);
    return () => ipcRenderer.removeListener("desktop:snapshot", receive);
  },
  pair: (request: PairingRequest): Promise<void> => ipcRenderer.invoke("desktop:pair", request),
  cancelPairing: (): Promise<void> => ipcRenderer.invoke("desktop:cancel-pairing"),
  forgetConnection: (): Promise<void> => ipcRenderer.invoke("desktop:forget-connection"),
  loadLocalDrafts: (identity: string) => ipcRenderer.invoke("desktop:load-local-drafts", identity),
  saveLocalDraft: (identity: string, threadId: string, draft: import('../shared/desktop-api').DesktopLocalDraft) => ipcRenderer.invoke("desktop:save-local-draft", identity, threadId, draft),
  selectChannel: (channelId: string): Promise<void> => ipcRenderer.invoke("desktop:select-channel", channelId),
  selectThread: (threadId: string): Promise<void> => ipcRenderer.invoke("desktop:select-thread", threadId),
  closeSessionPage: (threadId: string): Promise<void> => ipcRenderer.invoke("desktop:close-session-page", threadId),
  openSessionLink: (url: string): Promise<void> => ipcRenderer.invoke("desktop:open-session-link", url),
  copySessionLink: (threadId?: string): Promise<void> => threadId === undefined ? ipcRenderer.invoke("desktop:copy-session-link") : ipcRenderer.invoke("desktop:copy-session-link", threadId),
  searchLabel: (label: string): Promise<void> => ipcRenderer.invoke("desktop:search-label", label),
  onSearchLabel(listener: (label: string) => void): () => void {
    const receive = (_event: Electron.IpcRendererEvent, label: unknown) => { if (typeof label === 'string') listener(label); };
    ipcRenderer.on("desktop:search-label", receive);
    return () => ipcRenderer.removeListener("desktop:search-label", receive);
  },
  revealProject: (channelId: string): Promise<void> => ipcRenderer.invoke("desktop:reveal-project", channelId),
  onRevealProject(listener: (channelId: string) => void): () => void {
    const receive = (_event: Electron.IpcRendererEvent, channelId: unknown) => { if (typeof channelId === 'string') listener(channelId); };
    ipcRenderer.on("desktop:reveal-project", receive);
    return () => ipcRenderer.removeListener("desktop:reveal-project", receive);
  },
  onFocusComposer(listener: () => void): () => void {
    const receive = () => listener();
    ipcRenderer.on("desktop:focus-composer", receive);
    return () => ipcRenderer.removeListener("desktop:focus-composer", receive);
  },
  onToggleTodo(listener: () => void): () => void {
    const receive = () => listener();
    ipcRenderer.on("desktop:toggle-todo", receive);
    return () => ipcRenderer.removeListener("desktop:toggle-todo", receive);
  },
  markResultRead: (threadId: string, version: number, ref: number): Promise<void> => ipcRenderer.invoke("desktop:result-read", threadId, version, ref),
  retryConnection: (): Promise<void> => ipcRenderer.invoke("desktop:retry-connection"),
  dismissError: (threadId?: string): Promise<void> => ipcRenderer.invoke("desktop:dismiss-error", threadId),
  createChannel: (input: ProjectCreationInput): Promise<string> => ipcRenderer.invoke("desktop:create-channel", input),
  updateChannel: (channelId: string, input: ChannelInput): Promise<void> => ipcRenderer.invoke("desktop:update-channel", channelId, input),
  deleteChannel: (channelId: string): Promise<void> => ipcRenderer.invoke("desktop:delete-channel", channelId),
  archiveChannel: (channelId: string): Promise<void> => ipcRenderer.invoke("desktop:archive-channel", channelId),
  getProjectWorkspace: (channelId: string) => ipcRenderer.invoke("desktop:get-project-workspace", channelId),
  saveProjectAgents: (channelId: string, content: string, previousEtag: string | null) => ipcRenderer.invoke("desktop:save-project-agents", channelId, content, previousEtag),
  setProjectFolder: (channelId: string, path: string | null) => ipcRenderer.invoke("desktop:set-project-folder", channelId, path),
  createThread: (input: ThreadInput): Promise<ThreadCreation> => ipcRenderer.invoke("desktop:create-thread", input),
  startThread: (input: StartThreadInput): Promise<string> => ipcRenderer.invoke("desktop:start-thread", input),
  renameThread: (threadId: string, title: string): Promise<void> => ipcRenderer.invoke("desktop:rename-thread", threadId, title),
  saveThreadLabels: (threadId: string, markers: string[], timestamp: number, connectionKey: string) => ipcRenderer.invoke('desktop:save-thread-labels', threadId, markers, timestamp, connectionKey),
  archiveThread: (threadId: string): Promise<void> => ipcRenderer.invoke("desktop:archive-thread", threadId),
  loadOlder: (): Promise<void> => ipcRenderer.invoke("desktop:load-older"),
  getChannelInfo: (channelId: string) => ipcRenderer.invoke("desktop:get-channel-info", channelId),
  sendMessage: (input: SendMessageInput): Promise<void> => ipcRenderer.invoke("desktop:send-message", input),
  retryMessage: (clientMessageId: string): Promise<void> => ipcRenderer.invoke("desktop:retry-message", clientMessageId),
  branchFromMessage: (refSeq: number) => ipcRenderer.invoke("desktop:branch-message", refSeq),
  messageSources: (refSeq: number) => ipcRenderer.invoke("desktop:message-sources", refSeq),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke("desktop:copy-text", text),
  exportMessage: (text: string) => ipcRenderer.invoke("desktop:export-message", text),
  exportConversation: () => ipcRenderer.invoke("desktop:export-conversation"),
  retryLatest: (): Promise<void> => ipcRenderer.invoke("desktop:retry-latest"),
  stopThread: (): Promise<void> => ipcRenderer.invoke("desktop:stop-thread"),
  cancelQueued: (receiptId: string): Promise<void> => ipcRenderer.invoke("desktop:cancel-queued", receiptId),
  answerInteraction: (interactionId: string, choice: string): Promise<void> => ipcRenderer.invoke("desktop:answer-interaction", interactionId, choice),
  pickAndUploadAttachments: (threadId?: string): Promise<readonly DesktopAttachment[]> => ipcRenderer.invoke("desktop:pick-attachments", threadId),
  uploadDroppedFiles: async (files: readonly File[], threadId?: string): Promise<readonly DesktopAttachment[]> => ipcRenderer.invoke("desktop:drop-attachments", await filesForUpload(files, file => webUtils.getPathForFile(file)), threadId),
  deleteUnattachedAttachment: (attachmentId: string): Promise<void> => ipcRenderer.invoke("desktop:delete-attachment", attachmentId),
  previewAttachmentImage: (attachmentId: string): Promise<string> => ipcRenderer.invoke("desktop:preview-image", attachmentId),
  listSessionFiles: (list: 'delivered' | 'uploaded', after?: string) => ipcRenderer.invoke("desktop:list-session-files", list, after),
  prepareSessionFile: (id: string) => ipcRenderer.invoke("desktop:prepare-session-file", id),
  searchFiles: (query: string, labels: readonly string[], cursors?: Readonly<Record<string, string>>) => ipcRenderer.invoke("desktop:search-files", query, [...labels], cursors),
  openSessionFile: (threadId: string, id: string, action: 'open' | 'save') => ipcRenderer.invoke("desktop:open-session-file", threadId, id, action),
  openMessage: (threadId: string, refSeq: number) => ipcRenderer.invoke("desktop:open-message", threadId, refSeq),
  downloadAttachment: (attachmentId: string, action: "save" | "open"): Promise<void> => ipcRenderer.invoke("desktop:download-attachment", attachmentId, action),
  onDownloadProgress(listener: (progress: { attachmentId: string; received: number; total?: number }) => void): () => void {
    const receive = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const item = value as { attachmentId?: unknown; received?: unknown; total?: unknown } | null;
      if (item && typeof item.attachmentId === 'string' && typeof item.received === 'number')
        listener({ attachmentId: item.attachmentId, received: item.received, ...(typeof item.total === 'number' ? { total: item.total } : {}) });
    };
    ipcRenderer.on("desktop:download-progress", receive);
    return () => ipcRenderer.removeListener("desktop:download-progress", receive);
  },
});

contextBridge.exposeInMainWorld("hermesDesktop", api);
