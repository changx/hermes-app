import type { ConnectionState, ReceiptProcessing, ReceiptState } from "@hermes-app/client";
import type { DesktopUpdate } from "./snapshot-delta";
import type { LabelDetail } from '../../../../packages/client/src/sessionLabels';

export type DesktopPhase = "restoring" | "unpaired" | "pairing" | "connected";

export type DesktopChannel = Readonly<{ id: string; name: string; description?: string }>;
export type DesktopThread = Readonly<{
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
export type ThreadInput = Readonly<{ title: string; clientThreadId: string; channelId?: string }>;
export type SendMessageInput = Readonly<{ text: string; attachmentIds: readonly string[]; clientMessageId?: string }>;
export type DesktopLocalDraft = Readonly<{ text: string; attachments: readonly DesktopAttachment[] }>;
export type DesktopRuntimeInfo = Readonly<{
  viewRole?: 'workspace' | 'tab';
  platform: NodeJS.Platform;
  versions: Readonly<{ chrome: string; electron: string }>;
}>;

export interface HermesDesktopApi {
  newTab(channelId?: string): Promise<void>;
  activateTab(tabId: string): Promise<void>;
  closeTab(tabId: string): Promise<void>;
  completeNewTab(): Promise<void>;
  setContentBounds(bounds: { x: number; y: number; width: number; height: number; visible: boolean }): Promise<void>;
  getRuntimeInfo(): DesktopRuntimeInfo;
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
  createChannel(input: ChannelInput): Promise<void>;
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
