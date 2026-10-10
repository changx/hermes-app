import type { AgentModelSettings, ModelSelectionConfirmation, ConnectionState, ReceiptProcessing, ReceiptState } from "@hermes-app/client";
import type { DesktopUpdate } from "./snapshot-delta";
import type { LabelDetail } from '../../../../packages/client/src/sessionLabels';

export type DesktopPhase = "restoring" | "unpaired" | "pairing" | "connected";
export type DesktopBrowserMode = 'sidebar' | 'window';
export type DesktopBrowserState = Readonly<{ open: boolean; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; error?: string;
  /** Saved download and similar one-line results. */ notice?: string;
  /** Agent control of this page: Hermes working, the user took over, or Hermes waits for the user. */
  control?: 'agent' | 'user' | 'waiting'; controlMessage?: string }>;

export type DesktopChannel = Readonly<{ id: string; name: string; description?: string; connectionName?: string; connectionKey?: string;
  /** Server folder bound as the project's primary folder (getChannelInfo only). */ primaryPath?: string; primaryPathSupported?: boolean;
  /** The server archives projects (getChannelInfo only). */ archiveSupported?: boolean }>;
export type DesktopConnection = Readonly<{ id: string; name: string; server: string; state: ConnectionState | 'pairing'; detail?: string; connectionKey?: string; supportsProjectFiles?: boolean; supportsPrimaryPath?: boolean; supportsChannelArchive?: boolean;
  /** Name used when this device has no name of its own: the server's host name. */ defaultName?: string; /** True when `name` was chosen on this device. */ customName?: boolean }>;
export type DesktopThread = Readonly<{
  supportsSessionLabels?: boolean;
  id: string;
  channelId: string;
  title: string;
  title_alphabet?: string;
  markers?: readonly string[];
  markersUpdatedAt?: number;

  lastMessageAt?: number;
  running: boolean;
  completedUnread?: boolean;
  resultVersion?: number;
  resultRef?: number;
}>;
export type DesktopToolCall = Readonly<{ id: string; name?: string; label: string; detail?: string; caption?: string; icon?: string }>;
export type DesktopAttachment = Readonly<{
  id: string;
  name: string;
  mime: string;
  size: number;
  publicUrl?: string;
  state: "available" | "missing" | "deleted" | "uploading";
}>;
export type DesktopInteraction = Readonly<{
  id: string;
  kind: "approval" | "clarify";
  prompt: string;
  choices: readonly string[];
}>;
export type DesktopMessage = Readonly<{
  id: string;
  role: "user" | "assistant" | "system";
  displayKind?: "direct" | "final" | "system_notice";
  noticeKind?: "review" | "compression" | "branch";
  text: string;
  refSeq?: number;
  clientMessageId?: string;
  receiptId?: string;
  createdAt?: number;
  receiptState?: ReceiptState;
  processing?: ReceiptProcessing;
  feedback?: string;
  optimistic?: boolean;
  toolCalls: readonly DesktopToolCall[];
  attachments: readonly DesktopAttachment[];
}>;
export type DesktopSnapshot = Readonly<{
  connections?: readonly DesktopConnection[];
  connectionsError?: string;
  browser?: DesktopBrowserState;
  /** Built-in sidebar or one separate window per Session. */
  browserMode?: DesktopBrowserMode;
  tabs?: readonly Readonly<{ id: string; title: string; threadId?: string; initialChannelId?: string; kind: 'new' | 'session' }>[];
  activeTabId?: string;
  tabId?: string;
  tabActive?: boolean;
  tabKind?: 'new' | 'session';
  initialChannelId?: string;
  connectionName?: string;
  draftThreadIds?: readonly string[];
  draftIdentity?: string;
  revision: number;
  phase: DesktopPhase;
  connectionState: ConnectionState;
  connectionLabel: string;
  connectionKey?: string;
  supportsSessionLabels?: boolean;
  /** Server reports the branch endpoint, message sources and conversation export. */
  supportsThreadBranch?: boolean;
  supportsMessageSources?: boolean;
  supportsThreadExport?: boolean;
  loadingConversations?: boolean;
  loadingMessages?: boolean;
  loadingHistory?: boolean;
  statusMessage?: string;
  errorMessage?: string;
  channels: readonly DesktopChannel[];
  threads: readonly DesktopThread[];
  messages: readonly DesktopMessage[];
  interactions: readonly DesktopInteraction[];
  selectedChannelId?: string;
  selectedThreadId?: string;
  selectedThreadTitle?: string;
  canLoadOlder: boolean;
  sessionPages?: readonly Readonly<{ id: string; messages: readonly DesktopMessage[];
    interactions: readonly DesktopInteraction[]; loadingMessages?: boolean; loadingHistory?: boolean;
    canLoadOlder: boolean; selectedThreadTitle?: string }>[];
}>;

export type PairingRequest = Readonly<{ baseUrl: string; code: string; deviceName: string }>;
export type ChannelInput = Readonly<{ name: string; description: string }>;
export type ProjectCreationInput = ChannelInput & Readonly<{ connectionKey: string }>;
/** Project Files and AGENTS.md from the plugin workspace API. `supported: false` hides both sections. */
export type DesktopProjectFile = Readonly<{ name: string; kind: 'file' | 'directory' | 'unavailable'; size: number | null }>;
export type DesktopProjectWorkspace = Readonly<{
  supported: boolean;
  agents: Readonly<{ content: string; etag: string }> | null;
  files: readonly DesktopProjectFile[];
  moreFiles: boolean;
}>;
/** `invalid`: the server cannot use the folder; `taken`: another project already uses it. */
export type ProjectFolderResult = Readonly<{ ok: true } | { ok: false; reason: 'invalid' | 'taken' | 'failed' }>;
export type ProjectAgentsResult = Readonly<{ ok: true; etag: string } | { ok: false; reason: 'conflict' | 'failed' }>;
export type ProjectFilesResult = Readonly<{ uploaded: readonly string[]; failed?: Readonly<{ name: string; reason: 'exists' | 'invalid' | 'failed' }> }>;
export type ThreadInput = Readonly<{ title: string; clientThreadId: string; channelId?: string }>;
export type SendMessageInput = Readonly<{ text: string; attachmentIds: readonly string[]; clientMessageId?: string }>;
export type DesktopLocalDraft = Readonly<{ text: string; attachments: readonly DesktopAttachment[] }>;
/** A page the agent opened ('read') or a link its reply cites ('cited'). */
export type DesktopMessageSource = Readonly<{ url: string; kind: 'read' | 'cited' }>;
export type BranchResult = Readonly<{ ok: true } | { ok: false; reason: 'busy' | 'unavailable' | 'failed' }>;
export type ExportResult = Readonly<{ ok: true; saved: boolean } | { ok: false }>;
export type DesktopRuntimeInfo = Readonly<{
  viewRole?: 'workspace' | 'tab' | 'settings' | 'browser';
  platform: NodeJS.Platform;
  versions: Readonly<{ chrome: string; electron: string }>;
}>;

export interface HermesDesktopApi {
  addConnection(request: PairingRequest): Promise<void>;
  removeConnection(connectionId: string): Promise<void>;
  /** Saves this device's name for a connection; an empty name restores the host name. */
  renameConnection(connectionId: string, name: string): Promise<void>;
  getModelSettings(connectionKey: string): Promise<AgentModelSettings>;
  setModelSettings(connectionKey: string, provider: string, model: string, confirmSelection: boolean): Promise<AgentModelSettings | ModelSelectionConfirmation>;
  openBrowser(url?: string): Promise<void>;
  previewAttachment(attachmentId: string): Promise<void>;
  previewLocalFile(file: File): Promise<void>;
  browserAction(action: 'back' | 'forward' | 'reload' | 'stop' | 'close'): Promise<void>;
  /** Stop Hermes, let Hermes continue after a takeover, or tell Hermes the user finished. */
  browserControl(action: 'stop' | 'resume' | 'done'): Promise<void>;
  setBrowserBounds(bounds: { x: number; y: number; width: number; height: number; visible: boolean }): Promise<void>;
  /** Built-in sidebar or separate windows; moves open pages without reloading them. */
  setBrowserMode(mode: DesktopBrowserMode): Promise<void>;
  newTab(channelId?: string): Promise<void>;
  activateTab(tabId: string): Promise<void>;
  closeTab(tabId: string): Promise<void>;
  /** Show the native Close Tab / Close Tabs to the Right / Close Other Tabs menu at window coordinates. */
  showTabMenu(tabId: string, x: number, y: number): Promise<void>;
  completeNewTab(): Promise<void>;
  setContentBounds(bounds: { x: number; y: number; width: number; height: number; visible: boolean }): Promise<void>;
  getRuntimeInfo(): DesktopRuntimeInfo;
  /** Opens or focuses the single native Settings window. */
  openSettings(): Promise<void>;
  getSnapshot(): Promise<DesktopSnapshot>;
  subscribe(listener: (snapshot: DesktopUpdate) => void): () => void;
  pair(request: PairingRequest): Promise<void>;
  cancelPairing(): Promise<void>;
  forgetConnection(): Promise<void>;
  loadLocalDrafts(identity: string): Promise<Record<string, DesktopLocalDraft>>;
  saveLocalDraft(identity: string, threadId: string, draft: DesktopLocalDraft): Promise<void>;
  selectChannel(channelId: string): Promise<void>;
  selectThread(threadId: string): Promise<void>;
  closeSessionPage(threadId: string): Promise<void>;
  openSessionLink(url: string): Promise<void>;
  copySessionLink(): Promise<void>;
  /** A Session page asks the main window's sidebar to search for sessions with this label. */
  searchLabel(label: string): Promise<void>;
  /** The main window receives label searches requested by Session pages. */
  onSearchLabel(listener: (label: string) => void): () => void;
  markResultRead(threadId: string, version: number, ref: number): Promise<void>;
  retryConnection(): Promise<void>;
  /** Resolves with the new Project's identity after server readback. */
  createChannel(input: ProjectCreationInput): Promise<string>;
  updateChannel(channelId: string, input: ChannelInput): Promise<void>;
  deleteChannel(channelId: string): Promise<void>;
  archiveChannel(channelId: string): Promise<void>;
  getProjectWorkspace(channelId: string): Promise<DesktopProjectWorkspace>;
  /** `previousEtag === null` creates AGENTS.md only if it does not exist. */
  saveProjectAgents(channelId: string, content: string, previousEtag: string | null): Promise<ProjectAgentsResult>;
  /** A path binds the primary folder; null removes the binding. */
  setProjectFolder(channelId: string, path: string | null): Promise<ProjectFolderResult>;
  /** Adds new root files. Never replaces an existing file. Stops at the first failure. */
  addProjectFiles(channelId: string, files: readonly File[]): Promise<ProjectFilesResult>;
  createThread(input: ThreadInput): Promise<string>;
  renameThread(threadId: string, title: string): Promise<void>;
  saveThreadLabels(threadId: string, markers: string[], timestamp: number, connectionKey: string): Promise<LabelDetail>;
  archiveThread(threadId: string): Promise<void>;
  loadOlder(): Promise<void>;
  getChannelInfo(channelId: string): Promise<DesktopChannel>;
  sendMessage(input: SendMessageInput): Promise<void>;
  retryMessage(clientMessageId: string): Promise<void>;
  /** New Session from this tab's final reply; opens it on success. */
  branchFromMessage(refSeq: number): Promise<BranchResult>;
  messageSources(refSeq: number): Promise<readonly DesktopMessageSource[]>;
  copyText(text: string): Promise<void>;
  /** Save dialogs; `saved: false` when the user cancels. */
  exportMessage(text: string): Promise<ExportResult>;
  exportConversation(): Promise<ExportResult>;
  /** Re-run this tab's latest turn (native /retry). */
  retryLatest(): Promise<void>;
  stopThread(): Promise<void>;
  cancelQueued(receiptId: string): Promise<void>;
  answerInteraction(interactionId: string, choice: string): Promise<void>;
  pickAndUploadAttachments(threadId?: string): Promise<readonly DesktopAttachment[]>;
  uploadDroppedFiles(files: readonly File[], threadId?: string): Promise<readonly DesktopAttachment[]>;
  deleteUnattachedAttachment(attachmentId: string): Promise<void>;
  downloadAttachment(attachmentId: string, action: "save" | "open"): Promise<void>;
  previewAttachmentImage(attachmentId: string): Promise<string>;
}
