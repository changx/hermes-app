import type { AgentModelSettings, EnvKey, EnvKeys, ModelSelectionConfirmation, NewVaultItem, VaultImportResult, VaultItem, VaultItemChange, ConnectionState, ReceiptProcessing, ReceiptState, ThreadModelChoice } from "@hermes-app/client";
import type { DesktopUpdate } from "./snapshot-delta";
import type { LabelDetail } from '../../../../packages/client/src/sessionLabels';
import type { Automation, AutomationThread } from '../../../../packages/client/src/automations';

export type DesktopTabKind = 'new' | 'session' | 'automation' | 'automations' | 'remote-screen';
export type DesktopPhase = "restoring" | "unpaired" | "pairing" | "connected";
export type DesktopBrowserMode = 'sidebar' | 'window';
export type DesktopBrowserState = Readonly<{ open: boolean; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; error?: string;
  /** Saved download and similar one-line results. */ notice?: string;
  /** Agent control of this page: Hermes working, the user took over, or Hermes waits for the user. */
  control?: 'agent' | 'user' | 'waiting'; controlMessage?: string }>;

export type DesktopChannel = Readonly<{ id: string; name: string; description?: string; connectionName?: string; connectionKey?: string;
  /** The Channel's server accepts a model when a session is created. */ supportsThreadModel?: boolean;
  /** The Channel's server can create automations in a settings conversation. */ supportsAutomationEditors?: boolean;
  /** Server folder bound as the project's primary folder (getChannelInfo only). */ primaryPath?: string; primaryPathSupported?: boolean;
  /** The server archives projects (getChannelInfo only). */ archiveSupported?: boolean }>;
export type DesktopConnection = Readonly<{ id: string; name: string; server: string; state: ConnectionState | 'pairing'; detail?: string; connectionKey?: string; supportsProjectFiles?: boolean; supportsPrimaryPath?: boolean; supportsChannelArchive?: boolean;
  /** The server's remote screen (docs/remote-screen.md): the name the sidebar shows. */ remoteScreen?: Readonly<{ name: string }>;
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
  origin?: "user" | "automation";
  participated?: boolean;
}>;
/** A scheduled job. IDs (job, channels, Threads) are qualified like every other desktop ID. */
export type DesktopAutomation = Automation & Readonly<{ connectionKey?: string; connectionName?: string }>;
/** Sidebar Automations: jobs of every connection that offers them. `supported` is false when none does. */
export type DesktopAutomationList = Readonly<{ supported: boolean; automations: readonly DesktopAutomation[];
  /** Connections whose list could not be loaded. */ failed: readonly string[];
  /** Next page per connection (opaque); empty when every list is complete. */ cursors?: Readonly<Record<string, string>>;
  /** Some connection can create automations (settings conversations). */ canCreate?: boolean }>;
export type DesktopAutomationControl = 'pause' | 'resume' | 'run' | 'schedule';
export type DesktopAutomationPage = Readonly<{ state: 'ok'; automation: DesktopAutomation; threads: readonly AutomationThread[]; nextBefore: number | null }
  | { state: 'missing' | 'unsupported' }>;
export type DesktopToolCall = Readonly<{ id: string; name?: string; label: string; detail?: string; caption?: string; icon?: string }>;
export type DesktopAttachment = Readonly<{
  id: string;
  name: string;
  mime: string;
  size: number;
  publicUrl?: string;
  /** Web page link of a published HTML attachment, on the connection's own server. */
  pageUrl?: string;
  state: "available" | "missing" | "deleted" | "uploading";
}>;
export type DesktopInteraction = Readonly<{
  id: string;
  kind: "approval" | "clarify";
  prompt: string;
  choices: readonly string[];
}>;
/** An open in-chat vault prompt (docs/vault.md): a login to save or a one-time code to enter. */
export type DesktopVaultPrompt = Readonly<{ id: string; kind: "save_login" | "code"; site: string; origin: string; hint: string;
  /** save_login: the saved password for this address did not work; the new one replaces it. */
  update?: boolean; identifier?: string;
  /** save_login: saved logins of the same site on another address. */
  matches?: readonly Readonly<{ id: string; label: string; identifier: string; origin: string }>[] }>;
export type DesktopVaultAnswer = Readonly<{ decision: "decline" } | { decision: "submit"; identifier: string; password: string; otp_secret?: string } | { decision: "submit"; code: string } | { decision: "use"; item_id: string }>;
/** ok: sent; invalid: the server rejected a value and the card stays open; failed: the prompt is gone. */
export type DesktopVaultAnswerResult = "ok" | "invalid" | "failed";
export type DesktopMessage = Readonly<{
  id: string;
  role: "user" | "assistant" | "system";
  displayKind?: "direct" | "final" | "system_notice";
  noticeKind?: "review" | "compression" | "branch";
  text: string;
  /** Model that produced a final reply, when the server reports it. */
  model?: string;
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
  /** Settings window only: the page a Session page asked for. A new nonce is a new request. */
  settingsRequest?: Readonly<{ page: string; nonce: number }>;
  browser?: DesktopBrowserState;
  /** Built-in sidebar or one separate window per Session. */
  browserMode?: DesktopBrowserMode;
  tabs?: readonly Readonly<{ id: string; title: string; threadId?: string; initialChannelId?: string; automationId?: string; automationEditor?: boolean; kind: DesktopTabKind }>[];
  activeTabId?: string;
  tabId?: string;
  tabActive?: boolean;
  tabKind?: DesktopTabKind;
  /** The job an Automation tab shows. */
  automationId?: string;
  /** A New chat tab that creates an automation's settings conversation. */
  automationEditor?: boolean;
  /** Remote browser window: the screen's name and whether its connection is online. */
  remoteScreen?: Readonly<{ name: string; online: boolean }>;
  initialChannelId?: string;
  connectionName?: string;
  draftThreadIds?: readonly string[];
  draftIdentity?: string;
  revision: number;
  /** Changes after a job is deleted; the Automations lists reload. */
  automationsVersion?: number;
  phase: DesktopPhase;
  connectionState: ConnectionState;
  connectionLabel: string;
  connectionKey?: string;
  supportsThreadModel?: boolean;
  supportsAutomationEditors?: boolean;
  supportsSessionLabels?: boolean;
  /** Server reports the branch endpoint, message sources and conversation export. */
  supportsThreadBranch?: boolean;
  supportsMessageSources?: boolean;
  supportsThreadExport?: boolean;
  /** Server lists each Session's delivered and uploaded files. */
  supportsSessionFiles?: boolean;
  /** Main window: some connected server searches files. */
  supportsFileSearch?: boolean;
  /** Main window: some connected server searches message text (Session full-text search). */
  supportsSessionSearch?: boolean;
  /** Settings > Passwords & Logins on this connection. */
  supportsVault?: boolean;
  loadingConversations?: boolean;
  loadingMessages?: boolean;
  loadingHistory?: boolean;
  statusMessage?: string;
  errorMessage?: string;
  /** True when errorMessage reports a finished action, not a live connection problem; the user may close it. */
  errorDismissible?: boolean;
  channels: readonly DesktopChannel[];
  threads: readonly DesktopThread[];
  messages: readonly DesktopMessage[];
  interactions: readonly DesktopInteraction[];
  /** Open vault prompts of the selected conversation; absent on older servers. */
  vaultPrompts?: readonly DesktopVaultPrompt[];
  selectedChannelId?: string;
  selectedThreadId?: string;
  selectedThreadTitle?: string;
  canLoadOlder: boolean;
  /** Session page: show this message (a file search result). A new `version` asks again for the same message. */
  focusMessage?: DesktopMessageFocus;
  sessionPages?: readonly Readonly<{ id: string; messages: readonly DesktopMessage[];
    interactions: readonly DesktopInteraction[]; vaultPrompts?: readonly DesktopVaultPrompt[]; loadingMessages?: boolean; loadingHistory?: boolean;
    canLoadOlder: boolean; selectedThreadTitle?: string; focusMessage?: DesktopMessageFocus }>[];
}>;

export type PairingRequest = Readonly<{ baseUrl: string; code: string; deviceName: string }>;
export type ChannelInput = Readonly<{ name: string; description: string }>;
export type ProjectCreationInput = ChannelInput & Readonly<{ connectionKey: string }>;
/** Project AGENTS.md from the plugin workspace API. `supported: false` hides the editor. */
export type DesktopProjectWorkspace = Readonly<{
  supported: boolean;
  agents: Readonly<{ content: string; etag: string }> | null;
}>;
export type DesktopMessageFocus = Readonly<{ refSeq: number; version: number }>;
/** A file of one Session: delivered by the Agent (MEDIA:) or uploaded by the user. See docs/session-files.md. */
export type DesktopSessionFile = Readonly<{ id: string; threadId: string; name: string; mime: string; size: number; state: 'available' | 'missing';
  list: 'delivered' | 'uploaded'; createdAt: number; caption?: string;
  /** The message that delivered or sent the file, when the server knows it. */
  refSeq?: number }>;
export type DesktopSessionFilePage = Readonly<{ supported: boolean; items: readonly DesktopSessionFile[]; nextAfter: string | null }>;
/** A file search result. `threadId` and `channelId` are qualified like every other desktop ID. */
/** `rank` (1 = best) when the server ranked its results by meaning and keywords. */
export type DesktopFileHit = DesktopSessionFile & Readonly<{ threadTitle: string; channelId: string; channelName?: string; connectionName?: string; rank?: number }>;
/** File search over every connected server that offers it. `cursors` (by connection) continues each list. */
export type DesktopFileSearch = Readonly<{ supported: boolean; items: readonly DesktopFileHit[]; failed: readonly string[]; cursors: Readonly<Record<string, string>> }>;
/** A Session whose messages match (qualified IDs). `refSeq`: the best matching message; absent when only the title or labels matched. */
export type DesktopMessageHit = Readonly<{ threadId: string; title: string; channelId: string; channelName: string; connectionName?: string;
  markers: readonly string[]; refSeq?: number; snippet: string; rank: number }>;
/**
 * Session full-text search over every connected server that offers it. `indexing`: a server is
 * still indexing older messages. `refined`: a model picked and ordered the rows; `none`: it found no fit.
 */
export type DesktopMessageSearch = Readonly<{ supported: boolean; items: readonly DesktopMessageHit[]; failed: readonly string[]; indexing: boolean; refined: boolean; none: boolean }>;
/** `invalid`: the server cannot use the folder; `taken`: another project already uses it. */
export type ProjectFolderResult = Readonly<{ ok: true } | { ok: false; reason: 'invalid' | 'taken' | 'failed' }>;
export type ProjectAgentsResult = Readonly<{ ok: true; etag: string } | { ok: false; reason: 'conflict' | 'failed' }>;
/** `model` applies to the new session only; omit it for the connection's primary model. */
export type ThreadInput = Readonly<{ title: string; clientThreadId: string; channelId?: string; model?: ThreadModelChoice; confirmModel?: boolean;
  /** Set by the main process for a New automation tab, never by the renderer. */ automationEditor?: boolean }>;
/** A session ID; or nothing created: confirm the model warning, or the server rejected the model. */
export type ThreadCreation = string | ModelSelectionConfirmation | Readonly<{ model_rejected: true }>;
export type SendMessageInput = Readonly<{ text: string; attachmentIds: readonly string[]; clientMessageId?: string }>;
/** A new session and its first text message, started at once: the first message is saved in
 * the outbox, the tab opens, and the session is created on the server in the background. */
export type StartThreadInput = Readonly<{ title: string; clientThreadId: string; channelId?: string; text: string; clientMessageId: string;
  /** Set by the main process for a New automation tab, never by the renderer. */ automationEditor?: boolean }>;
export type DesktopLocalDraft = Readonly<{ text: string; attachments: readonly DesktopAttachment[] }>;
/** A page the agent opened ('read') or a link its reply cites ('cited'). */
export type DesktopMessageSource = Readonly<{ url: string; kind: 'read' | 'cited' }>;
export type FindAction = 'open' | 'next' | 'previous' | 'selection';
/** A native context-menu entry. `id` comes back when the user chooses the item. */
export type ContextMenuItem = Readonly<{ id: string; label: string; enabled?: boolean } | { separator: true }>;
export type BranchResult = Readonly<{ ok: true } | { ok: false; reason: 'busy' | 'unavailable' | 'failed' }>;
export type ExportResult = Readonly<{ ok: true; saved: boolean } | { ok: false }>;
export type DesktopRuntimeInfo = Readonly<{
  viewRole?: 'workspace' | 'tab' | 'settings' | 'browser' | 'remote-screen';
  platform: NodeJS.Platform;
  versions: Readonly<{ chrome: string; electron: string }>;
}>;

/** Dock icon choices; `mochi` is the packaged default. */
export const DESKTOP_APP_ICONS = ['mochi', 'bubble', 'orb'] as const;
export type DesktopAppIconId = typeof DESKTOP_APP_ICONS[number];
/** `dock`: this computer shows the choice in the Dock (macOS). */
export type DesktopAppIconState = Readonly<{ icon: DesktopAppIconId; dock: boolean }>;
/** MCP servers this computer runs for the Agent (Settings > MCP servers). See docs/desktop-mcp-host.md. */
export type DesktopMcpServerState = Readonly<{ name: string; kind: 'stdio' | 'http'; approval: 'ask' | 'auto'; disabled: boolean; status: 'stopped' | 'starting' | 'running' | 'failed'; message?: string }>;
export type DesktopMcpState = Readonly<{ path: string; text: string; error?: string; claudeAvailable: boolean; servers: readonly DesktopMcpServerState[] }>;
/** A change either succeeds with the new state or fails with a message for the user; the file is unchanged on failure. */
export type DesktopMcpResult = Readonly<{ ok: true; state: DesktopMcpState; added?: readonly string[]; skipped?: readonly string[] } | { ok: false; error: string }>;

export interface HermesDesktopApi {
  addConnection(request: PairingRequest): Promise<void>;
  removeConnection(connectionId: string): Promise<void>;
  /** Saves this device's name for a connection; an empty name restores the host name. */
  renameConnection(connectionId: string, name: string): Promise<void>;
  getAppIcon(): Promise<DesktopAppIconState>;
  setAppIcon(icon: DesktopAppIconId): Promise<DesktopAppIconState>;
  getMcp(): Promise<DesktopMcpState>;
  /** Validates and saves the whole configuration. */
  saveMcp(text: string): Promise<DesktopMcpResult>;
  setMcpApproval(name: string, approval: 'ask' | 'auto'): Promise<DesktopMcpResult>;
  /** Adds Claude Desktop's servers whose names are new. */
  importClaudeMcp(): Promise<DesktopMcpResult>;
  showMcpFile(): Promise<void>;
  getModelSettings(connectionKey: string): Promise<AgentModelSettings>;
  /** manage: the server has vault_manage (edit, import). */
  getVaultItems(connectionKey: string): Promise<Readonly<{ items: readonly VaultItem[]; manage: boolean }>>;
  addVaultItem(connectionKey: string, item: NewVaultItem): Promise<VaultItem>;
  removeVaultItem(connectionKey: string, id: string): Promise<boolean>;
  updateVaultItem(connectionKey: string, id: string, change: VaultItemChange): Promise<VaultItem>;
  /** Opens a file dialog in the main process; null when cancelled. */
  importVaultCsv(connectionKey: string): Promise<VaultImportResult | null>;
  /** API keys of the connection's profile .env (docs/env-keys.md). Values never come back. */
  getEnvKeys(connectionKey: string): Promise<EnvKeys>;
  setEnvKey(connectionKey: string, name: string, value: string): Promise<EnvKey>;
  removeEnvKey(connectionKey: string, name: string): Promise<boolean>;
  setModelSettings(connectionKey: string, provider: string, model: string, confirmSelection: boolean): Promise<AgentModelSettings | ModelSelectionConfirmation>;
  openBrowser(url?: string): Promise<void>;
  /** `sequence`: the Session's attachment IDs in message order; the preview then moves between them. */
  previewAttachment(attachmentId: string, sequence?: readonly string[]): Promise<void>;
  previewLocalFile(file: File): Promise<void>;
  /** True when the file has a disk path (Finder copy, drop, picker); false for pasted bytes. */
  isDiskFile?(file: File): boolean;
  browserAction(action: 'back' | 'forward' | 'reload' | 'stop' | 'close'): Promise<void>;
  /** Stop Hermes, let Hermes continue after a takeover, or tell Hermes the user finished. */
  browserControl(action: 'stop' | 'resume' | 'done'): Promise<void>;
  setBrowserBounds(bounds: { x: number; y: number; width: number; height: number; visible: boolean }): Promise<void>;
  /** Built-in sidebar or separate windows; moves open pages without reloading them. */
  setBrowserMode(mode: DesktopBrowserMode): Promise<void>;
  /** `automation` opens a New automation tab: its first message starts the automation's settings conversation. */
  newTab(channelId?: string, automation?: boolean): Promise<void>;
  activateTab(tabId: string): Promise<void>;
  closeTab(tabId: string): Promise<void>;
  /** Show the native Close Tab / Close Tabs to the Right / Close Other Tabs menu at window coordinates. */
  showTabMenu(tabId: string, x: number, y: number): Promise<void>;
  /** Main window only: shows a native menu at window coordinates; resolves with the chosen item's id, or null. */
  showContextMenu(items: readonly ContextMenuItem[], x: number, y: number): Promise<string | null>;
  /** Sidebar Session card: a native popup right of the sidebar, above the Session page. `null` hides it. */
  showSessionCard(card: SessionCardRequest | null): Promise<void>;
  /** Context size and total tokens of a Session (main window: any row; Session page: its own Session). `null` when unavailable. */
  threadUsage(threadId: string): Promise<DesktopThreadUsage | null>;
  completeNewTab(): Promise<void>;
  /** Main window or the Automations tab: scheduled jobs of every connection; `cursors` continues the list. */
  listAutomations(cursors?: Readonly<Record<string, string>>): Promise<DesktopAutomationList>;
  /** Main window: opens the single Automations list tab (every job, loaded page by page). */
  openAutomationList(): Promise<void>;
  /** Main window: opens the connection's Remote browser window, or brings it to the front. */
  openRemoteScreen(connectionKey: string): Promise<void>;
  /** Remote browser window: connects its own screen. The MessagePort arrives as a window message `{ type: 'hermes-remote-screen-port', id }`. */
  connectRemoteScreen(id: string): Promise<void>;
  /** Remote browser window, on Cmd+V: this computer's clipboard text. */
  remoteScreenClipboard(): Promise<string>;
  /** Automation tab: Pause, Resume, Run now or a new schedule for its own job. */
  controlAutomation(control: DesktopAutomationControl, schedule?: string): Promise<DesktopAutomation>;
  /** Automation tab: delete its own job and close its tabs. The job's conversations stay. */
  deleteAutomation(): Promise<void>;
  /** Automation tab: its job's settings conversation (created on first use); resolves with the Session ID to open. */
  openAutomationEditor(): Promise<string>;
  /** Main window: opens the job's tab, or activates it when open. `title` names the tab until the page loads. */
  openAutomation(automationId: string, title: string): Promise<void>;
  /** Automation tab: its own job and one page of its conversations; `before` continues the list. */
  getAutomation(before?: number): Promise<DesktopAutomationPage>;
  setContentBounds(bounds: { x: number; y: number; width: number; height: number; visible: boolean }): Promise<void>;
  getRuntimeInfo(): DesktopRuntimeInfo;
  /** Opens or focuses the single native Settings window; `connectionId` opens that connection's page. */
  openSettings(connectionId?: string): Promise<void>;
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
  /** A Session page copies its own link; the main window names the Session. */
  copySessionLink(threadId?: string): Promise<void>;
  /** A Session page asks the main window to open the search with this label. */
  searchLabel(label: string): Promise<void>;
  /** The main window receives label searches requested by Session pages. */
  onSearchLabel(listener: (label: string) => void): () => void;
  /** The main window receives Cmd+K (`all`) and Shift+Cmd+F (`files`) from every page, so the search covers the whole window.
   * `text` is the selected text when the page's right-click menu asks for the search. */
  onOpenSearch?(listener: (scope: 'all' | 'files', text?: string) => void): () => void;
  /** Searches the web for the selected text (Shift+Cmd+E), in the page's browser panel. */
  searchWeb?(text: string): Promise<void>;
  /** A tab page receives find-in-page requests: Cmd+F (`open`), Cmd+G (`next`), Shift+Cmd+G (`previous`),
   * Cmd+E (`selection`) and the right-click menu (`open` with the selected text). */
  onFind?(listener: (action: FindAction, text?: string) => void): () => void;
  /** A Session page asks the main window's sidebar to show this Project. */
  revealProject(channelId: string): Promise<void>;
  /** The main window receives Project reveal requests from Session pages. */
  onRevealProject?(listener: (channelId: string) => void): () => void;
  /** The main window receives the sidebar shortcut (Cmd+B) from every page. */
  onToggleSidebar?(listener: () => void): () => void;
  /** A Session page receives this when the app window becomes active. */
  onFocusComposer?(listener: () => void): () => void;
  /** The active Session page receives this for the todo shortcut (Shift+Cmd+L). */
  onToggleTodo?(listener: () => void): () => void;
  markResultRead(threadId: string, version: number, ref: number): Promise<void>;
  retryConnection(): Promise<void>;
  /** Closes the action error banner of the connection that owns threadId (or the current connection). */
  dismissError(threadId?: string): Promise<void>;
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
  /** Returns the session ID, or a confirmation request (nothing created) for a model with a cost/data warning. */
  createThread(input: ThreadInput): Promise<ThreadCreation>;
  /** New session with a text-only first message, shown at once; returns the session ID. */
  startThread(input: StartThreadInput): Promise<string>;
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
  answerVaultPrompt(promptId: string, answer: DesktopVaultAnswer): Promise<DesktopVaultAnswerResult>;
  pickAndUploadAttachments(threadId?: string): Promise<readonly DesktopAttachment[]>;
  uploadDroppedFiles(files: readonly File[], threadId?: string): Promise<readonly DesktopAttachment[]>;
  deleteUnattachedAttachment(attachmentId: string): Promise<void>;
  downloadAttachment(attachmentId: string, action: "save" | "open"): Promise<void>;
  /** Save/Open progress of attachments requested by this window. */
  onDownloadProgress?(listener: (progress: DownloadProgress) => void): () => void;
  previewAttachmentImage(attachmentId: string): Promise<string>;
  /** Session page: one page of its delivered or uploaded files. */
  listSessionFiles(list: 'delivered' | 'uploaded', after?: string): Promise<DesktopSessionFilePage>;
  /** Session page: loads one of its files so preview and download can use it. */
  prepareSessionFile(attachmentId: string): Promise<void>;
  /** Files by keyword and exact Session labels (AND), newest first, from every connection. */
  searchFiles(query: string, labels: readonly string[], cursors?: Readonly<Record<string, string>>): Promise<DesktopFileSearch>;
  /** Message text search (fast); with `refine`, the same search ordered by a model (seconds). */
  searchMessages(query: string, labels: readonly string[], refine?: boolean): Promise<DesktopMessageSearch>;
  /** Opens a search result with the system app, or saves it. */
  openSessionFile(threadId: string, attachmentId: string, action: 'open' | 'save'): Promise<void>;
  /** Opens a Session and shows one of its messages (a file search result), loading earlier messages when needed. */
  openMessage(threadId: string, refSeq: number): Promise<void>;
}

/**
 * Tokens of one Session: the latest request's context after compaction (null when unknown), the cumulative
 * total, and the prompt cache of the latest turn's first request (tokens read from the cache of all input; null without data).
 */
export type DesktopThreadUsage = Readonly<{ contextTokens: number | null; totalTokens: number; cache: Readonly<{ readTokens: number; promptTokens: number }> | null }>;

/** Sidebar Session card content and where its row is. Coordinates are main-window content (CSS) pixels. */
export type SessionCardRequest = Readonly<{
  title: string; project?: string; connection?: string; statuses: readonly string[]; labels: readonly string[]; lastMessage?: string; usage?: string;
  rowTop: number; rowBottom: number; sidebarRight: number; fontSize: number;
}>;

export interface DownloadProgress { attachmentId: string; received: number; total?: number }
