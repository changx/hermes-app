import { randomBytes } from "node:crypto";
import { HermesClient, connectionFailure, type ConnectionState, type Thread } from "@hermes-app/client";
import type { DesktopSnapshot, PairingRequest } from "../shared/desktop-api";
import { CredentialStore, type StoredConnection, type StoredPairing } from "./credential-store";
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
  private client: HermesClient | null = null;
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

  constructor(private readonly publish: (snapshot: DesktopSnapshot) => void) {}

  snapshot(): DesktopSnapshot {
    const channels = [...(this.client?.channels.values() ?? [])]
      .map(({ id, name, description }) => ({ id, name, ...(description ? { description } : {}) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const projected = this.client?.threads ?? new Map();
    const combined = new Map<string, Thread | (typeof projected extends Map<string, infer V> ? V : never)>();
    for (const [id, thread] of this.listedThreads) combined.set(id, thread);
    for (const [id, thread] of projected) combined.set(id, thread);
    const threads = [...combined.values()]
      .filter((thread) => !this.selectedChannelId || thread.project_id === this.selectedChannelId)
      .map((thread) => ({
        id: thread.id,
        channelId: thread.project_id,
        title: thread.title,
        unreadCount: "unread_count" in thread && typeof thread.unread_count === "number" ? thread.unread_count : 0,
        ...("last_message_at" in thread && typeof thread.last_message_at === "number" ? { lastMessageAt: thread.last_message_at } : {}),
      }))
      .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0) || a.title.localeCompare(b.title));
    const selected = this.selectedThreadId ? combined.get(this.selectedThreadId) : undefined;
    const messages = this.selectedThreadId
      ? [...(this.client?.messages.get(this.selectedThreadId) ?? [])].map(({ id, role, text, created_at }) => ({
        id,
        role: role === "assistant" ? "assistant" as const : role === "user" ? "user" as const : "system" as const,
        text,
        ...(created_at ? { createdAt: created_at } : {}),
      }))
      : [];
    return Object.freeze({
      revision: this.revision,
      phase: this.phase,
      connectionState: this.connectionState,
      connectionLabel: stateLabel[this.connectionState],
      ...(this.statusMessage ? { statusMessage: this.statusMessage } : {}),
      ...(this.errorMessage ? { errorMessage: this.errorMessage } : {}),
      channels,
      threads,
      messages,
      ...(this.selectedChannelId ? { selectedChannelId: this.selectedChannelId } : {}),
      ...(this.selectedThreadId ? { selectedThreadId: this.selectedThreadId } : {}),
      ...(selected ? { selectedThreadTitle: selected.title } : {}),
    });
  }

  private changed(): void {
    this.revision += 1;
    this.publish(this.snapshot());
  }

  async initialize(): Promise<void> {
    try {
      const state = await this.store.load();
      if (!state) { this.phase = "unpaired"; this.changed(); return; }
      if (state.connection) { await this.startClient(state.connection); return; }
      if (state.pairing) {
        this.phase = "pairing";
        this.statusMessage = "Resuming secure pairing…";
        this.changed();
        void this.completePairing(state.pairing);
      }
    } catch {
      this.phase = "unpaired";
      this.errorMessage = "The saved connection could not be opened. You can forget it and pair again.";
      this.changed();
    }
  }

  private async startClient(connection: StoredConnection): Promise<void> {
    this.client?.close();
    this.connection = connection;
    this.listedThreads.clear();
    this.selectedChannelId = undefined;
    this.selectedThreadId = undefined;
    this.errorMessage = undefined;
    this.statusMessage = undefined;
    this.phase = "connected";
    const transport = mainTransport(connection.baseUrl);
    let client: HermesClient;
    client = new HermesClient({
      ...transport,
      token: () => connection.token,
      onChange: () => { this.changed(); void this.selectInitialChannel(); },
      onConnectionState: (state) => { this.connectionState = state; this.changed(); },
      onError: (error) => { this.errorMessage = this.connectionError(error); this.changed(); },
    });
    this.client = client;
    this.changed();
    await client.connect();
  }

  private connectionError(error: Error): string {
    const safe = connectionFailure(error);
    if (safe.startsWith("HTTP 401") || safe.startsWith("HTTP 403")) return "This device is no longer authorized. Pair it again.";
    if (safe.startsWith("HTTP 429")) return "The server is busy. Hermes will retry automatically.";
    if (safe.includes("timed out")) return "The server did not respond. Hermes will keep trying.";
    return "Hermes could not connect. Check the server address and network.";
  }

  private async selectInitialChannel(): Promise<void> {
    if (this.selectingInitialChannel || this.selectedChannelId || !this.client?.channels.size) return;
    this.selectingInitialChannel = true;
    try {
      const first = [...this.client.channels.values()].sort((a, b) => a.name.localeCompare(b.name))[0];
      await this.selectChannel(first.id);
    } catch {
      this.errorMessage = "Threads could not be loaded. Hermes will try again when the connection changes.";
      this.changed();
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
    this.pairingController?.abort();
    this.pairingController = null;
    this.client?.close();
    this.client = null;
    this.connection = null;
    this.listedThreads.clear();
    this.selectedChannelId = undefined;
    this.selectedThreadId = undefined;
    await this.store.delete();
    this.phase = "unpaired";
    this.connectionState = "suspended";
    this.statusMessage = undefined;
    this.errorMessage = undefined;
    this.changed();
  }

  async selectChannel(channelId: string): Promise<void> {
    if (!this.client?.channels.has(channelId)) return;
    this.selectedChannelId = channelId;
    this.selectedThreadId = undefined;
    this.listedThreads.clear();
    this.changed();
    let after: string | undefined;
    do {
      const page = await this.client.listThreads(channelId, after, 100);
      for (const thread of page.threads) this.listedThreads.set(thread.id, thread);
      after = page.next_cursor ?? undefined;
    } while (after);
    this.changed();
  }

  async selectThread(threadId: string): Promise<void> {
    const thread = this.listedThreads.get(threadId) ?? this.client?.threads.get(threadId);
    if (!thread || thread.project_id !== this.selectedChannelId || !this.client) return;
    this.selectedThreadId = threadId;
    this.changed();
    try {
      if (this.client.supportsLatest) await this.client.historyWindow(threadId, undefined, 50);
      else await this.client.history(threadId, undefined, 50);
      const messages = this.client.messages.get(threadId);
      const last = messages?.at(-1)?.ref_seq;
      if (last) await this.client.markRead(threadId, last).catch(() => {});
    } catch {
      this.errorMessage = "This conversation could not be loaded. Try again when the connection is online.";
      this.changed();
    }
  }

  async retryConnection(): Promise<void> {
    this.errorMessage = undefined;
    await this.client?.retryNow();
    this.changed();
  }

  close(): void {
    this.pairingController?.abort();
    this.client?.close();
  }
}
