import { randomBytes, randomUUID } from "node:crypto";
import { attachmentInputs, MAX_ATTACHMENT_BYTES, type AttachmentInput } from '../shared/attachment-input';
import { readFile, rename, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { app, dialog, shell } from "electron";
import { HttpError, ProtocolError, isRetryableError, type Attachment, type ConnectionState, type Thread } from "@hermes-app/client";
import { LiveSessionClient } from "@hermes-app/client/live";
import { LivePageClient } from "../../../../packages/client/src/livePages";
import { buildSessionLink, parseSessionLink, sessionServer } from "../../../../packages/client/src/sessionLinks";
import type { ChannelInput, DesktopAttachment, DesktopProjectWorkspace, DesktopSnapshot, PairingRequest, ProjectAgentsResult, ProjectFilesResult, ProjectFolderResult, SendMessageInput, ThreadInput } from "../shared/desktop-api";
import { workspacePath } from "../../../../packages/client/src/workspace";
import { CredentialStore, type StoredConnection, type StoredPairing } from "./credential-store";
import { OutboxStore, type OutboxRecord } from "./outbox-store";
import { LocalDraftStore } from './local-draft-store';

import { mainTransport, normalizeBaseUrl } from "./transport";

const stateLabel: Record<ConnectionState, string> = {
  connecting: "Connecting",
  syncing: "Syncing",
  online: "Online",
  retrying: "Reconnecting",
  suspended: "Offline",
  blocked: "Connection needs attention",
};

export const normalizeCode = (value: string): string => {
  const code = value.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z2-7]{16}$/.test(code)) throw new Error("Enter the complete one-time pairing code.");
  return code.match(/.{4}/g)!.join("-");
};

export const deviceName = (value: string): string => {
  const name = value.trim();
  if (!name || name.length > 64 || /[\x00-\x1f\x7f]/.test(name)) throw new Error("Enter a device name up to 64 characters.");
  return name;
};

const createConnection = (baseUrl: string): StoredConnection => {
  const random = randomBytes(44);
  const id = random.subarray(0, 12).toString("hex");
  const secret = random.subarray(12).toString("base64url");
  return { version: 1, baseUrl: normalizeBaseUrl(baseUrl), id, token: `ha_dev_${id}_${secret}` };
};

const wait = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(new Error("aborted")); return; }
  const finish = () => { signal.removeEventListener("abort", abort); resolve(); };
  const timer = setTimeout(finish, milliseconds);
  const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new Error("aborted")); };
  signal.addEventListener("abort", abort, { once: true });
});

const pairingRequest = async (baseUrl: string, path: string, init: RequestInit, signal: AbortSignal) => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, 12_000);
  signal.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(baseUrl + path, { ...init, redirect: "error", signal: controller.signal });
    const raw = await response.text();
    if (raw.length > 64 * 1024) throw new Error("temporary");
    let body: Record<string, unknown> | null = null;
    if (response.ok) {
      try { body = JSON.parse(raw) as Record<string, unknown>; }
      catch { throw new Error("invalid-response"); }
    }
    return { status: response.status, body };
  } catch (error) {
    if (signal.aborted) throw new Error("aborted");
    if (error instanceof Error && ["temporary", "invalid-response"].includes(error.message)) throw error;
    throw new Error("temporary");
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
};

export class DesktopConnectionService {
  private readonly store: CredentialStore;
  private readonly outboxStore: OutboxStore;
  private readonly localDraftStore: LocalDraftStore;
  private pairingGeneration = 0;
  private readonly cleanupLegacy: boolean;
  private forgettingId?: string;
  private client: LivePageClient | null = null;
  private connection: StoredConnection | null = null;
  private pairingController: AbortController | null = null;
  private pairingStarting = false;
  private listedThreads = new Map<string, Thread>();
  private revision = 0;
  private phase: DesktopSnapshot["phase"] = "restoring";
  private connectionState: ConnectionState = "suspended";
  private statusMessage: string | undefined;
  private errorMessage: string | undefined;
  private selectedChannelId: string | undefined;
  private selectedThreadId: string | undefined;
  private selectingInitialChannel = false;
  private outbox: OutboxRecord[] = [];
  private flushingOutbox = false;
  private readonly pageStates = new Map<string, { older?: string; start?: number; loading: boolean; historyLoading?: boolean }>();
  private readonly openPages: string[] = [];
  private get currentPageState() { return this.selectedThreadId ? this.pageStates.get(this.selectedThreadId) : undefined; }
  private get olderCursor(): string | undefined { return this.currentPageState?.older; }
  private set olderCursor(value: string | undefined) { if (this.currentPageState) this.currentPageState.older = value; }
  private get visibleStartRef(): number | undefined { return this.currentPageState?.start; }
  private set visibleStartRef(value: number | undefined) { if (this.currentPageState) this.currentPageState.start = value; }
  private get loadingMessages(): boolean { return this.currentPageState?.loading ?? false; }
  private set loadingMessages(value: boolean) { if (this.currentPageState) this.currentPageState.loading = value; }
  private readJobs = new Map<string, AbortController>();
  private outboxTimer: ReturnType<typeof setTimeout> | undefined;
  private delivering = new Set<string>();
  private connectionIssue: string | undefined;
  private closed = false;
  private sendRetryAfter = new Map<string, number>();
  private checkedReceipts = new Set<string>();
  private outboxStorageFault = false;

  private cancelRecovery(): void {
    for (const controller of this.readJobs.values()) controller.abort();
    this.readJobs.clear();
    clearTimeout(this.outboxTimer);
    this.outboxTimer = undefined;
  }

  // Retry only reads here. Mutations without an idempotency contract must not
  // be repeated automatically after an ambiguous response.
  private async recoverRead(key: string, operation: (signal: AbortSignal) => Promise<void>, valid: () => boolean, maxAttempts = Infinity): Promise<void> {
    this.readJobs.get(key)?.abort();
    const controller = new AbortController();
    this.readJobs.set(key, controller);
    let attempt = 0;
    try {
      while (!controller.signal.aborted && valid()) {
        try { await operation(controller.signal); return; }
        catch (error) {
          if (controller.signal.aborted || !valid()) return;
          if (!isRetryableError(error)) {
            this.stopIfUnauthorized(error);
            this.actionError(this.connectionError(error instanceof Error ? error : new Error(String(error))) ?? "This conversation could not be opened. Choose another conversation or try again.");
            return;
          }
          if (attempt + 1 >= maxAttempts) {
            this.actionError("Earlier messages could not be loaded. Your current messages are still here. Try loading earlier messages again.");
            return;
          }
          const delay = Math.min(10_000, 500 * 2 ** Math.min(attempt++, 5));
          const retryAfter = error instanceof HttpError ? error.retryAfterMs ?? 0 : 0;
          await wait(Math.max(delay, retryAfter), controller.signal);
        }
      }
    } catch { /* cancelled by navigation, forget, or close */ }
    finally { if (this.readJobs.get(key) === controller) this.readJobs.delete(key); }
  }

  private scheduleOutbox(): void {
    if (this.closed || this.outboxStorageFault || this.outboxTimer || this.connectionState !== "online" || !this.outbox.some((item) => !item.receiptId && item.state === "pending" || item.receiptRefSeq !== undefined)) return;
    this.outboxTimer = setTimeout(() => {
      this.outboxTimer = undefined;
      void this.flushOutbox();
    }, 5_000);
    this.outboxTimer.unref();
  }

  private stopIfUnauthorized(error: unknown): void {
    if (!(error instanceof HttpError) || (error.status !== 401 && error.status !== 403)) return;
    this.client?.close();
    this.connectionState = "blocked";
    this.cancelRecovery();
  }

  constructor(private readonly publish: (snapshot: DesktopSnapshot) => void, stores: { credentials?: CredentialStore; outbox?: OutboxStore; drafts?: LocalDraftStore; cleanupLegacy?: boolean } = {}) {
    this.store = stores.credentials ?? new CredentialStore();
    this.outboxStore = stores.outbox ?? new OutboxStore();
    this.localDraftStore = stores.drafts ?? new LocalDraftStore();
    this.cleanupLegacy = stores.cleanupLegacy ?? true;
  }

  serverAddress(): string | undefined { return this.connection?.baseUrl; }
  /** Endpoint for the App-side browser control connection, only while paired and connected. */
  browserEndpoint(): { baseUrl: string; token: string; connectionKey: string } | undefined {
    return this.phase === 'connected' && this.connection ? { baseUrl: this.connection.baseUrl, token: this.connection.token, connectionKey: this.connection.id } : undefined;
  }
  /** True when this server offers Project Files and AGENTS.md and this transport can write them safely. */
  supportsProjectFiles(): boolean { return this.client?.supportsChannelWorkspace === true; }
  supportsPrimaryPath(): boolean { return this.client?.supportsChannelPrimaryPath === true; }
  supportsChannelArchive(): boolean { return this.client?.supportsChannelArchive === true; }

  snapshot(pageId = this.selectedThreadId, includePages = true): DesktopSnapshot {
    const pageState = pageId ? this.pageStates.get(pageId) : undefined;
    const channels = [...(this.client?.channels.values() ?? [])]
      .map(({ id, name, description }) => ({ id, name, ...(description ? { description } : {}) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const projected = this.client?.threads ?? new Map();
    const combined = new Map<string, Thread | (typeof projected extends Map<string, infer V> ? V : never)>();
    for (const [id, thread] of this.listedThreads) combined.set(id, thread);
    for (const [id, thread] of projected) combined.set(id, thread);
    const receipts = [...(this.client?.receipts.values() ?? [])];
    const runningThreads = new Set(receipts.filter(receipt => receipt.processing != null ? receipt.processing === "running" : receipt.state === "queued" || receipt.state === "running").map(receipt => receipt.thread_id));
    const threads = [...combined.values()]
      .filter((thread) => !thread.archived)
      .map((thread) => ({
        id: thread.id,
        channelId: thread.project_id,
        title: thread.title,
        title_alphabet: thread.title_alphabet,
        markers: thread.markers ?? [],
        markersUpdatedAt: thread.markers_updated_at ?? 0,
        running: "running" in thread ? Boolean(thread.running) : runningThreads.has(thread.id),
        completedUnread: thread.completed_unread,
        resultVersion: thread.result_version,
        resultRef: thread.result_ref,
        ...(thread.origin === "automation" ? { origin: "automation" as const } : {}),
        ...(thread.participated === true ? { participated: true } : {}),
        ...("last_message_at" in thread && typeof thread.last_message_at === "number" ? { lastMessageAt: thread.last_message_at } : {}),
      }))
      .sort((a, b) => Number(b.running === true) - Number(a.running === true) || (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    const selected = pageId ? combined.get(pageId) : undefined;
    const receiptByClient = new Map(receipts.map((receipt) => [receipt.client_message_id, receipt]));
    const durable = pageId
      ? [...(this.client?.messages.get(pageId) ?? [])].filter(({ role,ref_seq }) => role !== "analysis" && role !== "reasoning" && (pageState?.start === undefined || ref_seq >= pageState.start))
      : [];
    const durableClientIds = new Set(durable.flatMap(({ client_message_id }) => client_message_id ? [client_message_id] : []));
    const messages: Array<DesktopSnapshot["messages"][number]> = durable.map(({ id, ref_seq, role, text, display_kind, notice_kind, created_at, client_message_id, receipt_id, tool_calls = [], attachments = [] }) => {
      const receipt = receipt_id ? this.client?.receipts.get(receipt_id) : client_message_id ? receiptByClient.get(client_message_id) : undefined;
      return {
        id: client_message_id ? `client:${client_message_id}` : `message:${id}`,
        role: role === "assistant" || role === "commentary" ? "assistant" as const : role === "user" ? "user" as const : "system" as const,
        text,
        ...(display_kind ? { displayKind: display_kind } : {}),
        ...(notice_kind ? { noticeKind: notice_kind } : {}),
        refSeq: ref_seq,
        ...(client_message_id ? { clientMessageId: client_message_id } : {}),
        ...(receipt ? { receiptId: receipt.id } : {}),
        ...(created_at ? { createdAt: created_at } : {}),
        ...(receipt ? { receiptState: receipt.state, processing: receipt.processing, ...(receipt.feedback ? { feedback: receipt.feedback } : {}) } : {}),
        toolCalls: tool_calls.map(({ id: toolId, name, label, detail, caption, icon }) => ({ id: toolId, name, label, ...(detail ? { detail } : {}), ...(caption ? { caption } : {}), ...(icon ? { icon } : {}) })),
        attachments: attachments.map((attachment) => this.projectAttachment(attachment)),
      };
    });
    if (pageId) {
      for (const pending of this.outbox) {
        if (pending.threadId !== pageId || durableClientIds.has(pending.id)) continue;
        const receipt = pending.receiptId ? this.client?.receipts.get(pending.receiptId) : receiptByClient.get(pending.id);
        messages.push({
          id: `client:${pending.id}`,
          role: "user" as const,
          text: pending.text,
          clientMessageId: pending.id,
          ...(receipt ? { receiptId: receipt.id } : {}),
          createdAt: pending.createdAt / 1000,
          receiptState: receipt?.state ?? (pending.state === "unknown" ? "unknown" : "queued"),
          processing: receipt?.processing,
          ...(receipt?.feedback ? { feedback: receipt.feedback } : {}),
          optimistic: true,
          toolCalls: [],
          attachments: pending.attachmentIds.map((id) => this.client?.attachments.get(id)).filter((item): item is Attachment => Boolean(item)).map((item) => this.projectAttachment(item)),
        });
      }
    }
    const interactions = [...(this.client?.interactions.values() ?? [])]
      .filter((item) => item.thread_id === pageId && item.state === "pending")
      .map(({ id, kind, prompt, choices }) => ({ id, kind, prompt, choices: [...choices] }));
    return Object.freeze({
      revision: this.revision,
      phase: this.phase,
      connectionState: this.connectionState,
      connectionLabel: stateLabel[this.connectionState],
      ...(this.connection ? { draftIdentity: this.connection.id } : {}),
      connectionKey: this.connection?.id,
      connectionName: this.connection?.baseUrl ? new URL(this.connection.baseUrl).hostname : undefined,
      supportsSessionLabels: this.client?.supportsSessionLabels === true,
      supportsThreadBranch: this.client?.supportsThreadBranch === true,
      supportsMessageSources: this.client?.supportsMessageSources === true,
      supportsThreadExport: this.client?.supportsThreadExport === true,
      // The SDK cursor is established only after the authoritative initial
      // snapshot has completed, including a legitimately empty account.
      loadingConversations: this.phase === "connected" && !this.client?.isCatalogueReady,
      loadingMessages: pageState?.loading ?? false,
      loadingHistory: pageState?.historyLoading ?? false,
      ...(this.statusMessage ? { statusMessage: this.statusMessage } : {}),
      ...(this.errorMessage || this.connectionIssue ? { errorMessage: this.errorMessage ?? this.connectionIssue } : {}),
      channels,
      threads,
      messages,
      interactions,
      canLoadOlder: Boolean(pageState?.older),
      ...(this.selectedChannelId ? { selectedChannelId: this.selectedChannelId } : {}),
      ...(pageId ? { selectedThreadId: pageId } : {}),
      ...(selected ? { selectedThreadTitle: selected.title } : {}),
      ...(includePages ? { sessionPages: this.openPages.map(id => {
        const page = this.snapshot(id, false);
        return { id, messages: page.messages, interactions: page.interactions,
          loadingMessages: page.loadingMessages, loadingHistory: page.loadingHistory, canLoadOlder: page.canLoadOlder,
          selectedThreadTitle: page.selectedThreadTitle };
      }) } : {}),
    });
  }

  private projectAttachment({ id, name = "Attachment", mime = "application/octet-stream", size = 0, state, public_url }: Attachment): DesktopAttachment {
    return { id, name, mime, size, state, ...(public_url ? { publicUrl: public_url } : {}) };
  }

  private changed(): void {
    this.revision += 1;
    this.publish(this.snapshot(undefined, false));
    if (this.pendingSessionLink && this.client?.isCatalogueReady) queueMicrotask(() => this.applySessionLink());
  }

  private pendingSessionLink: string | undefined;
  openSessionLink(value: string): void {
    this.pendingSessionLink = undefined;
    if (this.closed) return;
    if (!parseSessionLink(value)) { this.actionError("This conversation link is invalid."); return; }
    this.pendingSessionLink = value;
    if (!this.connection) this.actionError("Pair with this Hermes to open the conversation.");
    this.applySessionLink();
  }
  private applySessionLink(): void {
    const value = this.pendingSessionLink;
    if (this.closed) { this.pendingSessionLink = undefined; return; }
    if (!value || !this.connection) return;
    const target = parseSessionLink(value)!;
    if (sessionServer(this.connection.baseUrl) !== target.server) {
      this.pendingSessionLink = undefined;
      this.actionError("This conversation belongs to another Hermes. Open it on a device paired with that Hermes."); return;
    }
    if (!this.client?.isCatalogueReady) return;
    this.pendingSessionLink = undefined;
    if (!this.client.isThreadAvailable(target.threadId)) { this.actionError("This conversation is unavailable."); return; }
    this.errorMessage = undefined;
    if (this.selectedThreadId === target.threadId) { this.changed(); return; }
    void this.selectThread(target.threadId).catch(() => this.actionError("Could not open this conversation."));
  }
  sessionLink(threadId = this.selectedThreadId): string {
    if (!this.connection || !threadId) throw new Error("No conversation selected");
    return buildSessionLink(this.connection.baseUrl, threadId);
  }

  async initialize(): Promise<void> {
    const generation = this.pairingGeneration;
    try {
      // Retire only the former server-history projection directory. Credentials
      // and encrypted unsent originals are separate stores and remain intact.
      if (this.cleanupLegacy) {
        await rm(join(app.getPath("userData"), "conversation-cache"), { recursive: true, force: true }).catch(() => { throw new Error("legacy-history-cleanup"); });
        await rm(join(app.getPath("temp"), "Hermes"), { recursive: true, force: true }).catch(() => {});
      }
      const state = await this.store.load();
      if (this.closed || generation !== this.pairingGeneration) return;
      if (!state) { this.phase = "unpaired"; this.changed(); return; }
      if (state.connection) { await this.startClient(state.connection); return; }
      if (state.pairing) {
        this.phase = "pairing";
        this.statusMessage = "Resuming secure pairing…";
        this.changed();
        void this.completePairing(state.pairing);
      }
    } catch (error) {
      this.phase = "unpaired";
      this.errorMessage = error instanceof Error && error.message === "legacy-history-cleanup"
        ? "Old local history could not be removed. Free some disk space and reopen Hermes. Your saved connection and unsent messages are unchanged."
        : "The saved connection could not be opened. You can forget it and pair again.";
      this.changed();
    }
  }

  private async startClient(connection: StoredConnection): Promise<void> {
    this.closed = false;
    this.connectionIssue = undefined;
    this.cancelRecovery();
    this.client?.close();
    this.pageStates.clear(); this.openPages.length = 0;

    this.connection = connection;
    this.listedThreads.clear();
    this.selectedChannelId = undefined;
    this.selectedThreadId = undefined;
    this.olderCursor = undefined;
    this.errorMessage = undefined;
    this.statusMessage = undefined;
    this.phase = "connected";
    this.outbox = (await this.outboxStore.list(connection.id)).map((item) => item.state === "sending" ? { ...item, state: "pending" as const } : item);
    if (this.closed || this.connection !== connection) return;
    const transport = mainTransport(connection.baseUrl);
    this.outboxStorageFault = false; this.checkedReceipts.clear();
    let client: LivePageClient;
    client = new LivePageClient({
      ...transport,
      token: () => connection.token,
      onChange: () => {
        if (this.closed || this.client !== client) return;
        this.listedThreads = new Map([...client.threads].map(([id,thread]) => [id,{...thread}]));
        if (client.isCatalogueReady) for (const id of [...this.openPages]) {
          if (!client.isThreadAvailable(id)) this.releaseSessionPage(id);
        }
        if (client.isCatalogueReady && this.selectedThreadId && !client.isThreadAvailable(this.selectedThreadId)) {
          this.readJobs.get("history")?.abort(); this.readJobs.get("older")?.abort();
          this.selectedThreadId = undefined; this.olderCursor = undefined; this.loadingMessages = false;
        }
        if (client.isCatalogueReady && this.selectedChannelId && !client.channels.has(this.selectedChannelId)) this.selectedChannelId = undefined;
        this.changed(); void this.selectInitialChannel();
      },
      onConnectionState: (state) => {
        if (this.closed || this.client !== client) return;
        this.connectionState = state;
        if (state === "online") { this.connectionIssue = undefined; this.checkedReceipts.clear(); void this.flushOutbox(); }
        this.changed();
      },
      onError: (error) => { if (this.closed || this.client !== client) return; this.connectionIssue = this.connectionError(error); this.changed(); },
    });
    this.client = client;

    this.changed();
    await client.connect();
  }

  private connectionError(error: Error): string | undefined {

    if (isRetryableError(error)) return undefined;
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) return "This device is no longer authorized. Pair it again.";
    return "Hermes could not open this connection. Contact your administrator.";
  }

  private async selectInitialChannel(): Promise<void> {
    if (this.selectingInitialChannel || this.selectedChannelId || !this.client?.channels.size) return;
    this.selectingInitialChannel = true;
    try {
      const first = [...this.client.channels.values()].sort((a, b) => a.name.localeCompare(b.name))[0];
      await this.selectChannel(first.id);
    } finally {
      this.selectingInitialChannel = false;
    }
  }

  async pair(request: PairingRequest): Promise<void> {
    if (this.pairingController || this.pairingStarting) return;
    this.pairingStarting = true;
    const generation = ++this.pairingGeneration;
    this.closed = false;
    try {
      const pairing: StoredPairing = {
        version: 1,
        connection: createConnection(request.baseUrl),
        code: normalizeCode(request.code),
        deviceName: deviceName(request.deviceName),
      };
      this.phase = 'pairing'; this.errorMessage = undefined; this.statusMessage = 'Saving secure pairing…'; this.changed();
      await this.store.savePairing(pairing);
      if (generation !== this.pairingGeneration || this.closed) return;
      await this.completePairing(pairing);
    } catch (error) {
      if (generation !== this.pairingGeneration || this.closed) return;
      this.phase = "unpaired";
      const message = error instanceof Error ? error.message : "";
      this.errorMessage = message.startsWith("Enter ") ? message : "This device could not save the connection securely. Check that macOS Keychain is available.";
      this.changed();
    } finally {
      this.pairingStarting = false;
    }
  }

  private async completePairing(pairing: StoredPairing): Promise<void> {
    if (this.pairingController) return;
    const controller = new AbortController();
    this.pairingController = controller;
    this.phase = "pairing";
    this.errorMessage = undefined;
    this.statusMessage = "Connecting securely…";
    this.changed();
    let exchanged = false;
    let attempt = 0;
    try {
      while (!controller.signal.aborted) {
        try {
          const check = await pairingRequest(pairing.connection.baseUrl, "/v1/capabilities", {
            headers: { Authorization: `Bearer ${pairing.connection.token}` },
          }, controller.signal);
          if (controller.signal.aborted || this.closed) return;
          if (check.status === 200) {
            const body = check.body;
            if (body?.protocol !== 1) throw new Error("unsupported");
            await this.store.saveConnection(pairing.connection);
            if (controller.signal.aborted || this.closed) return;
            await this.startClient(pairing.connection);
            return;
          }
          if (check.status !== 401) throw new Error(check.status === 403 ? "rejected" : "temporary");
          if (exchanged) throw new Error("rejected");
          const exchange = await pairingRequest(pairing.connection.baseUrl, "/v1/pairing/exchange", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: pairing.code, device_name: pairing.deviceName, device_token: pairing.connection.token }),
          }, controller.signal);
          if (exchange.status === 400) throw new Error("expired");
          if (exchange.status === 404) throw new Error("unavailable");
          if (exchange.status !== 201) throw new Error(exchange.status >= 500 || exchange.status === 429 ? "temporary" : "rejected");
          if (exchange.body?.device_id !== pairing.connection.id) throw new Error("rejected");
          exchanged = true;
          continue;
        } catch (error) {
          if (controller.signal.aborted) throw error;
          const reason = error instanceof Error ? error.message : "temporary";
          if (["expired", "unavailable", "rejected", "unsupported", "invalid-response"].includes(reason)) throw error;
          this.statusMessage = "Waiting for a connection. Pairing will continue automatically…";
          this.changed();
          await wait(Math.min(10_000, 500 * 2 ** Math.min(attempt++, 5)), controller.signal);
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const reason = error instanceof Error ? error.message : "rejected";
        this.phase = "unpaired";
        this.statusMessage = undefined;
        this.errorMessage = reason === "expired" ? "This pairing code is invalid or expired. Ask your administrator for a new one."
          : reason === "unavailable" ? "Device pairing is not available on this server yet."
            : reason === "unsupported" ? "This server version does not support the desktop app yet."
              : "This device was not authorized. Check the pairing code or contact your administrator.";
        await this.store.delete().catch(() => {});
        this.changed();
      }
    } finally {
      if (this.pairingController === controller) this.pairingController = null;
    }
  }

  async cancelPairing(): Promise<void> {
    this.pairingGeneration++;
    this.pairingController?.abort();
    this.pairingController = null;
    await this.store.delete();
    this.phase = "unpaired";
    this.statusMessage = undefined;
    this.errorMessage = undefined;
    this.changed();
  }

  async forgetConnection(): Promise<void> {
    this.pairingGeneration++;
    this.closed = true;
    this.cancelRecovery();
    this.connectionIssue = undefined;
    this.pairingController?.abort();
    this.pairingController = null;
    this.client?.close();
    this.client = null;
    this.pageStates.clear(); this.openPages.length = 0;
    this.pendingSessionLink = undefined;
    const connectionId = this.connection?.id ?? this.forgettingId;
    this.forgettingId = connectionId;
    this.connection = null;
    this.outbox = [];
    this.listedThreads.clear();
    this.selectedChannelId = undefined;
    this.selectedThreadId = undefined;
    this.olderCursor = undefined;
    try {
      await this.store.delete();
      if (connectionId) await this.outboxStore.clear(connectionId);
      if (connectionId) await this.localDraftStore.clear(connectionId);
      this.forgettingId = undefined;
    } catch {
      this.phase = 'unpaired'; this.connectionState = 'blocked'; this.statusMessage = undefined;
      this.errorMessage = 'Local connection removal could not be completed. Try removing it again. Server conversations are unchanged.';
      this.changed(); throw new Error('Local connection removal could not be completed.');
    }
    this.phase = "unpaired";
    this.connectionState = "suspended";
    this.statusMessage = undefined;
    this.errorMessage = undefined;
    this.changed();
  }

  async selectChannel(channelId: string): Promise<void> {
    if (!this.client?.channels.has(channelId)) return;
    this.selectedChannelId = channelId;
    this.changed();
  }

  deactivateThread(): void { this.selectedThreadId = undefined; this.changed(); }

  async markResultRead(threadId: string, version: number, ref: number): Promise<void> {
    if (threadId !== this.selectedThreadId || !Number.isSafeInteger(version) || version <= 0 || !Number.isSafeInteger(ref) || ref <= 0) return;
    await this.client?.markResultRead(threadId, version, ref);
  }

  async selectThread(threadId: string, activate = true): Promise<void> {
    const client = this.client;
    const thread = client?.threads.get(threadId) ?? this.listedThreads.get(threadId);
    if (!client || !thread || thread.archived || !client.channels.has(thread.project_id)) return;
    const existing = this.openPages.indexOf(threadId);
    if (existing >= 0) {
      if (activate) { this.selectedChannelId = thread.project_id; this.selectedThreadId = threadId; }
      this.changed(); return;
    }
    this.readJobs.get("history")?.abort(); this.readJobs.get("older")?.abort();
    this.pageStates.set(threadId, { loading: true }); this.openPages.push(threadId);
    if (activate) { this.selectedChannelId = thread.project_id; this.selectedThreadId = threadId; }
    this.changed();
    const page = client.acquirePage(threadId);
    const valid = () => !this.closed && this.client === client && client.page(threadId) === page && this.pageStates.has(threadId);
    await this.recoverRead("history:" + threadId, async signal => {
      const releaseContent = () => {
      if (!signal.aborted && valid()) {
        const state = this.pageStates.get(threadId)!;
        if (!state.loading) return;
        state.older = page.currentOlderCursor ?? undefined;
        state.start = page.messages.get(threadId)?.[0]?.ref_seq;
        state.loading = false; this.changed();
      }
      };
      await page.openConversation(threadId, undefined, undefined, releaseContent);
      releaseContent();
    }, valid);
  }

  private requireClient(): LivePageClient {
    if (!this.client || !this.connection) throw new Error("Hermes is not connected.");
    return this.client;
  }

  private releaseSessionPage(id: string): void {
    this.readJobs.get('history:' + id)?.abort();
    this.readJobs.get('older:' + id)?.abort();
    this.pageStates.delete(id);
    const index = this.openPages.indexOf(id); if (index >= 0) this.openPages.splice(index, 1);
    this.client?.releasePage(id);
  }

  closeSessionPage(id: string): void {
    if (!this.pageStates.has(id)) return;
    const index = this.openPages.indexOf(id);
    this.releaseSessionPage(id);
    if (this.selectedThreadId === id) {
      this.selectedThreadId = this.openPages[Math.min(index, this.openPages.length - 1)];
      const thread = this.selectedThreadId ? this.client?.threads.get(this.selectedThreadId) : undefined;
      if (thread) this.selectedChannelId = thread.project_id;
    }
    this.changed();
  }

  // Window destruction, not minimize/blur. The account/outbox and device-local
  // drafts stay alive; no destroyed renderer owns transcript/watch resources.
  closeSessionPages(): void {
    this.pendingSessionLink = undefined;
    for (const id of [...this.openPages]) this.releaseSessionPage(id);
    this.selectedThreadId = undefined;
    this.olderCursor = undefined; this.visibleStartRef = undefined; this.loadingMessages = false;
    this.changed();
  }

  private actionError(message: string): void {
    this.errorMessage = message;
    this.changed();
  }

  async createChannel(input: ChannelInput): Promise<string> {
    const name = input.name.trim(), description = input.description.trim();
    if (!name || name.length > 120 || description.length > 4000) throw new Error("Enter a channel name and a shorter description.");
    const client = this.requireClient(), connection = this.connection;
    let channel: Awaited<ReturnType<LiveSessionClient["createChannel"]>>;
    try {
      channel = await client.createChannel(name, description);
      if (this.closed || this.client !== client || this.connection !== connection) throw new Error('Connection changed');
      const confirmed = await client.getChannelInfo(channel.id);
      if (this.closed || this.client !== client || this.connection !== connection || confirmed.id !== channel.id || confirmed.name !== name || (confirmed.description ?? '') !== description) throw new Error('Project readback mismatch');
    }
    catch { this.actionError("Project creation could not be confirmed. Check this connection’s project list before trying again."); throw new Error("Project creation was not confirmed."); }
    await this.selectChannel(channel.id).catch(() => this.actionError("The channel was created, but its topics could not be loaded yet."));
    return channel.id;
  }

  // Project Files and AGENTS.md. Route-owned reads; nothing enters the chat caches.
  private workspaceClient(channelId: string): LivePageClient | null {
    const client = this.requireClient();
    if (!client.channels.has(channelId)) throw new Error("This project is unavailable.");
    return client.supportsChannelWorkspace ? client : null;
  }

  private async readAgents(client: LivePageClient, channelId: string) {
    try { const value = await client.workspace.getAgents(channelId); return { content: value.content, etag: value.etag }; }
    catch (error) { if (error instanceof HttpError && error.status === 404) return null; throw error; }
  }

  async getProjectWorkspace(channelId: string): Promise<DesktopProjectWorkspace> {
    const client = this.workspaceClient(channelId);
    if (!client) return { supported: false, agents: null, files: [], moreFiles: false };
    try {
      const state = await client.workspace.getState(channelId);
      const agents = (state.agentsAvailable ?? state.initialized) ? await this.readAgents(client, channelId) : null;
      const page = state.initialized ? await client.workspace.list(channelId, '') : null;
      if (this.client !== client) throw new Error('Connection changed');
      // AGENTS.md has its own editor; do not show it twice.
      const files = (page?.items ?? []).filter(item => item.path !== 'AGENTS.md').map(item => ({ name: item.name, kind: item.kind, size: item.size }));
      return { supported: true, agents, files, moreFiles: page?.nextAfter != null };
    } catch (error) { this.stopIfUnauthorized(error); throw new Error("Project files could not be loaded."); }
  }

  /** Initialize once, only when a write needs it. Initialization is idempotent on the server. */
  private async ensureWorkspace(client: LivePageClient, channelId: string, need: 'agents' | 'files'): Promise<void> {
    const state = await client.workspace.getState(channelId);
    const ready = need === 'files' ? state.initialized : (state.agentsAvailable ?? state.initialized);
    if (!ready) await client.workspace.initialize(channelId);
  }

  async saveProjectAgents(channelId: string, content: string, previous: string | null): Promise<ProjectAgentsResult> {
    const client = this.workspaceClient(channelId);
    if (!client) return { ok: false, reason: 'failed' };
    try {
      await this.ensureWorkspace(client, channelId, 'agents');
      const saved = await client.workspace.saveAgents(channelId, content, previous);
      return { ok: true, etag: saved.etag };
    } catch (error) {
      this.stopIfUnauthorized(error);
      return { ok: false, reason: error instanceof HttpError && error.status === 412 ? 'conflict' : 'failed' };
    }
  }

  /** Bind or remove the primary folder. Readback confirms the server state. */
  async setProjectFolder(channelId: string, path: string | null): Promise<ProjectFolderResult> {
    const client = this.requireClient();
    if (!client.channels.has(channelId) || !client.supportsChannelPrimaryPath) return { ok: false, reason: 'failed' };
    try {
      await client.updateChannel(channelId, { primary_path: path });
      const saved = await client.getChannelInfo(channelId);
      if (this.client !== client || (saved.bound_primary_path ?? null) !== path) throw new Error('Folder readback mismatch');
      return { ok: true };
    } catch (error) {
      this.stopIfUnauthorized(error);
      const status = error instanceof HttpError ? error.status : 0;
      return { ok: false, reason: status === 400 ? 'invalid' : status === 409 ? 'taken' : 'failed' };
    }
  }

  async addProjectFiles(channelId: string, inputs: readonly AttachmentInput[]): Promise<ProjectFilesResult> {
    const client = this.workspaceClient(channelId);
    const uploaded: string[] = [];
    const named = attachmentInputs(inputs).map(input => typeof input === 'string' ? { name: basename(input), input } : { name: input.name, input });
    if (!client) return { uploaded, failed: { name: named[0]?.name ?? '', reason: 'failed' } };
    for (const { name } of named) {
      try { workspacePath(name); } catch { return { uploaded, failed: { name, reason: 'invalid' } }; }
      if (name === 'AGENTS.md') return { uploaded, failed: { name, reason: 'invalid' } };
    }
    try { if (named.length) await this.ensureWorkspace(client, channelId, 'files'); }
    catch (error) { this.stopIfUnauthorized(error); return { uploaded, failed: { name: named[0].name, reason: 'failed' } }; }
    for (const { name, input } of named) {
      try {
        let bytes: Uint8Array;
        if (typeof input === 'string') {
          if (!isAbsolute(input)) throw new Error('Invalid path');
          const info = await stat(input);
          if (!info.isFile() || info.size < 1 || info.size > MAX_ATTACHMENT_BYTES) return { uploaded, failed: { name, reason: 'invalid' } };
          bytes = new Uint8Array(await readFile(input));
        } else bytes = input.bytes;
        if (bytes.byteLength < 1 || bytes.byteLength > MAX_ATTACHMENT_BYTES) return { uploaded, failed: { name, reason: 'invalid' } };
        if (this.client !== client) throw new Error('Connection changed');
        // Create-only: an existing server file is never replaced.
        await client.workspace.writeFile(channelId, name, bytes, null);
        uploaded.push(name);
      } catch (error) {
        this.stopIfUnauthorized(error);
        return { uploaded, failed: { name, reason: error instanceof HttpError && error.status === 412 ? 'exists' : 'failed' } };
      }
    }
    return { uploaded };
  }

  private modelClient(connectionKey: string): LivePageClient {
    const client = this.requireClient();
    if (connectionKey !== this.connection?.id) throw new Error('Connection changed. Reopen Settings.');
    return client;
  }

  async getModelSettings(connectionKey: string) {
    const client = this.modelClient(connectionKey);
    try {
      const settings = await client.getModelSettings();
      if (this.modelClient(connectionKey) !== client) throw new Error('Connection changed');
      return settings;
    } catch { throw new Error('Could not load model settings. Try again.'); }
  }

  async setModelSettings(connectionKey: string, provider: string, model: string, confirmSelection: boolean) {
    const client = this.modelClient(connectionKey);
    if (!provider.trim() || !model.trim() || provider.length > 256 || model.length > 256 || /[\x00-\x1f\x7f]/.test(provider + model)) throw new Error('Enter a provider and model name.');
    try {
      const result = await client.setModelSettings(provider, model, undefined, confirmSelection);
      if (this.modelClient(connectionKey) !== client) throw new Error('Connection changed');
      if ('confirmation_required' in result) return result;
      const settings = await client.getModelSettings();
      if (this.modelClient(connectionKey) !== client) throw new Error('Connection changed');
      if (settings.provider !== result.provider || settings.model !== result.model) throw new Error('Model changed during save');
      return settings;
    } catch { throw new Error('Could not confirm the change. Reload settings before trying again.'); }
  }

  async getChannelInfo(channelId: string): Promise<DesktopSnapshot["channels"][number]> {
    const client = this.requireClient(), channel = await client.getChannelInfo(channelId);
    return { id: channel.id, name: channel.name, ...(channel.description ? { description: channel.description } : {}),
      ...(typeof channel.bound_primary_path === 'string' ? { primaryPath: channel.bound_primary_path } : {}),
      ...(client.supportsChannelPrimaryPath ? { primaryPathSupported: true } : {}),
      ...(client.supportsChannelArchive ? { archiveSupported: true } : {}) };
  }

  async updateChannel(channelId: string, input: ChannelInput): Promise<void> {
    if (!this.client?.channels.has(channelId)) return;
    const name = input.name.trim(), description = input.description.trim();
    if (!name || name.length > 120 || description.length > 4000) throw new Error("Enter a channel name and a shorter description.");
    try { await this.client.updateChannel(channelId, { name, description }); }
    catch { this.actionError("The channel could not be updated. It may have changed on another device."); throw new Error("Channel update was not confirmed."); }
  }

  async deleteChannel(channelId: string): Promise<void> {
    if (!this.client?.channels.has(channelId)) return;
    try {
      await this.client.deleteChannel(channelId);
      await this.leaveChannel(channelId);
    } catch { this.actionError("The channel could not be deleted. Check that it is empty and that you have permission."); }
  }

  /** Core project archive: the project and its sessions leave the list; nothing is deleted. */
  async archiveChannel(channelId: string): Promise<void> {
    if (!this.client?.channels.has(channelId)) return;
    try {
      await this.client.archiveChannel(channelId);
      await this.leaveChannel(channelId);
    } catch { this.actionError("The project could not be archived. Check the connection and try again."); throw new Error("Project archive was not confirmed."); }
  }

  private async leaveChannel(channelId: string): Promise<void> {
    if (this.selectedChannelId === channelId) {
      this.selectedChannelId = undefined;
      this.selectedThreadId = undefined;
      this.listedThreads.clear();
      this.olderCursor = undefined;
      await this.selectInitialChannel();
    }
    this.changed();
  }

  async createThread(input: ThreadInput, activate = true): Promise<string> {
    const client = this.requireClient(), channelId = input.channelId ?? this.selectedChannelId;
    const title = input.title.trim();
    if (!channelId || !client.channels.has(channelId) || !title || title.length > 200 || !/^th_[A-Za-z0-9_-]{8,64}$/.test(input.clientThreadId)) throw new Error("Choose a channel and enter a topic title.");
    try {
      const thread = await client.createThread(channelId, title, input.clientThreadId);
      if (this.client !== client) throw new Error('Connection changed during creation');
      this.listedThreads.set(thread.id, thread);
      await this.selectThread(thread.id, activate);
      return thread.id;
    } catch { this.actionError("The topic could not be created. Check your permission and try again."); throw new Error("Topic creation was not confirmed."); }
  }

  async renameThread(threadId: string, titleValue: string): Promise<void> {
    const title = titleValue.trim();
    if (!title || title.length > 200 || !this.listedThreads.has(threadId)) throw new Error("Enter a topic title.");
    try { const thread = await this.requireClient().updateThread(threadId, { title }); this.listedThreads.set(thread.id, thread); this.changed(); }
    catch { this.actionError("The topic could not be renamed. It may have changed on another device."); throw new Error("Topic rename was not confirmed."); }
  }

  async saveThreadLabels(threadId: string, markers: string[], timestamp: number, connectionKey: string) {
    const client = this.requireClient(), connection = this.connection;
    if (!connection || connection.id !== connectionKey) throw new Error('This connection changed. Reopen the label editor.');
    const result = await client.saveThreadLabels(threadId, markers, timestamp);
    if (this.client !== client || this.connection !== connection || this.closed) throw new Error('Label save was not confirmed.');
    this.changed();
    return result;
  }

  async archiveThread(threadId: string): Promise<void> {
    if (!this.listedThreads.has(threadId)) return;
    try {
      await this.requireClient().archiveThread(threadId);
      this.listedThreads.delete(threadId);
      this.releaseSessionPage(threadId);
      if (this.selectedThreadId === threadId) {
        this.selectedThreadId = undefined;
        this.olderCursor = undefined;
        const fallback = this.snapshot().threads.find((thread) => thread.channelId === this.selectedChannelId);
        if (fallback) await this.selectThread(fallback.id);
      }
      this.changed();
    } catch { this.actionError("The topic could not be archived. Try again after Hermes reconnects."); }
  }

  async loadOlder(targetThreadId = this.selectedThreadId): Promise<void> {
    const client = this.requireClient(), threadId = targetThreadId, before = threadId ? this.pageStates.get(threadId)?.older : undefined;
    if (!threadId || !before || !client.supportsLatest) return;
    const state = this.pageStates.get(threadId), owner = client.page(threadId);
    if (!state || !owner || state.historyLoading || this.readJobs.has("older:" + threadId)) return;
    const valid = () => this.client === client && this.pageStates.get(threadId) === state && client.page(threadId) === owner && state.older === before;
    state.historyLoading = true; this.errorMessage = undefined; this.changed();
    try {
      await this.recoverRead("older:" + threadId, async (signal) => {
        await owner.loadFullHistory(threadId, signal);
        if (!signal.aborted && valid()) {
          state.start = owner.messages.get(threadId)?.[0]?.ref_seq;
          state.older = undefined; this.changed();
        }
      }, valid, 3);
    } finally {
      if (this.pageStates.get(threadId) === state) { state.historyLoading = false; this.changed(); }
    }
  }

  async flushLocalDrafts(): Promise<void> { await this.localDraftStore.flush(); }

  async loadLocalDrafts(identity: string) {
    if (!this.connection || this.connection.id !== identity) throw new Error('Connection changed');
    return this.localDraftStore.list(identity);
  }

  async saveLocalDraft(identity: string, threadId: string, draft: unknown): Promise<void> {
    if (this.closed || !this.connection || this.connection.id !== identity) throw new Error('Connection changed');
    return this.localDraftStore.put(identity, threadId, draft);
  }

  async sendMessage(input: SendMessageInput, targetThreadId = this.selectedThreadId): Promise<void> {
    const client = this.requireClient(), connection = this.connection!, threadId = targetThreadId;
    const text = input.text.replace(/\r\n/g, "\n");
    const attachmentIds = [...input.attachmentIds];
    if (this.outboxStorageFault) throw new Error("Saved messages could not be updated. Keep your app data and reopen Hermes.");
    if (!threadId || !client.isThreadAvailable(threadId) || text.length > 100_000 || (!text.trim() && !attachmentIds.length) || attachmentIds.length > 8 || new Set(attachmentIds).size !== attachmentIds.length) throw new Error("Write a message or add an attachment before sending.");
    const id = input.clientMessageId ?? `desktop:${randomUUID()}`;
    if (!/^desktop:[A-Za-z0-9-]{8,80}$/.test(id)) throw new Error('Invalid message identity');
    const existing = this.outbox.find(item => item.id === id);
    if (existing) {
      if (existing.threadId !== threadId || existing.text !== text || JSON.stringify(existing.attachmentIds) !== JSON.stringify(attachmentIds)) throw new Error('Message identity changed');
      return;
    }
    // A durable ACK can already have retired the outbox. The page still owns its accepted echo.
    const acknowledged = client.messages.get(threadId)?.find(message => message.client_message_id === id);
    if (acknowledged) {
      if (acknowledged.text !== text || JSON.stringify((acknowledged.attachments ?? []).map(attachment => attachment.id)) !== JSON.stringify(attachmentIds)) throw new Error('Message identity changed');
      return;
    }
    for (const attachmentId of attachmentIds) {
      const attachment: Attachment = client.attachments.get(attachmentId) ?? await client.getAttachment(threadId, attachmentId);
      if (this.client !== client || this.connection !== connection || !client.isThreadAvailable(threadId) || attachment.thread_id !== threadId || attachment.state !== "available" || attachment.receipt_id) throw new Error("An attachment is no longer available. Your draft is still here.");
    }
    const pending: OutboxRecord = { version: 1, id, threadId, text, attachmentIds, createdAt: Date.now(), state: "pending" };
    await this.outboxStore.put(connection.id, pending);
    if (this.client !== client || this.connection !== connection) throw new Error('The message was saved for the previous connection');
    // The outbox already owns this message. A failed cleanup must not make the user send it twice.
    await this.localDraftStore.put(connection.id, threadId, { text: '', attachments: [] }).catch(() => {
      this.errorMessage = 'Your message was saved, but its local draft could not be cleared. Keep your app data and reopen Hermes.';
    });
    if (this.client !== client || this.connection !== connection) throw new Error('The message was saved for the previous connection');
    this.outbox.push(pending);
    this.changed();
    await this.deliver(pending);
  }

  async retryMessage(clientMessageId: string, threadId = this.selectedThreadId): Promise<void> {
    const pending = this.outbox.find(item => item.id === clientMessageId && item.threadId === threadId);
    if (pending) { this.checkedReceipts.delete(pending.id); await this.deliver(pending.state === "blocked" && !pending.receiptId ? { ...pending, state: "pending" } : pending); }
  }

  // One request ID per tapped reply until the server answers definitely, so a lost
  // reply never creates a second branch.
  private branchRequests = new Map<string, string>();
  /** Full session link of the new Thread, or the reason the branch did not start. */
  async branchFromMessage(refSeq: number, threadId = this.selectedThreadId): Promise<{ ok: true; link: string } | { ok: false; reason: 'busy' | 'unavailable' | 'failed' }> {
    const client = this.requireClient(), connection = this.connection;
    if (!threadId || !connection || !Number.isSafeInteger(refSeq) || refSeq <= 0) return { ok: false, reason: 'unavailable' };
    const key = `${threadId}:${refSeq}`;
    const requestId = this.branchRequests.get(key) ?? `br_${randomUUID()}`;
    this.branchRequests.set(key, requestId);
    try {
      const created = await client.branchThread(threadId, refSeq, requestId);
      this.branchRequests.delete(key);
      return { ok: true, link: buildSessionLink(connection.baseUrl, created.id) };
    } catch (error) {
      const code = error instanceof HttpError ? error.code : undefined;
      if (code) this.branchRequests.delete(key);
      return { ok: false, reason: code === 'busy' || code === 'branch_in_progress' ? 'busy' : code === 'anchor_unavailable' || code === 'anchor_not_final' ? 'unavailable' : 'failed' };
    }
  }

  async messageSources(refSeq: number, threadId = this.selectedThreadId): Promise<readonly { url: string; kind: 'read' | 'cited' }[]> {
    const client = this.requireClient();
    if (!threadId || !client.supportsMessageSources) return [];
    return client.messageSources(threadId, refSeq);
  }

  private async saveText(title: string, name: string, text: string): Promise<{ ok: true; saved: boolean }> {
    const safeName = name.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, "_").trim().slice(0, 120) || "Conversation";
    const selected = await dialog.showSaveDialog({ title, defaultPath: `${safeName}.md`, filters: [{ name: "Markdown", extensions: ["md"] }] });
    if (selected.canceled || !selected.filePath) return { ok: true, saved: false };
    const temporary = `${selected.filePath}.partial`;
    await writeFile(temporary, text, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, selected.filePath);
    return { ok: true, saved: true };
  }

  async exportMessage(text: string, threadId = this.selectedThreadId): Promise<{ ok: true; saved: boolean } | { ok: false }> {
    if (!threadId) return { ok: false };
    const title = this.client?.threads.get(threadId)?.title ?? "Message";
    return this.saveText("Export Hermes message", `${title} - message`, text.endsWith("\n") ? text : `${text}\n`);
  }

  async exportConversation(threadId = this.selectedThreadId): Promise<{ ok: true; saved: boolean } | { ok: false }> {
    const client = this.requireClient();
    if (!threadId || !client.supportsThreadExport) return { ok: false };
    try {
      const text = await client.exportThread(threadId);
      return await this.saveText("Export Hermes conversation", client.threads.get(threadId)?.title ?? "Conversation", text);
    } catch { return { ok: false }; }
  }

  /** Native /retry through the normal durable send path. */
  async retryLatest(threadId = this.selectedThreadId): Promise<void> {
    await this.sendMessage({ text: "/retry", attachmentIds: [] }, threadId);
  }

  private async persistOutbox(record: OutboxRecord): Promise<void> {
    const connection = this.connection;
    if (!connection) return;
    await this.outboxStore.put(connection.id, record);
    const index = this.outbox.findIndex(({ id }) => id === record.id);
    if (index < 0) this.outbox.push(record); else this.outbox[index] = record;
    this.changed();
  }

  private async deliver(value: OutboxRecord): Promise<void> {
    const client = this.client, connection = this.connection;
    if (this.closed || this.outboxStorageFault || !client || !connection || value.state === "blocked" || this.delivering.has(value.id) || this.connectionState !== "online" || Date.now() < (this.sendRetryAfter.get(value.id) ?? 0)) return;
    if (value.receiptId && value.receiptRefSeq === undefined && this.checkedReceipts.has(value.id)) return;
    this.delivering.add(value.id);
    try {
      if (value.state === "unknown" && !value.receiptId) { await this.persistOutbox({ ...value, state: "blocked" }); this.actionError("This task could not be confirmed and will not run again automatically. Your original message is still saved."); return; }
      if (value.receiptId && value.receiptRefSeq !== undefined) {
        await this.removeAcknowledged(connection.id, value.id); return;
      }
      if (!value.receiptId && client.isCatalogueReady && !client.isThreadAvailable(value.threadId)) {
        await this.persistOutbox({ ...value, state: "blocked" });
        this.actionError("This conversation is unavailable. Your unsent message is still saved on this device."); return;
      }
      try { await this.persistOutbox({ ...value, state: "sending" }); }
      catch { this.outboxStorageFault = true; this.actionError("Your message could not be saved and was not sent. Keep your app data and reopen Hermes."); return; }
      if (value.receiptId) this.checkedReceipts.add(value.id);
      const receipt = value.receiptId ? await client.getReceipt(value.receiptId) : await client.send(value.threadId, value.id, value.text, [...value.attachmentIds]);
      if (this.closed || this.client !== client || this.connection !== connection) return;
      if (receipt.thread_id !== value.threadId || receipt.client_message_id !== value.id || receipt.durable !== true || value.receiptId && receipt.id !== value.receiptId || receipt.ref_seq !== undefined && (!Number.isSafeInteger(receipt.ref_seq) || receipt.ref_seq <= 0 || value.receiptRefSeq !== undefined && receipt.ref_seq !== value.receiptRefSeq)) throw new ProtocolError("Message confirmation identity mismatch.");
      const acknowledged = { ...value, state: "pending" as const, receiptId: receipt.id, ...(receipt.ref_seq !== undefined ? { receiptRefSeq: receipt.ref_seq } : {}) };
      try { await this.persistOutbox(acknowledged); }
      catch { this.outboxStorageFault = true; this.actionError("Your message was received, but its status could not be saved here. Keep your app data and reopen Hermes."); return; }
      this.sendRetryAfter.delete(value.id);
      if (receipt.ref_seq !== undefined) {
        client.rememberAcceptedInput(value.threadId, value.id, value.text, value.attachmentIds.map(id => client.attachments.get(id)).filter((a): a is Attachment => Boolean(a)), value.createdAt / 1000, receipt);
        await this.removeAcknowledged(connection.id, value.id);
      } else {
        this.checkedReceipts.add(value.id);
        this.actionError("Your message was received, but its saved original could not be confirmed yet. It will not be sent again automatically.");
      }
    } catch (error) {
      if (this.closed || this.client !== client || this.connection !== connection || !this.outbox.some(item => item.id === value.id)) return;
      this.stopIfUnauthorized(error);
      if (error instanceof HttpError && error.retryAfterMs) this.sendRetryAfter.set(value.id, Date.now() + error.retryAfterMs);
      if (!value.receiptId) await this.persistOutbox({ ...value, state: isRetryableError(error) ? "pending" : "blocked" });
      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) this.actionError("This device is no longer authorized. Pair it again before sending. Your message is still saved.");
      else if (!isRetryableError(error)) this.actionError("This message could not be sent. Your message is still saved on this device.");
    } finally { this.delivering.delete(value.id); this.scheduleOutbox(); }
  }

  private async removeAcknowledged(connectionId: string, id: string): Promise<void> {
    try { await this.outboxStore.remove(connectionId, id); }
    catch { this.actionError("A received message could not be cleared from local storage. Keep your app data; Hermes will try again."); return; }
    if (this.connection?.id !== connectionId || this.closed) return;
    this.outbox = this.outbox.filter(item => item.id !== id); this.checkedReceipts.delete(id); this.changed();
  }

  private async flushOutbox(): Promise<void> {
    if (this.flushingOutbox || this.connectionState !== "online") return;
    this.flushingOutbox = true;
    try { for (const pending of [...this.outbox]) if (pending.state === "pending" || pending.state === "unknown" || pending.receiptRefSeq !== undefined) await this.deliver(pending); }
    finally { this.flushingOutbox = false; this.scheduleOutbox(); }
  }


  async stopThread(threadId = this.selectedThreadId): Promise<void> {
    if (!threadId) return;
    try { await this.requireClient().stop(threadId); }
    catch { this.actionError("The running task could not be stopped. It may have already finished."); }
  }

  async cancelQueued(receiptId: string, threadId = this.selectedThreadId): Promise<void> {
    if (!threadId || this.client?.receipts.get(receiptId)?.thread_id !== threadId) return;
    try { await this.client.cancelQueued(threadId, receiptId); }
    catch { this.actionError("The queued message could not be cancelled. Its state may have changed."); }
  }

  async answerInteraction(interactionId: string, choice: string, threadId = this.selectedThreadId): Promise<void> {
    const item = this.client?.interactions.get(interactionId);
    if (!item || item.thread_id !== threadId || item.state !== "pending" || !item.choices.includes(choice)) return;
    try { await this.client!.answerInteraction(item, choice); }
    catch { this.actionError("That request is no longer pending. Hermes will refresh its status."); await this.client?.getInteraction(item.thread_id, item.id).catch(() => {}); }
  }

  async pickAndUploadAttachments(targetThreadId?: string): Promise<readonly DesktopAttachment[]> {
    const threadId = targetThreadId ?? this.selectedThreadId;
    const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"], title: "Attach files to Hermes" });
    if (result.canceled) return [];
    if (!threadId) return [];
    return this.uploadAttachmentPaths(result.filePaths, threadId);
  }

  async uploadAttachmentPaths(filePaths: readonly string[], targetThreadId?: string): Promise<readonly DesktopAttachment[]> {
    return this.uploadAttachmentInputs(filePaths, targetThreadId);
  }

  async uploadAttachmentInputs(inputs: readonly AttachmentInput[], targetThreadId?: string): Promise<readonly DesktopAttachment[]> {
    const client = this.requireClient(), threadId = targetThreadId ?? this.selectedThreadId;
    if (!threadId) return [];
    if (!client.isThreadAvailable(threadId)) throw new Error("This conversation is unavailable.");
    const files: Array<{ name: string; bytes: Uint8Array }> = [];
    for (const input of attachmentInputs(inputs)) {
      if (typeof input !== 'string') { files.push(input); continue; }
      const filePath = input;
      if (!filePath || !isAbsolute(filePath)) throw new Error("The attachment path is invalid.");
      const info = await stat(filePath);
      if (!info.isFile() || info.size < 1 || info.size > MAX_ATTACHMENT_BYTES) throw new Error("Each attachment must be a file between 1 byte and 10 MiB.");
      files.push({ name: basename(filePath), bytes: new Uint8Array(await readFile(filePath)) });
    }
    attachmentInputs(files); // Recheck actual bytes after a potentially racing disk read.
    const uploaded: DesktopAttachment[] = [];
    try {
      if (this.client !== client || !client.isThreadAvailable(threadId)) throw new Error('Session unavailable');
      for (const file of files) uploaded.push(this.projectAttachment(await client.upload(threadId, file.name, file.bytes)));
      if (this.client !== client || !client.isThreadAvailable(threadId)) throw new Error('Session unavailable');
    } catch {
      await Promise.all(uploaded.map(({ id }) => client.deleteUnattached(threadId, id).catch(() => {})));
      this.actionError("The attachments could not be uploaded. Check their size and try again.");
      throw new Error("Attachment upload was not confirmed.");
    }
    return uploaded;
  }

  async deleteUnattachedAttachment(attachmentId: string, threadId = this.selectedThreadId): Promise<void> {
    const attachment = this.client?.attachments.get(attachmentId);
    if (!attachment || attachment.thread_id !== threadId || attachment.receipt_id) return;
    await this.client?.deleteUnattached(attachment.thread_id, attachment.id);
  }

  async attachmentPreview(attachmentId: string, threadId: string): Promise<import('../shared/browser-policy').PreviewDocument> {
    const client = this.requireClient();
    const attachment = await client.getAttachment(threadId, attachmentId);
    if (!attachment || attachment.id !== attachmentId || attachment.thread_id !== threadId || attachment.state !== 'available'
      || !attachment.size || attachment.size > MAX_ATTACHMENT_BYTES || this.client !== client) throw new Error('The file is unavailable.');
    const bytes = await client.download(threadId, attachmentId);
    if (this.client !== client || !client.isThreadAvailable(threadId) || bytes.byteLength !== attachment.size) throw new Error('The file is unavailable.');
    return { name: attachment.name ?? 'Attachment', mime: attachment.mime ?? 'application/octet-stream', bytes };
  }

  previewResources(threadId: string): Array<{ id: string; name: string }> {
    const client = this.requireClient();
    return [...client.attachments.values()].filter(item => item.thread_id === threadId && item.state === 'available'
      && !!item.name && /\.(png|jpe?g|gif|webp|css|js|mjs|woff2?|ttf)$/i.test(item.name)).map(item => ({ id: item.id, name: item.name! }));
  }

  async downloadAttachment(attachmentId: string, action: "save" | "open", targetThreadId = this.selectedThreadId): Promise<void> {
    const client = this.requireClient(), threadId = targetThreadId;
    const attachment = client.attachments.get(attachmentId);
    if (!threadId || !attachment || attachment.thread_id !== threadId || attachment.state !== "available") return;
    const bytes = await client.download(threadId, attachmentId);
    if (attachment.size !== undefined && bytes.byteLength !== attachment.size) throw new Error("The attachment is incomplete. Try again.");
    const safeName = (attachment.name ?? "Attachment").replace(/[\x00-\x1f\x7f/\\:]/g, "_").slice(0, 180) || "Attachment";
    let target: string;
    if (action === "save") {
      const selected = await dialog.showSaveDialog({ title: "Save Hermes attachment", defaultPath: safeName });
      if (selected.canceled || !selected.filePath) return;
      target = selected.filePath;
    } else {
      const folder = join(app.getPath("temp"), "Hermes");
      await mkdir(folder, { recursive: true, mode: 0o700 });
      target = join(folder, `${randomUUID()}${extname(safeName).slice(0, 20)}`);
    }
    const temporary = `${target}.partial`;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(temporary, bytes, { mode: 0o600 });
    await rename(temporary, target);
    if (action === "open") {
      const failure = await shell.openPath(target);
      if (failure) { await rm(target, { force: true }); throw new Error("The attachment could not be opened."); }
      const cleanup = setTimeout(() => void rm(target, { force: true }), 10 * 60 * 1000);
      cleanup.unref();
    }
  }

  async retryConnection(): Promise<void> {
    this.errorMessage = undefined;
    await this.client?.retryNow();
    this.changed();
  }

  async previewAttachmentImage(attachmentId: string, targetThreadId = this.selectedThreadId): Promise<string> {
    const client = this.requireClient(), threadId = targetThreadId;
    const attachment = client.attachments.get(attachmentId);
    if (!threadId || !attachment || attachment.thread_id !== threadId || attachment.state !== "available"
        || !/^image\/(png|jpeg|gif|webp)$/.test(attachment.mime ?? "") || !attachment.size || attachment.size > 10 * 1024 * 1024) {
      throw new Error("The image is unavailable.");
    }
    const bytes = await client.download(threadId, attachmentId);
    if (bytes.length !== attachment.size || this.client !== client) throw new Error("The image is unavailable.");
    return `data:${attachment.mime};base64,${Buffer.from(bytes).toString("base64")}`;
  }

  async resumeConnection(): Promise<void> {
    // Wake invalidates old sockets; never bypass a permanent/auth failure.
    if (this.closed || this.connectionState === "blocked" || this.connectionState === "suspended") return;
    await this.client?.retryNow();
  }

  close(): void {
    this.pairingGeneration++;
    this.closed = true;
    this.cancelRecovery();
    this.pairingController?.abort();
    this.client?.close();
  }
}
