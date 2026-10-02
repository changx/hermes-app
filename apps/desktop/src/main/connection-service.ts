import { randomBytes, randomUUID } from "node:crypto";
import { readFile, rename, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { app, dialog, shell } from "electron";
import { HttpError, ProtocolError, isRetryableError, type Attachment, type ConnectionState, type Thread } from "@hermes-app/client";
import { LiveSessionClient } from "@hermes-app/client/live";
import type { ChannelInput, DesktopAttachment, DesktopSnapshot, PairingRequest, SendMessageInput, ThreadInput } from "../shared/desktop-api";
import { CredentialStore, type StoredConnection, type StoredPairing } from "./credential-store";
import { OutboxStore, type OutboxRecord } from "./outbox-store";

import { mainTransport, normalizeBaseUrl } from "./transport";

const stateLabel: Record<ConnectionState, string> = {
  connecting: "Connecting",
  syncing: "Syncing",
  online: "Online",
  retrying: "Reconnecting",
  suspended: "Offline",
  blocked: "Connection needs attention",
};

const normalizeCode = (value: string): string => {
  const code = value.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z2-7]{16}$/.test(code)) throw new Error("Enter the complete one-time pairing code.");
  return code.match(/.{4}/g)!.join("-");
};

const deviceName = (value: string): string => {
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
  private readonly store = new CredentialStore();
  private readonly outboxStore = new OutboxStore();
  private client: LiveSessionClient | null = null;
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
  private olderCursor: string | undefined;
  private visibleStartRef: number | undefined;
  private loadingMessages = false;
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
  private async recoverRead(key: string, operation: (signal: AbortSignal) => Promise<void>, valid: () => boolean): Promise<void> {
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

  constructor(private readonly publish: (snapshot: DesktopSnapshot) => void) {}

  snapshot(): DesktopSnapshot {
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
        running: "running" in thread ? Boolean(thread.running) : runningThreads.has(thread.id),
        completedUnread: thread.completed_unread,
        resultVersion: thread.result_version,
        resultRef: thread.result_ref,
        ...("last_message_at" in thread && typeof thread.last_message_at === "number" ? { lastMessageAt: thread.last_message_at } : {}),
      }))
      .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0) || a.title.localeCompare(b.title));
    const selected = this.selectedThreadId ? combined.get(this.selectedThreadId) : undefined;
    const receiptByClient = new Map(receipts.map((receipt) => [receipt.client_message_id, receipt]));
    const durable = this.selectedThreadId
      ? [...(this.client?.messages.get(this.selectedThreadId) ?? [])].filter(({ role,ref_seq }) => role !== "analysis" && role !== "reasoning" && (this.visibleStartRef === undefined || ref_seq >= this.visibleStartRef))
      : [];
    const durableClientIds = new Set(durable.flatMap(({ client_message_id }) => client_message_id ? [client_message_id] : []));
    const messages: Array<DesktopSnapshot["messages"][number]> = durable.map(({ id, ref_seq, role, text, display_kind, created_at, client_message_id, receipt_id, tool_calls = [], attachments = [] }) => {
      const receipt = receipt_id ? this.client?.receipts.get(receipt_id) : client_message_id ? receiptByClient.get(client_message_id) : undefined;
      return {
        id: client_message_id ? `client:${client_message_id}` : `message:${id}`,
        role: role === "assistant" || role === "commentary" ? "assistant" as const : role === "user" ? "user" as const : "system" as const,
        text,
        ...(display_kind ? { displayKind: display_kind } : {}),
        refSeq: ref_seq,
        ...(client_message_id ? { clientMessageId: client_message_id } : {}),
        ...(receipt ? { receiptId: receipt.id } : {}),
        ...(created_at ? { createdAt: created_at } : {}),
        ...(receipt ? { receiptState: receipt.state, processing: receipt.processing, ...(receipt.feedback ? { feedback: receipt.feedback } : {}) } : {}),
        toolCalls: tool_calls.map(({ id: toolId, name, label, detail, caption, icon }) => ({ id: toolId, name, label, ...(detail ? { detail } : {}), ...(caption ? { caption } : {}), ...(icon ? { icon } : {}) })),
        attachments: attachments.map((attachment) => this.projectAttachment(attachment)),
      };
    });
    if (this.selectedThreadId) {
      for (const pending of this.outbox) {
        if (pending.threadId !== this.selectedThreadId || durableClientIds.has(pending.id)) continue;
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
      .filter((item) => item.thread_id === this.selectedThreadId && item.state === "pending")
      .map(({ id, kind, prompt, choices }) => ({ id, kind, prompt, choices: [...choices] }));
    return Object.freeze({
      revision: this.revision,
      phase: this.phase,
      connectionState: this.connectionState,
      connectionLabel: stateLabel[this.connectionState],
      // The SDK cursor is established only after the authoritative initial
      // snapshot has completed, including a legitimately empty account.
      loadingConversations: this.phase === "connected" && !this.client?.isCatalogueReady,
      loadingMessages: this.loadingMessages,
      ...(this.statusMessage ? { statusMessage: this.statusMessage } : {}),
      ...(this.errorMessage || this.connectionIssue ? { errorMessage: this.errorMessage ?? this.connectionIssue } : {}),
      channels,
      threads,
      messages,
      interactions,
      canLoadOlder: Boolean(this.olderCursor),
      ...(this.selectedChannelId ? { selectedChannelId: this.selectedChannelId } : {}),
      ...(this.selectedThreadId ? { selectedThreadId: this.selectedThreadId } : {}),
      ...(selected ? { selectedThreadTitle: selected.title } : {}),
    });
  }

  private projectAttachment({ id, name = "Attachment", mime = "application/octet-stream", size = 0, state, public_url }: Attachment): DesktopAttachment {
    return { id, name, mime, size, state, ...(public_url ? { publicUrl: public_url } : {}) };
  }

  private changed(): void {
    this.revision += 1;
    this.publish(this.snapshot());
  }

  async initialize(): Promise<void> {
    try {
      // Retire only the former server-history projection directory. Credentials
      // and encrypted unsent originals are separate stores and remain intact.
      await rm(join(app.getPath("userData"), "conversation-cache"), { recursive: true, force: true }).catch(() => { throw new Error("legacy-history-cleanup"); });
      await rm(join(app.getPath("temp"), "Hermes"), { recursive: true, force: true }).catch(() => {});
      const state = await this.store.load();
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

    this.connection = connection;
    this.listedThreads.clear();
    this.selectedChannelId = undefined;
    this.selectedThreadId = undefined;
    this.olderCursor = undefined;
    this.errorMessage = undefined;
    this.statusMessage = undefined;
    this.phase = "connected";
    this.outbox = (await this.outboxStore.list(connection.id)).map((item) => item.state === "sending" ? { ...item, state: "pending" as const } : item);
    const transport = mainTransport(connection.baseUrl);
    this.outboxStorageFault = false; this.checkedReceipts.clear();
    let client: LiveSessionClient;
    client = new LiveSessionClient({
      ...transport,
      token: () => connection.token,
      onChange: () => {
        if (this.closed || this.client !== client) return;
        this.listedThreads = new Map([...client.threads].map(([id,thread]) => [id,{...thread}]));
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
    try {
      const pairing: StoredPairing = {
        version: 1,
        connection: createConnection(request.baseUrl),
        code: normalizeCode(request.code),
        deviceName: deviceName(request.deviceName),
      };
      await this.store.savePairing(pairing);
      await this.completePairing(pairing);
    } catch (error) {
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
          if (check.status === 200) {
            const body = check.body;
            if (body?.protocol !== 1 || body.durable_sync !== true) throw new Error("unsupported");
            await this.store.saveConnection(pairing.connection);
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
    this.pairingController?.abort();
    this.pairingController = null;
    await this.store.delete();
    this.phase = "unpaired";
    this.statusMessage = undefined;
    this.errorMessage = undefined;
    this.changed();
  }

  async forgetConnection(): Promise<void> {
    this.closed = true;
    this.cancelRecovery();
    this.connectionIssue = undefined;
    this.pairingController?.abort();
    this.pairingController = null;
    this.client?.close();
    this.client = null;
    const connectionId = this.connection?.id;
    this.connection = null;
    this.outbox = [];
    this.listedThreads.clear();
    this.selectedChannelId = undefined;
    this.selectedThreadId = undefined;
    this.olderCursor = undefined;
    await this.store.delete();
    if (connectionId) await this.outboxStore.clear(connectionId);
    this.phase = "unpaired";
    this.connectionState = "suspended";
    this.statusMessage = undefined;
    this.errorMessage = undefined;
    this.changed();
  }

  async selectChannel(channelId: string): Promise<void> {
    if (!this.client?.channels.has(channelId)) return;
    this.readJobs.get("history")?.abort(); this.readJobs.get("older")?.abort();
    this.selectedChannelId = channelId; this.selectedThreadId = undefined;
    this.olderCursor = undefined; this.visibleStartRef = undefined; this.loadingMessages = false;
    this.client.closeConversation(); this.changed();
  }

  async markResultRead(threadId: string, version: number, ref: number): Promise<void> {
    if (threadId !== this.selectedThreadId || !Number.isSafeInteger(version) || version <= 0 || !Number.isSafeInteger(ref) || ref <= 0) return;
    await this.client?.markResultRead(threadId, version, ref);
  }

  async selectThread(threadId: string): Promise<void> {
    const client = this.client;
    const thread = client?.threads.get(threadId) ?? this.listedThreads.get(threadId);
    if (!client || !thread || thread.archived || !client.channels.has(thread.project_id)) return;
    this.readJobs.get("history")?.abort(); this.readJobs.get("older")?.abort();
    this.selectedChannelId = thread.project_id; this.selectedThreadId = threadId;
    this.olderCursor = undefined; this.visibleStartRef = undefined; this.loadingMessages = true;
    this.changed();
    const valid = () => !this.closed && this.client === client && this.selectedThreadId === threadId;
    await this.recoverRead("history", async signal => {
      await client.openConversation(threadId);
      if (!signal.aborted && valid()) {
        this.olderCursor = client.currentOlderCursor ?? undefined;
        this.visibleStartRef = client.messages.get(threadId)?.[0]?.ref_seq;
        this.loadingMessages = false; this.changed();
      }
    }, valid);
  }

  private requireClient(): LiveSessionClient {
    if (!this.client || !this.connection) throw new Error("Hermes is not connected.");
    return this.client;
  }

  private actionError(message: string): void {
    this.errorMessage = message;
    this.changed();
  }

  async createChannel(input: ChannelInput): Promise<void> {
    const name = input.name.trim(), description = input.description.trim();
    if (!name || name.length > 120 || description.length > 4000) throw new Error("Enter a channel name and a shorter description.");
    let channel: Awaited<ReturnType<LiveSessionClient["createChannel"]>>;
    try { channel = await this.requireClient().createChannel(name, description); }
    catch { this.actionError("The channel could not be created. Check your permission and try again."); throw new Error("Channel creation was not confirmed."); }
    await this.selectChannel(channel.id).catch(() => this.actionError("The channel was created, but its topics could not be loaded yet."));
  }

  async getChannelInfo(channelId: string): Promise<DesktopSnapshot["channels"][number]> {
    const channel = await this.requireClient().getChannelInfo(channelId);
    return { id: channel.id, name: channel.name, ...(channel.description ? { description: channel.description } : {}) };
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
      if (this.selectedChannelId === channelId) {
        this.selectedChannelId = undefined;
        this.selectedThreadId = undefined;
        this.listedThreads.clear();
        this.olderCursor = undefined;
        await this.selectInitialChannel();
      }
      this.changed();
    } catch { this.actionError("The channel could not be deleted. Check that it is empty and that you have permission."); }
  }

  async createThread(input: ThreadInput): Promise<string> {
    const client = this.requireClient(), channelId = input.channelId ?? this.selectedChannelId;
    const title = input.title.trim();
    if (!channelId || !client.channels.has(channelId) || !title || title.length > 200 || !/^th_[A-Za-z0-9_-]{8,64}$/.test(input.clientThreadId)) throw new Error("Choose a channel and enter a topic title.");
    try {
      const thread = await client.createThread(channelId, title, input.clientThreadId);
      this.listedThreads.set(thread.id, thread);
      await this.selectThread(thread.id);
      return thread.id;
    } catch { this.actionError("The topic could not be created. Check your permission and try again."); throw new Error("Topic creation was not confirmed."); }
  }

  async renameThread(threadId: string, titleValue: string): Promise<void> {
    const title = titleValue.trim();
    if (!title || title.length > 200 || !this.listedThreads.has(threadId)) throw new Error("Enter a topic title.");
    try { const thread = await this.requireClient().updateThread(threadId, { title }); this.listedThreads.set(thread.id, thread); this.changed(); }
    catch { this.actionError("The topic could not be renamed. It may have changed on another device."); throw new Error("Topic rename was not confirmed."); }
  }

  async archiveThread(threadId: string): Promise<void> {
    if (!this.listedThreads.has(threadId)) return;
    try {
      await this.requireClient().archiveThread(threadId);
      this.listedThreads.delete(threadId);
      if (this.selectedThreadId === threadId) {
        this.selectedThreadId = undefined;
        this.olderCursor = undefined;
        const fallback = this.snapshot().threads.find((thread) => thread.channelId === this.selectedChannelId);
        if (fallback) await this.selectThread(fallback.id);
      }
      this.changed();
    } catch { this.actionError("The topic could not be archived. Try again after Hermes reconnects."); }
  }

  async loadOlder(): Promise<void> {
    const client = this.requireClient(), threadId = this.selectedThreadId, before = this.olderCursor;
    if (!threadId || !before || !client.supportsLatest) return;
    if (this.readJobs.has("older")) return;
    const valid = () => this.client === client && this.selectedThreadId === threadId && this.olderCursor === before;
    await this.recoverRead("older", async (signal) => {
      const page = await client.historyWindow(threadId, before, 50, signal);
      if (!signal.aborted && valid()) {
        if (page.messages?.length) this.visibleStartRef = Math.min(this.visibleStartRef ?? Infinity,page.messages[0].ref_seq);
        this.olderCursor = page.older_cursor ?? undefined; this.changed();
      }
    }, valid);
  }

  async sendMessage(input: SendMessageInput): Promise<void> {
    const client = this.requireClient(), connection = this.connection!, threadId = this.selectedThreadId;
    const text = input.text.replace(/\r\n/g, "\n");
    const attachmentIds = [...input.attachmentIds];
    if (this.outboxStorageFault) throw new Error("Saved messages could not be updated. Keep your app data and reopen Hermes.");
    if (!threadId || !client.isThreadAvailable(threadId) || text.length > 100_000 || (!text.trim() && !attachmentIds.length) || attachmentIds.length > 8 || new Set(attachmentIds).size !== attachmentIds.length) throw new Error("Write a message or add an attachment before sending.");
    // Unsent file IDs belong to the user's draft, not to a hidden content cache.
    // Revalidate them only when that user explicitly sends the opened draft.
    for (const id of attachmentIds) {
      const attachment: Attachment = client.attachments.get(id) ?? await client.getAttachment(threadId, id);
      if (this.client !== client || this.connection !== connection || this.selectedThreadId !== threadId || attachment.thread_id !== threadId || attachment.state !== "available" || attachment.receipt_id) throw new Error("An attachment is no longer available. Your draft is still here.");
    }
    const pending: OutboxRecord = { version: 1, id: `desktop:${randomUUID()}`, threadId, text, attachmentIds, createdAt: Date.now(), state: "pending" };
    await this.outboxStore.put(connection.id, pending);
    this.outbox.push(pending);
    this.changed();
    await this.deliver(pending);
  }

  async retryMessage(clientMessageId: string): Promise<void> {
    const pending = this.outbox.find(({ id }) => id === clientMessageId);
    if (pending) { this.checkedReceipts.delete(pending.id); await this.deliver(pending.state === "blocked" && !pending.receiptId ? { ...pending, state: "pending" } : pending); }
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


  async stopThread(): Promise<void> {
    if (!this.selectedThreadId) return;
    try { await this.requireClient().stop(this.selectedThreadId); }
    catch { this.actionError("The running task could not be stopped. It may have already finished."); }
  }

  async cancelQueued(receiptId: string): Promise<void> {
    if (!this.selectedThreadId || !this.client?.receipts.has(receiptId)) return;
    try { await this.client.cancelQueued(this.selectedThreadId, receiptId); }
    catch { this.actionError("The queued message could not be cancelled. Its state may have changed."); }
  }

  async answerInteraction(interactionId: string, choice: string): Promise<void> {
    const item = this.client?.interactions.get(interactionId);
    if (!item || item.thread_id !== this.selectedThreadId || item.state !== "pending" || !item.choices.includes(choice)) return;
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
    const client = this.requireClient(), threadId = targetThreadId ?? this.selectedThreadId;
    if (!threadId) return [];
    if (!client.isThreadAvailable(threadId)) throw new Error("This conversation is unavailable.");
    if (filePaths.length > 8) throw new Error("Choose no more than eight files.");
    const files: Array<{ path: string; name: string; bytes: Uint8Array }> = [];
    for (const filePath of filePaths) {
      if (!filePath || !isAbsolute(filePath)) throw new Error("The attachment path is invalid.");
      const info = await stat(filePath);
      if (!info.isFile() || info.size < 1 || info.size > 10 * 1024 * 1024) throw new Error("Each attachment must be a file between 1 byte and 10 MiB.");
      files.push({ path: filePath, name: basename(filePath), bytes: new Uint8Array(await readFile(filePath)) });
    }
    const uploaded: DesktopAttachment[] = [];
    try {
      for (const file of files) uploaded.push(this.projectAttachment(await client.upload(threadId, file.name, file.bytes)));
    } catch {
      await Promise.all(uploaded.map(({ id }) => client.deleteUnattached(threadId, id).catch(() => {})));
      this.actionError("The attachments could not be uploaded. Check their size and try again.");
      throw new Error("Attachment upload was not confirmed.");
    }
    return uploaded;
  }

  async deleteUnattachedAttachment(attachmentId: string): Promise<void> {
    const attachment = this.client?.attachments.get(attachmentId);
    if (!attachment || attachment.thread_id !== this.selectedThreadId || attachment.receipt_id) return;
    await this.client?.deleteUnattached(attachment.thread_id, attachment.id);
  }

  async downloadAttachment(attachmentId: string, action: "save" | "open"): Promise<void> {
    const client = this.requireClient(), threadId = this.selectedThreadId;
    const attachment = client.attachments.get(attachmentId);
    if (!threadId || !attachment || attachment.thread_id !== threadId || attachment.state !== "available") return;
    const bytes = await client.download(threadId, attachmentId);
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

  async previewAttachmentImage(attachmentId: string): Promise<string> {
    const client = this.requireClient(), threadId = this.selectedThreadId;
    const attachment = client.attachments.get(attachmentId);
    if (!threadId || !attachment || attachment.thread_id !== threadId || attachment.state !== "available"
        || !/^image\/(png|jpeg|gif|webp)$/.test(attachment.mime ?? "") || !attachment.size || attachment.size > 10 * 1024 * 1024) {
      throw new Error("The image is unavailable.");
    }
    const bytes = await client.download(threadId, attachmentId);
    if (bytes.length !== attachment.size || this.client !== client || this.selectedThreadId !== threadId) throw new Error("The image is unavailable.");
    return `data:${attachment.mime};base64,${Buffer.from(bytes).toString("base64")}`;
  }

  async resumeConnection(): Promise<void> {
    // Wake invalidates old sockets; never bypass a permanent/auth failure.
    if (this.closed || this.connectionState === "blocked" || this.connectionState === "suspended") return;
    await this.client?.retryNow();
  }

  close(): void {
    this.closed = true;
    this.cancelRecovery();
    this.pairingController?.abort();
    this.client?.close();
  }
}
