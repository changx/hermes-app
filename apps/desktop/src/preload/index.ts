import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { DesktopUpdate } from "../shared/snapshot-delta";
import type { ChannelInput, DesktopAttachment, DesktopRuntimeInfo, DesktopSnapshot, HermesDesktopApi, PairingRequest, SendMessageInput, ThreadInput } from "../shared/desktop-api";

const runtimeInfo: DesktopRuntimeInfo = Object.freeze({
  platform: process.platform,
  versions: Object.freeze({ chrome: process.versions.chrome, electron: process.versions.electron }),
});

const api: HermesDesktopApi = Object.freeze({
  getRuntimeInfo: (): DesktopRuntimeInfo => runtimeInfo,
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
  copySessionLink: (): Promise<void> => ipcRenderer.invoke("desktop:copy-session-link"),
  markResultRead: (threadId: string, version: number, ref: number): Promise<void> => ipcRenderer.invoke("desktop:result-read", threadId, version, ref),
  retryConnection: (): Promise<void> => ipcRenderer.invoke("desktop:retry-connection"),
  createChannel: (input: ChannelInput): Promise<void> => ipcRenderer.invoke("desktop:create-channel", input),
  updateChannel: (channelId: string, input: ChannelInput): Promise<void> => ipcRenderer.invoke("desktop:update-channel", channelId, input),
  deleteChannel: (channelId: string): Promise<void> => ipcRenderer.invoke("desktop:delete-channel", channelId),
  createThread: (input: ThreadInput): Promise<string> => ipcRenderer.invoke("desktop:create-thread", input),
  renameThread: (threadId: string, title: string): Promise<void> => ipcRenderer.invoke("desktop:rename-thread", threadId, title),
  archiveThread: (threadId: string): Promise<void> => ipcRenderer.invoke("desktop:archive-thread", threadId),
  loadOlder: (): Promise<void> => ipcRenderer.invoke("desktop:load-older"),
  getChannelInfo: (channelId: string) => ipcRenderer.invoke("desktop:get-channel-info", channelId),
  sendMessage: (input: SendMessageInput): Promise<void> => ipcRenderer.invoke("desktop:send-message", input),
  retryMessage: (clientMessageId: string): Promise<void> => ipcRenderer.invoke("desktop:retry-message", clientMessageId),
  stopThread: (): Promise<void> => ipcRenderer.invoke("desktop:stop-thread"),
  cancelQueued: (receiptId: string): Promise<void> => ipcRenderer.invoke("desktop:cancel-queued", receiptId),
  answerInteraction: (interactionId: string, choice: string): Promise<void> => ipcRenderer.invoke("desktop:answer-interaction", interactionId, choice),
  pickAndUploadAttachments: (threadId?: string): Promise<readonly DesktopAttachment[]> => ipcRenderer.invoke("desktop:pick-attachments", threadId),
  uploadDroppedFiles: (files: readonly File[], threadId?: string): Promise<readonly DesktopAttachment[]> => ipcRenderer.invoke("desktop:drop-attachments", files.map((file) => webUtils.getPathForFile(file)), threadId),
  deleteUnattachedAttachment: (attachmentId: string): Promise<void> => ipcRenderer.invoke("desktop:delete-attachment", attachmentId),
  previewAttachmentImage: (attachmentId: string): Promise<string> => ipcRenderer.invoke("desktop:preview-image", attachmentId),
  downloadAttachment: (attachmentId: string, action: "save" | "open"): Promise<void> => ipcRenderer.invoke("desktop:download-attachment", attachmentId, action),
});

contextBridge.exposeInMainWorld("hermesDesktop", api);
