import type { AgentModelSettings, ModelSelectionConfirmation, ConnectionState, ReceiptProcessing, ReceiptState } from "@hermes-app/client";
import type { DesktopUpdate } from "./snapshot-delta";
import type { LabelDetail } from '../../../../packages/client/src/sessionLabels';

export type DesktopPhase = "restoring" | "unpaired" | "pairing" | "connected";
export type DesktopBrowserState = Readonly<{ open: boolean; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; error?: string }>;

export type DesktopChannel = Readonly<{ id: string; name: string; description?: string; connectionName?: string; connectionKey?: string }>;
export type DesktopConnection = Readonly<{ id: string; name: string; server: string; state: ConnectionState | 'pairing'; detail?: string; connectionKey?: string }>;
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
export type ThreadInput = Readonly<{ title: string; clientThreadId: string; channelId?: string }>;
export type SendMessageInput = Readonly<{ text: string; attachmentIds: readonly string[]; clientMessageId?: string }>;
export type DesktopLocalDraft = Readonly<{ text: string; attachments: readonly DesktopAttachment[] }>;
export type DesktopRuntimeInfo = Readonly<{
  viewRole?: 'workspace' | 'tab' | 'settings';
  platform: NodeJS.Platform;
  versions: Readonly<{ chrome: string; electron: string }>;
}>;

export interface HermesDesktopApi {
  addConnection(request: PairingRequest): Promise<void>;
  removeConnection(connectionId: string): Promise<void>;
  getModelSettings(connectionKey: string): Promise<AgentModelSettings>;
  setModelSettings(connectionKey: string, provider: string, model: string, confirmSelection: boolean): Promise<AgentModelSettings | ModelSelectionConfirmation>;
  openBrowser(url?: string): Promise<void>;
  previewAttachment(attachmentId: string): Promise<void>;
  previewLocalFile(file: File): Promise<void>;
  browserAction(action: 'back' | 'forward' | 'reload' | 'stop' | 'close'): Promise<void>;
  setBrowserBounds(bounds: { x: number; y: number; width: number; height: number; visible: boolean }): Promise<void>;
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
  markResultRead(threadId: string, version: number, ref: number): Promise<void>;
  retryConnection(): Promise<void>;
  createChannel(input: ProjectCreationInput): Promise<void>;
  updateChannel(channelId: string, input: ChannelInput): Promise<void>;
  deleteChannel(channelId: string): Promise<void>;
  createThread(input: ThreadInput): Promise<string>;
  renameThread(threadId: string, title: string): Promise<void>;
  saveThreadLabels(threadId: string, markers: string[], timestamp: number, connectionKey: string): Promise<LabelDetail>;
  archiveThread(threadId: string): Promise<void>;
  loadOlder(): Promise<void>;
  getChannelInfo(channelId: string): Promise<DesktopChannel>;
  sendMessage(input: SendMessageInput): Promise<void>;
  retryMessage(clientMessageId: string): Promise<void>;
  stopThread(): Promise<void>;
  cancelQueued(receiptId: string): Promise<void>;
  answerInteraction(interactionId: string, choice: string): Promise<void>;
  pickAndUploadAttachments(threadId?: string): Promise<readonly DesktopAttachment[]>;
  uploadDroppedFiles(files: readonly File[], threadId?: string): Promise<readonly DesktopAttachment[]>;
  deleteUnattachedAttachment(attachmentId: string): Promise<void>;
  downloadAttachment(attachmentId: string, action: "save" | "open"): Promise<void>;
  previewAttachmentImage(attachmentId: string): Promise<string>;
}
