import { randomBytes } from 'node:crypto';
import type { ChannelInput, DesktopConnection, DesktopLocalDraft, DesktopSnapshot, PairingRequest, SendMessageInput, ThreadInput } from '../shared/desktop-api';
import type { AttachmentInput } from '../shared/attachment-input';
import { buildSessionLink, parseSessionLink, relativeSessionThread, sessionServer } from '../../../../packages/client/src/sessionLinks';
import { DesktopConnectionService, deviceName, normalizeCode } from './connection-service';
import { CredentialStore } from './credential-store';
import { ConnectionIndex, ConnectionNames, normalizeConnectionName, type ConnectionEntry } from './connection-index';
import { LocalDraftStore } from './local-draft-store';
import { OutboxStore } from './outbox-store';
import { normalizeBaseUrl } from './transport';

type Account = { id: string; server?: string; service: DesktopConnectionService };
/** Each account owns a live SDK client. UI IDs are qualified, wire IDs remain unchanged. */
export class DesktopConnections {
  readonly primary: DesktopConnectionService;
  private readonly accounts = new Map<string, Account>();
  private readonly index = new ConnectionIndex();
  private readonly drafts = new LocalDraftStore();
  private readonly outbox = new OutboxStore();
  private readonly nameStore = new ConnectionNames();
  private entries: ConnectionEntry[] = [];
  /** Names chosen on this device by slot ID; a missing entry uses the host name. */
  private names: Record<string, string> = {};
  private namesError = false;
  private active = 'primary';
  private revision = 0;
  private listError?: string;
  private ready = false;
  private closed = false;
  private mutation: Promise<void> = Promise.resolve();
  constructor(private readonly publish: (snapshot: DesktopSnapshot) => void) {
    this.primary = this.make('primary').service;
  }
  private make(id: string, server?: string): Account {
    const service = new DesktopConnectionService(() => this.changed(), {
      credentials: new CredentialStore(id === 'primary' ? 'connection.secure.json' : `connection-${id}.secure.json`),
      drafts: this.drafts, outbox: this.outbox, cleanupLegacy: id === 'primary',
    });
    const account = { id, server, service }; this.accounts.set(id, account); return account;
  }
  private changed(): void { if (!this.closed) { this.revision++; this.publish(this.snapshot(undefined, false)); } }
  private encode(account: Account, id?: string): string | undefined { return id === undefined ? undefined : account.id === 'primary' ? id : `${account.id}:${id}`; }
  private route(id: string): { account: Account; raw: string } {
    const colon = id.indexOf(':');
    if (colon >= 0) {
      const account = this.accounts.get(id.slice(0, colon));
      if (!account || account.id === 'primary' || !id.slice(colon + 1)) throw new Error('Connection unavailable');
      return { account, raw: id.slice(colon + 1) };
    }
    return { account: this.accounts.get('primary')!, raw: id };
  }
  private current(): Account {
    const account = this.accounts.get(this.active);
    if (account?.service.snapshot().phase === 'connected') return account;
    const available = [...this.accounts.values()].find(a => a.service.snapshot().phase === 'connected');
    return available ?? account ?? this.accounts.get('primary')!;
  }
  private forIdentity(key: string): Account {
    const account = [...this.accounts.values()].find(a => a.service.snapshot().connectionKey === key);
    if (!account) throw new Error('Connection unavailable'); return account;
  }
  hasConnection(key?: string): boolean { return !!key && [...this.accounts.values()].some(a => a.service.snapshot().connectionKey === key); }
  connectionForChannel(id?: string): string | undefined { return (id ? this.route(id).account : this.current()).service.snapshot().connectionKey; }
  threadIdentity(raw: string, channel?: string): string { return this.encode(channel ? this.route(channel).account : this.current(), raw)!; }
  /** Paired, connected servers for the App-side browser control connection. */
  browserAccounts() {
    return [...this.accounts.values()].flatMap(account => {
      const endpoint = account.service.browserEndpoint(); if (!endpoint) return [];
      return [{ ...endpoint, qualify: (raw: string) => this.encode(account, raw)!,
        unqualify: (id: string) => { try { const r = this.route(id); return r.account === account ? r.raw : undefined; } catch { return undefined; } } }];
    });
  }
  private hostName(account: Account, snap = account.service.snapshot(undefined, false)): string | undefined {
    return snap.connectionName ?? (account.server ? new URL(account.server).hostname : undefined);
  }
  private nameOf(account: Account, snap?: DesktopSnapshot): string | undefined { return this.names[account.id] ?? this.hostName(account, snap); }
  private projected(account: Account, thread?: string, pages = true): DesktopSnapshot {
    const snap = account.service.snapshot(thread, pages), name = this.nameOf(account, snap);
    return { ...snap, connectionName: name,
      selectedChannelId: this.encode(account, snap.selectedChannelId), selectedThreadId: this.encode(account, snap.selectedThreadId),
      channels: snap.channels.map(c => ({ ...c, id: this.encode(account, c.id)!, connectionName: name, connectionKey: snap.connectionKey })),
      threads: snap.threads.map(t => ({ ...t, id: this.encode(account, t.id)!, channelId: this.encode(account, t.channelId)!, supportsSessionLabels: snap.supportsSessionLabels })),
      ...(snap.sessionPages ? { sessionPages: snap.sessionPages.map(p => ({ ...p, id: this.encode(account, p.id)! })) } : {}),
    };
  }
  snapshot(thread?: string, pages = true, connectionKey?: string): DesktopSnapshot {
    const route = thread ? this.route(thread) : undefined;
    const account = route?.account ?? (connectionKey ? this.forIdentity(connectionKey) : this.current());
    const selected = this.projected(account, route?.raw, pages);
    const all = [...this.accounts.values()].map(a => this.projected(a, undefined, pages));
    const connections: DesktopConnection[] = [...this.accounts.values()].flatMap(a => {
      const s = a.service.snapshot(undefined, false);
      if (a.id === 'primary' && !s.connectionKey && s.phase !== 'pairing' && !s.errorMessage) return [];
      return [{ id: a.id, connectionKey: s.connectionKey, server: a.server ?? a.service.serverAddress() ?? '', name: this.nameOf(a, s) ?? 'Saved connection',
        defaultName: this.hostName(a, s) ?? 'Saved connection', ...(this.names[a.id] ? { customName: true } : {}),
        state: s.phase === 'pairing' ? 'pairing' as const : s.errorMessage && !s.connectionKey ? 'blocked' as const : s.connectionState,
        ...(a.service.supportsProjectFiles() ? { supportsProjectFiles: true } : {}),
        ...(a.service.supportsPrimaryPath() ? { supportsPrimaryPath: true } : {}),
        ...(s.statusMessage || s.errorMessage ? { detail: s.statusMessage ?? s.errorMessage } : {}) }];
    });
    return { ...selected, revision: this.revision, connections, connectionsError: this.listError,
      supportsSessionLabels: connectionKey || thread ? selected.supportsSessionLabels : all.some(s => s.supportsSessionLabels),
      channels: all.flatMap(s => s.channels), threads: all.flatMap(s => s.threads),
      // A loading/failed account must not invalidate another account's existing tabs.
      loadingConversations: all.some(s => s.loadingConversations),
      ...(pages ? { sessionPages: all.flatMap(s => s.sessionPages ?? []) } : {}),
    };
  }
  async initialize(): Promise<void> {
    await this.primary.initialize();
    this.accounts.get('primary')!.server = this.primary.serverAddress();
    try { this.entries = await this.index.load(); }
    catch { this.listError = 'The saved connection list could not be loaded. Reopen Hermes to try again. Existing connections are unchanged.'; this.changed(); return; }
    for (const entry of this.entries) this.make(entry.id, entry.server);
    // A damaged name file falls back to host names and blocks renaming, so it is never overwritten.
    try { this.names = Object.fromEntries(Object.entries(await this.nameStore.load()).filter(([id]) => this.accounts.has(id))); } catch { this.names = {}; this.namesError = true; }
    this.ready = true; this.changed();
    await Promise.all(this.entries.map(e => this.accounts.get(e.id)!.service.initialize()));
  }
  private change(operation: () => Promise<void>): Promise<void> {
    const result = this.mutation.then(operation); this.mutation = result.catch(() => {}); return result;
  }
  private checked(request: PairingRequest): PairingRequest {
    return { baseUrl: normalizeBaseUrl(request.baseUrl), code: normalizeCode(request.code), deviceName: deviceName(request.deviceName) };
  }
  async addConnection(input: PairingRequest): Promise<void> {
    const request = this.checked(input);
    return this.change(async () => {
      if (!this.ready || this.closed) throw new Error('The saved connection list is unavailable. Reopen Hermes.');
      if (this.snapshot().connections!.some(row => row.server === request.baseUrl)) throw new Error('This server is already saved.');
      if (this.snapshot().connections!.length >= 8) throw new Error('Remove a connection before adding another. This version supports eight connections.');
      const emptyPrimary = !this.primary.snapshot().connectionKey && this.primary.snapshot().phase === 'unpaired' && !this.primary.snapshot().errorMessage;
      if (emptyPrimary) {
        this.accounts.get('primary')!.server = request.baseUrl;
        void this.primary.pair(request); return;
      }
      const id = randomBytes(12).toString('hex');
      const next = [...this.entries, { id, server: request.baseUrl }];
      await this.index.save(next); this.entries = next;
      const account = this.make(id, request.baseUrl); this.changed();
      void account.service.pair(request);
    });
  }
  async removeConnection(id: string): Promise<void> {
    return this.change(async () => {
      if (!this.ready || this.closed) throw new Error('The saved connection list is unavailable. Reopen Hermes.');
      const account = this.accounts.get(id);
      if (!account || !this.snapshot().connections!.some(c => c.id === id)) throw new Error('Connection unavailable');
      // Each service clears only its own encrypted credential, draft and outbox identity.
      await account.service.forgetConnection();
      if (this.names[id] && !this.namesError) {
        // A later pairing in this slot must start with the host name again.
        const { [id]: _removed, ...rest } = this.names;
        await this.nameStore.save(rest); this.names = rest;
      }
      if (id !== 'primary') {
        const next = this.entries.filter(e => e.id !== id);
        await this.index.save(next); this.entries = next; account.service.close(); this.accounts.delete(id);
      } else account.server = undefined;
      if (this.active === id) this.active = this.current().id;
      this.changed();
      if (this.snapshot().connections!.some(c => c.id === id)) throw new Error('Connection removal was not confirmed. Try again.');
    });
  }
  /** Saves this device's name for one connection. An empty name restores the host name. */
  async renameConnection(id: string, value: string): Promise<void> {
    const name = normalizeConnectionName(value);
    return this.change(async () => {
      if (!this.ready || this.closed) throw new Error('The saved connection list is unavailable. Reopen Hermes.');
      if (this.namesError) throw new Error('Saved connection names could not be read. Reopen Hermes to try again.');
      if (!this.snapshot().connections!.some(c => c.id === id)) throw new Error('Connection unavailable');
      const { [id]: _previous, ...rest } = this.names;
      const next = name ? { ...rest, [id]: name } : rest;
      await this.nameStore.save(next); this.names = next;
      this.changed();
    });
  }
  async pair(request: PairingRequest): Promise<void> {
    if (this.snapshot().connections!.length) throw new Error('Use Settings to add another connection.');
    this.accounts.get('primary')!.server = normalizeBaseUrl(request.baseUrl);
    await this.primary.pair(this.checked(request));
  }
  async cancelPairing(): Promise<void> { await this.current().service.cancelPairing(); }
  async forgetConnection(): Promise<void> { await this.removeConnection(this.current().id); }
  async selectChannel(id: string): Promise<void> { const r = this.route(id); this.active = r.account.id; await r.account.service.selectChannel(r.raw); }
  async selectThread(id: string, activate = true): Promise<void> { const r = this.route(id); if (activate) this.active = r.account.id; await r.account.service.selectThread(r.raw, activate); }
  deactivateThread(connectionKey?: string): void { if (connectionKey) this.active = this.forIdentity(connectionKey).id; this.current().service.deactivateThread(); }
  closeSessionPage(id: string): void { const r = this.route(id); r.account.service.closeSessionPage(r.raw); }
  closeSessionPages(): void { for (const a of this.accounts.values()) a.service.closeSessionPages(); }
  async createChannel(connectionKey: string, input: ChannelInput): Promise<string> {
    const account = this.forIdentity(connectionKey);
    if (account.service.snapshot().connectionState !== 'online') throw new Error('The selected connection is unavailable.');
    const id = await account.service.createChannel(input);
    if (this.forIdentity(connectionKey) !== account) throw new Error('Project creation was not confirmed.');
    return this.encode(account, id)!;
  }
  async getProjectWorkspace(id: string) { const r = this.route(id); return r.account.service.getProjectWorkspace(r.raw); }
  async saveProjectAgents(id: string, content: string, previous: string | null) { const r = this.route(id); return r.account.service.saveProjectAgents(r.raw, content, previous); }
  async setProjectFolder(id: string, path: string | null) { const r = this.route(id); return r.account.service.setProjectFolder(r.raw, path); }
  async addProjectFiles(id: string, inputs: readonly AttachmentInput[]) { const r = this.route(id); return r.account.service.addProjectFiles(r.raw, inputs); }
  async getChannelInfo(id: string) { const r = this.route(id), c = await r.account.service.getChannelInfo(r.raw); return { ...c, id, connectionName: this.nameOf(r.account) }; }
  async updateChannel(id: string, input: ChannelInput): Promise<void> { const r = this.route(id); await r.account.service.updateChannel(r.raw, input); }
  async deleteChannel(id: string): Promise<void> { const r = this.route(id); await r.account.service.deleteChannel(r.raw); }
  async archiveChannel(id: string): Promise<void> { const r = this.route(id); await r.account.service.archiveChannel(r.raw); }
  async createThread(input: ThreadInput, activate = true): Promise<string> {
    const r = input.channelId ? this.route(input.channelId) : { account: this.current(), raw: undefined };
    if (activate) this.active = r.account.id;
    return this.encode(r.account, await r.account.service.createThread({ ...input, channelId: r.raw }, activate))!;
  }
  async getModelSettings(key: string) { return this.forIdentity(key).service.getModelSettings(key); }
  async setModelSettings(key: string, provider: string, model: string, confirm: boolean) { return this.forIdentity(key).service.setModelSettings(key, provider, model, confirm); }
  async loadWorkspaceDrafts(): Promise<Record<string, DesktopLocalDraft>> {
    const all = await Promise.all([...this.accounts.values()].filter(a => a.service.snapshot().draftIdentity).map(async a => {
      const drafts = await a.service.loadLocalDrafts(a.service.snapshot().draftIdentity!);
      return Object.fromEntries(Object.entries(drafts).map(([id, draft]) => [this.encode(a, id)!, draft]));
    })); return Object.assign({}, ...all);
  }
  async loadLocalDrafts(identity: string) {
    const a = this.forIdentity(identity), drafts = await a.service.loadLocalDrafts(identity);
    return Object.fromEntries(Object.entries(drafts).map(([id, draft]) => [this.encode(a, id)!, draft]));
  }
  async saveLocalDraft(identity: string, id: string, draft: unknown): Promise<void> {
    const r = this.route(id); if (r.account !== this.forIdentity(identity)) throw new Error('Draft belongs to another connection');
    await r.account.service.saveLocalDraft(identity, r.raw, draft);
  }
  async flushLocalDrafts(): Promise<void> { await this.drafts.flush(); }
  sessionLink(id?: string): string { if (!id) return this.current().service.sessionLink(); const r = this.route(id); return r.account.service.sessionLink(r.raw); }
  openSessionLink(value: string, contextThread?: string): void {
    // A short in-message link belongs to the connection of the Session that shows it.
    const short = relativeSessionThread(value);
    if (short) {
      if (!contextThread) return;
      const r = this.route(contextThread), server = r.account.server ?? r.account.service.serverAddress();
      if (!server) return;
      value = buildSessionLink(server, short);
    }
    const target = parseSessionLink(value);
    const owner = target && [...this.accounts.values()].find(a => { const server = a.server ?? a.service.serverAddress(); return server && sessionServer(server) === target.server; });
    if (owner) this.active = owner.id;
    (owner ?? this.current()).service.openSessionLink(value);
  }
  async renameThread(id: string, title: string): Promise<void> { const r = this.route(id); await r.account.service.renameThread(r.raw, title); }
  async archiveThread(id: string): Promise<void> { const r = this.route(id); await r.account.service.archiveThread(r.raw); }
  async saveThreadLabels(id: string, markers: string[], timestamp: number, key: string) { const r = this.route(id); return r.account.service.saveThreadLabels(r.raw, markers, timestamp, key); }
  async markResultRead(id: string, version: number, ref: number): Promise<void> { const r = this.route(id); await r.account.service.markResultRead(r.raw, version, ref); }
  async loadOlder(id?: string): Promise<void> { if (!id) return; const r = this.route(id); await r.account.service.loadOlder(r.raw); }
  async sendMessage(input: SendMessageInput, id?: string): Promise<void> { if (!id) throw new Error('Choose a conversation'); const r = this.route(id); await r.account.service.sendMessage(input, r.raw); }
  async retryMessage(clientId: string, id?: string): Promise<void> { if (!id) return; const r = this.route(id); await r.account.service.retryMessage(clientId, r.raw); }
  /** Branches, then opens the new Session like a link click on its connection. */
  async branchFromMessage(refSeq: number, id?: string): Promise<{ ok: true } | { ok: false; reason: 'busy' | 'unavailable' | 'failed' }> {
    if (!id) return { ok: false, reason: 'unavailable' };
    const r = this.route(id), result = await r.account.service.branchFromMessage(refSeq, r.raw);
    if (!result.ok) return result;
    this.active = r.account.id;
    r.account.service.openSessionLink(result.link);
    return { ok: true };
  }
  async messageSources(refSeq: number, id?: string) { if (!id) return []; const r = this.route(id); return r.account.service.messageSources(refSeq, r.raw); }
  async exportMessage(text: string, id?: string) { if (!id) return { ok: false as const }; const r = this.route(id); return r.account.service.exportMessage(text, r.raw); }
  async exportConversation(id?: string) { if (!id) return { ok: false as const }; const r = this.route(id); return r.account.service.exportConversation(r.raw); }
  async retryLatest(id?: string): Promise<void> { if (!id) throw new Error('Choose a conversation'); const r = this.route(id); await r.account.service.retryLatest(r.raw); }
  async stopThread(id?: string): Promise<void> { if (!id) return; const r = this.route(id); await r.account.service.stopThread(r.raw); }
  async cancelQueued(receipt: string, id?: string): Promise<void> { if (!id) return; const r = this.route(id); await r.account.service.cancelQueued(receipt, r.raw); }
  async answerInteraction(interaction: string, choice: string, id?: string): Promise<void> { if (!id) return; const r = this.route(id); await r.account.service.answerInteraction(interaction, choice, r.raw); }
  async pickAndUploadAttachments(id?: string) { if (!id) throw new Error('Choose a conversation'); const r = this.route(id); return r.account.service.pickAndUploadAttachments(r.raw); }
  async uploadAttachmentInputs(inputs: readonly AttachmentInput[], id?: string) { if (!id) throw new Error('Choose a conversation'); const r = this.route(id); return r.account.service.uploadAttachmentInputs(inputs, r.raw); }
  async uploadAttachmentPaths(paths: readonly string[], id?: string) { if (!id) throw new Error('Choose a conversation'); const r = this.route(id); return r.account.service.uploadAttachmentPaths(paths, r.raw); }
  async deleteUnattachedAttachment(attachment: string, id?: string): Promise<void> { if (!id) return; const r = this.route(id); await r.account.service.deleteUnattachedAttachment(attachment, r.raw); }
  async attachmentPreview(attachment: string, id: string) { const r = this.route(id); return r.account.service.attachmentPreview(attachment, r.raw); }
  previewResources(id: string) { const r = this.route(id); return r.account.service.previewResources(r.raw); }
  async previewAttachmentImage(attachment: string, id?: string) { if (!id) throw new Error('Choose a conversation'); const r = this.route(id); return r.account.service.previewAttachmentImage(attachment, r.raw); }
  async downloadAttachment(attachment: string, action: 'save' | 'open', id?: string): Promise<void> { if (!id) throw new Error('Choose a conversation'); const r = this.route(id); await r.account.service.downloadAttachment(attachment, action, r.raw); }
  async retryConnection(): Promise<void> { await this.current().service.retryConnection(); }
  async resumeConnection(): Promise<void> { await Promise.all([...this.accounts.values()].map(a => a.service.resumeConnection())); }
  close(): void { this.closed = true; for (const a of this.accounts.values()) a.service.close(); }
}
