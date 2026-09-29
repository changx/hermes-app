import type { ConnectionState } from "@hermes-app/client";

export type DesktopPhase = "restoring" | "unpaired" | "pairing" | "connected";

export type DesktopChannel = Readonly<{
  id: string;
  name: string;
  description?: string;
}>;

export type DesktopThread = Readonly<{
  id: string;
  channelId: string;
  title: string;
  unreadCount: number;
  lastMessageAt?: number;
}>;

export type DesktopMessage = Readonly<{
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt?: number;
}>;

export type DesktopSnapshot = Readonly<{
  revision: number;
  phase: DesktopPhase;
  connectionState: ConnectionState;
  connectionLabel: string;
  statusMessage?: string;
  errorMessage?: string;
  channels: readonly DesktopChannel[];
  threads: readonly DesktopThread[];
  messages: readonly DesktopMessage[];
  selectedChannelId?: string;
  selectedThreadId?: string;
  selectedThreadTitle?: string;
}>;

export type PairingRequest = Readonly<{
  baseUrl: string;
  code: string;
  deviceName: string;
}>;

export type DesktopRuntimeInfo = Readonly<{
  platform: NodeJS.Platform;
  versions: Readonly<{ chrome: string; electron: string }>;
}>;

export interface HermesDesktopApi {
  getRuntimeInfo(): DesktopRuntimeInfo;
  getSnapshot(): Promise<DesktopSnapshot>;
  subscribe(listener: (snapshot: DesktopSnapshot) => void): () => void;
  pair(request: PairingRequest): Promise<void>;
  cancelPairing(): Promise<void>;
  forgetConnection(): Promise<void>;
  selectChannel(channelId: string): Promise<void>;
  selectThread(threadId: string): Promise<void>;
  retryConnection(): Promise<void>;
}
