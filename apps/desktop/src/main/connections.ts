import { randomBytes } from 'node:crypto';
import type { ChannelInput, DesktopAutomation, DesktopAutomationList, DesktopAutomationPage, DesktopConnection, DesktopFileHit, DesktopFileSearch, DesktopMessageHit, DesktopMessageSearch, DesktopSessionFile, DesktopSessionFilePage, DesktopLocalDraft, DesktopSnapshot, PairingRequest, SendMessageInput, StartThreadInput, ThreadCreation, ThreadInput } from '../shared/desktop-api';
import type { Automation } from '../../../../packages/client/src/automations';
import type { SessionFile } from '../../../../packages/client/src/sessionFiles';
import type { AttachmentInput } from '../shared/attachment-input';
import { buildSessionLink, parseSessionLink, relativeSessionThread, sessionServer } from '../../../../packages/client/src/sessionLinks';
import { DesktopConnectionService, deviceName, normalizeCode } from './connection-service';
import { CredentialStore } from './credential-store';
import { ConnectionIndex, ConnectionNames, normalizeConnectionName, type ConnectionEntry } from './connection-index';
import { LocalDraftStore } from './local-draft-store';
import { OutboxStore } from './outbox-store';
import { normalizeBaseUrl } from './transport';
import type { DesktopVaultAnswer, DesktopVaultAnswerResult } from "../shared/desktop-api";
import type { NewVaultItem, ProfileFileKind, VaultItemChange } from "@hermes-app/client";

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
    if (account?.service.status().phase === 'connected') return account;
    const available = [...this.accounts.values()].find(a => a.service.status().phase === 'connected');
    return available ?? account ?? this.accounts.get('primary')!;
  }
  private forIdentity(key: string): Account {
    const account = [...this.accounts.values()].find(a => a.service.status().connectionKey === key);
    if (!account) throw new Error('Connection unavailable'); return account;
  }
  hasConnection(key?: string): boolean { return !!key && [...this.accounts.values()].some(a => a.service.status().connectionKey === key); }
  connectionForChannel(id?: string): string | undefined { return (id ? this.route(id).account : this.current()).service.status().connectionKey; }
  threadIdentity(raw: string, channel?: string): string { return this.encode(channel ? this.route(channel).account : this.current(), raw)!; }
  /** The remote screen name of a connected server, if it has one. */
  remoteScreenName(connectionKey: string): string | undefined {
    return [...this.accounts.values()].find(a => a.service.status().connectionKey === connectionKey)?.service.remoteScreenName();
  }
  /** Address and credential for a connection's remote screen; stays in the main process. */
  remoteScreenEndpoint(connectionKey: string): { baseUrl: string; token: string } | undefined {
    const account = [...this.accounts.values()].find(a => a.service.status().connectionKey === connectionKey);
    const endpoint = account?.service.remoteScreenName() ? account.service.browserEndpoint() : undefined;
    return endpoint ? { baseUrl: endpoint.baseUrl, token: endpoint.token } : undefined;
  }
  /** Paired, connected servers for the App-side browser control connection. */
  browserAccounts() {
    return [...this.accounts.values()].flatMap(account => {
      const endpoint = account.service.browserEndpoint(); if (!endpoint) return [];
      return [{ ...endpoint, qualify: (raw: string) => this.encode(account, raw)!,
        unqualify: (id: string) => { try { const r = this.route(id); return r.account === account ? r.raw : undefined; } catch { return undefined; } } }];
    });
  }
  private hostName(account: Account, snap: { connectionName?: string } = account.service.status()): string | undefined {
    return snap.connectionName ?? (account.server ? new URL(account.server).hostname : undefined);
  }
  private nameOf(account: Account, snap?: { connectionName?: string }): string | undefined { return this.names[account.id] ?? this.hostName(account, snap); }
  private projected(account: Account, thread?: string | null, pages = true): DesktopSnapshot {
    const snap = account.service.snapshot(thread, pages), name = this.nameOf(account, snap);
    return { ...snap, connectionName: name,
      selectedChannelId: this.encode(account, snap.selectedChannelId), selectedThreadId: this.encode(account, snap.selectedThreadId),
      channels: snap.channels.map(c => ({ ...c, id: this.encode(account, c.id)!, connectionName: name, connectionKey: snap.connectionKey, supportsThreadModel: snap.supportsThreadModel,
        supportsAutomationEditors: snap.supportsAutomationEditors })),
      threads: snap.threads.map(t => ({ ...t, id: this.encode(account, t.id)!, channelId: this.encode(account, t.channelId)!, supportsSessionLabels: snap.supportsSessionLabels })),
      ...(snap.sessionPages ? { sessionPages: snap.sessionPages.map(p => ({ ...p, id: this.encode(account, p.id)! })) } : {}),
    };
  }
  snapshot(thread?: string, pages = true, connectionKey?: string): DesktopSnapshot {
    const route = thread ? this.route(thread) : undefined;
    const account = route?.account ?? (connectionKey ? this.forIdentity(connectionKey) : this.current());
    const selected = this.projected(account, route?.raw, pages);
    // Only catalogue fields are read from these; `null` skips each account's selected Session messages.
    const all = [...this.accounts.values()].map(a => this.projected(a, null, pages));
    const connections: DesktopConnection[] = [...this.accounts.values()].flatMap(a => {
      const s = a.service.status();
      if (a.id === 'primary' && !s.connectionKey && s.phase !== 'pairing' && !s.errorMessage) return [];
      return [{ id: a.id, connectionKey: s.connectionKey, server: a.server ?? a.service.serverAddress() ?? '', name: this.nameOf(a, s) ?? 'Saved connection',
        defaultName: this.hostName(a, s) ?? 'Saved connection', ...(this.names[a.id] ? { customName: true } : {}),
        state: s.phase === 'pairing' ? 'pairing' as const : s.errorMessage && !s.connectionKey ? 'blocked' as const : s.connectionState,
        ...(a.service.supportsProjectFiles() ? { supportsProjectFiles: true } : {}),
        ...(a.service.supportsPrimaryPath() ? { supportsPrimaryPath: true } : {}),
        ...(a.service.supportsChannelArchive() ? { supportsChannelArchive: true } : {}),
        ...(a.service.remoteScreenName() ? { remoteScreen: { name: a.service.remoteScreenName()! } } : {}),
        ...(s.statusMessage || s.errorMessage ? { detail: s.statusMessage ?? s.errorMessage } : {}) }];
    });
    return { ...selected, revision: this.revision, connections, connectionsError: this.listError,
      supportsSessionLabels: connectionKey || thread ? selected.supportsSessionLabels : all.some(s => s.supportsSessionLabels),
      // File search covers every connection, also from a Session tab.
      supportsFileSearch: all.some(s => s.supportsFileSearch),
      supportsSessionSearch: all.some(s => s.supportsSessionSearch),
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
      const primary = this.primary.status(), emptyPrimary = !primary.connectionKey && primary.phase === 'unpaired' && !primary.errorMessage;
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
    if (account.service.status().connectionState !== 'online') throw new Error('The selected connection is unavailable.');
    const id = await account.service.createChannel(input);
    if (this.forIdentity(connectionKey) !== account) throw new Error('Project creation was not confirmed.');
    return this.encode(account, id)!;
  }
  async getProjectWorkspace(id: string) { const r = this.route(id); return r.account.service.getProjectWorkspace(r.raw); }
  async saveProjectAgents(id: string, content: string, previous: string | null) { const r = this.route(id); return r.account.service.saveProjectAgents(r.raw, content, previous); }
  async setProjectFolder(id: string, path: string | null) { const r = this.route(id); return r.account.service.setProjectFolder(r.raw, path); }
  async getChannelInfo(id: string) { const r = this.route(id), c = await r.account.service.getChannelInfo(r.raw); return { ...c, id, connectionName: this.nameOf(r.account) }; }
  /** The connection that owns a qualified Automation ID. */
  connectionForAutomation(id: string): string | undefined { return this.route(id).account.service.status().connectionKey; }
  private qualifyAutomation(account: Account, job: Automation): DesktopAutomation {
    const snap = account.service.status();
    return { ...job, id: this.encode(account, job.id)!, connectionKey: snap.connectionKey, connectionName: this.nameOf(account, snap),
      targets: job.targets.map(t => ({ ...t, channelId: this.encode(account, t.channelId)!, ...(t.threadId ? { threadId: this.encode(account, t.threadId)! } : {}) })),
      ...(job.editorChannelId ? { editorChannelId: this.encode(account, job.editorChannelId)! } : {}),
      ...(job.editorThreadId ? { editorThreadId: this.encode(account, job.editorThreadId)! } : {}) };
  }
  /**
   * Jobs of every connected server that offers Automations: running first, then latest run, then name.
   * A paging server returns its first page and a cursor; `cursors` (keyed by connection) asks only
   * those connections for their next page. Older servers return every job at once.
   */
  async automations(cursors?: Readonly<Record<string, string>>): Promise<DesktopAutomationList> {
    const connected = [...this.accounts.values()].filter(a => a.service.status().phase === 'connected' && a.service.supportsAutomations());
    const accounts = cursors ? connected.filter(a => cursors[a.id] !== undefined && a.service.supportsAutomationsPaged()) : connected;
    const failed: string[] = [], next: Record<string, string> = {};
    const rows = (await Promise.all(accounts.map(async account => {
      try {
        if (!account.service.supportsAutomationsPaged()) return (await account.service.automations()).map(job => this.qualifyAutomation(account, job));
        const page = await account.service.automationsPage(cursors?.[account.id]);
        if (page.nextAfter) next[account.id] = page.nextAfter;
        return page.automations.map(job => this.qualifyAutomation(account, job));
      } catch { failed.push(this.nameOf(account) ?? 'Saved connection'); return []; }
    }))).flat();
    rows.sort((a, b) => Number(b.running) - Number(a.running) || (b.lastRunAt ?? '').localeCompare(a.lastRunAt ?? '') || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return { supported: connected.length > 0, automations: rows, failed, cursors: next,
      canCreate: connected.some(a => a.service.supportsAutomationEditors()) };
  }
  private sessionFile(account: Account, file: SessionFile): DesktopSessionFile {
    return { id: file.id, threadId: this.encode(account, file.thread_id)!, name: file.name ?? 'File', mime: file.mime ?? 'application/octet-stream',
      size: file.size ?? 0, state: file.state === 'available' ? 'available' : 'missing', list: file.list, createdAt: file.created_at,
      ...(file.caption ? { caption: file.caption } : {}), ...(file.ref_seq !== null ? { refSeq: file.ref_seq } : {}) };
  }
  /** One page of a qualified Session's files. `supported: false` on a server without Session files. */
  async sessionFiles(id: string, list: 'delivered' | 'uploaded', after?: string): Promise<DesktopSessionFilePage> {
    const r = this.route(id), page = await r.account.service.sessionFiles(r.raw, list, after);
    if (!page) return { supported: false, items: [], nextAfter: null };
    return { supported: true, items: page.items.map(file => this.sessionFile(r.account, file)), nextAfter: page.nextAfter };
  }
  async prepareSessionFile(id: string, attachmentId: string): Promise<void> { const r = this.route(id); await r.account.service.prepareAttachment(r.raw, attachmentId); }
  /** Search result: opens the Session on its own connection and shows the message with the file. */
  async openMessage(id: string, refSeq: number): Promise<void> { const r = this.route(id); this.active = r.account.id; await r.account.service.openMessage(r.raw, refSeq); }
  /** Search result: opens or saves a file of any Session on its own connection, without opening the Session. */
  async openSessionFile(id: string, attachmentId: string, action: 'save' | 'open'): Promise<void> { const r = this.route(id); await r.account.service.openSessionFile(r.raw, attachmentId, action); }
  /**
   * Files of every connected server that offers file search, newest first. `cursors` (keyed by
   * connection) asks only those connections for their next page.
   */
  async searchFiles(query: string, labels: readonly string[], cursors?: Readonly<Record<string, string>>): Promise<DesktopFileSearch> {
    const connected = [...this.accounts.values()].filter(a => a.service.status().phase === 'connected' && a.service.supportsFileSearch());
    const accounts = cursors ? connected.filter(a => cursors[a.id] !== undefined) : connected;
    const failed: string[] = [], next: Record<string, string> = {};
    const rows = (await Promise.all(accounts.map(async account => {
      try {
        const page = await account.service.searchFiles(query, labels, cursors?.[account.id]);
        if (page.nextAfter) next[account.id] = page.nextAfter;
        const name = connected.length > 1 ? this.nameOf(account) : undefined;
        return page.items.map((hit): DesktopFileHit => ({ ...this.sessionFile(account, hit), threadTitle: hit.thread_title,
          channelId: this.encode(account, hit.channel_id)!, ...(hit.channel_name ? { channelName: hit.channel_name } : {}), ...(name ? { connectionName: name } : {}),
          ...(hit.rank !== undefined ? { rank: hit.rank } : {}) }));
      } catch { failed.push(this.nameOf(account) ?? 'Saved connection'); return []; }
    }))).flat();
    // Ranked results (semantic search) first by rank, interleaving connections; then the newest.
    rows.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || b.createdAt - a.createdAt || b.id.localeCompare(a.id));
    return { supported: connected.length > 0, items: rows, failed, cursors: next };
  }
  /**
   * Sessions whose messages match, from every connected server that searches message text, merged
   * by rank. With `refine`, servers that offer it return their model-picked order; the others keep
   * their keyword-and-meaning order. `none` only when every refined server found no fit.
   */
  async searchMessages(query: string, labels: readonly string[], refine = false): Promise<DesktopMessageSearch> {
    const connected = [...this.accounts.values()].filter(a => a.service.status().phase === 'connected' && a.service.supportsSessionSearch());
    const failed: string[] = [];
    let indexing = false, refined = false, none = connected.length > 0;
    const pages = await Promise.all(connected.map(async account => {
      try {
        const ai = refine && account.service.supportsSessionSearchRefine();
        const page = ai ? await account.service.refineMessages(query, labels) : await account.service.searchMessages(query, labels);
        if ('ready' in page && page.available && !page.ready) indexing = true;
        if (ai && page.available) refined = true;
        if (!(ai && 'none' in page && page.none)) none = false;
        if (!page.available) { failed.push(this.nameOf(account) ?? 'Saved connection'); return []; }
        const name = connected.length > 1 ? this.nameOf(account) : undefined;
        return page.items.map((hit): DesktopMessageHit => ({ threadId: this.encode(account, hit.thread_id)!, title: hit.title,
          channelId: this.encode(account, hit.channel_id)!, channelName: hit.channel_name, ...(name ? { connectionName: name } : {}),
          markers: hit.markers, ...(hit.seq !== null ? { refSeq: hit.seq } : {}), snippet: hit.snippet, rank: hit.rank }));
      } catch { failed.push(this.nameOf(account) ?? 'Saved connection'); none = false; return []; }
    }));
    const items = pages.flat().sort((a, b) => a.rank - b.rank);
    return { supported: connected.length > 0, items, failed, indexing, refined, none: refined && none && !items.length };
  }
  /** Pause, Resume, Run now or a new schedule for one qualified job. */
  async controlAutomation(id: string, control: 'pause' | 'resume' | 'run' | 'schedule', schedule?: string): Promise<DesktopAutomation> {
    const r = this.route(id);
    return this.qualifyAutomation(r.account, await r.account.service.controlAutomation(r.raw, control, schedule));
  }
  /** Delete one qualified job; its conversations stay. */
  async deleteAutomation(id: string): Promise<void> {
    const r = this.route(id);
    await r.account.service.deleteAutomation(r.raw);
  }
  /** The qualified Session ID of the job's settings conversation. */
  async automationEditor(id: string): Promise<string> {
    const r = this.route(id);
    return this.encode(r.account, await r.account.service.automationEditor(r.raw))!;
  }
  async automation(id: string, before?: number): Promise<DesktopAutomationPage> {
    const r = this.route(id);
    if (!r.account.service.supportsAutomations()) return { state: 'unsupported' };
    const page = await r.account.service.automation(r.raw, before);
    if (!page) return { state: 'missing' };
    return { state: 'ok', automation: this.qualifyAutomation(r.account, page.automation), nextBefore: page.nextBefore,
      threads: page.threads.map(t => ({ ...t, id: this.encode(r.account, t.id)!, channelId: this.encode(r.account, t.channelId)! })) };
  }
  async updateChannel(id: string, input: ChannelInput): Promise<void> { const r = this.route(id); await r.account.service.updateChannel(r.raw, input); }
  async deleteChannel(id: string): Promise<void> { const r = this.route(id); await r.account.service.deleteChannel(r.raw); }
  async archiveChannel(id: string): Promise<void> { const r = this.route(id); await r.account.service.archiveChannel(r.raw); }
  async createThread(input: ThreadInput, activate = true): Promise<ThreadCreation> {
    const r = input.channelId ? this.route(input.channelId) : { account: this.current(), raw: undefined };
    if (activate) this.active = r.account.id;
    const result = await r.account.service.createThread({ ...input, channelId: r.raw }, activate);
    return typeof result === 'string' ? this.encode(r.account, result)! : result;
  }
  async startThread(input: StartThreadInput): Promise<string> {
    const r = input.channelId ? this.route(input.channelId) : { account: this.current(), raw: undefined };
    return this.encode(r.account, await r.account.service.startThread({ ...input, channelId: r.raw }))!;
  }
  async getModelSettings(key: string) { return this.forIdentity(key).service.getModelSettings(key); }
  async getVaultItems(key: string) { return this.forIdentity(key).service.getVaultItems(key); }
  async addVaultItem(key: string, item: NewVaultItem) { return this.forIdentity(key).service.addVaultItem(key, item); }
  async removeVaultItem(key: string, id: string) { return this.forIdentity(key).service.removeVaultItem(key, id); }
  async updateVaultItem(key: string, id: string, change: VaultItemChange) { return this.forIdentity(key).service.updateVaultItem(key, id, change); }
  async importVaultCsv(key: string, path: string) { return this.forIdentity(key).service.importVaultCsv(key, path); }
  async getMemberIdentity(key: string) { return this.forIdentity(key).service.getMemberIdentity(key); }
  async getEnvKeys(key: string) { return this.forIdentity(key).service.getEnvKeys(key); }
  async setEnvKey(key: string, name: string, value: string) { return this.forIdentity(key).service.setEnvKey(key, name, value); }
  async removeEnvKey(key: string, name: string) { return this.forIdentity(key).service.removeEnvKey(key, name); }
  async getProfileFiles(key: string) { return this.forIdentity(key).service.getProfileFiles(key); }
  async saveProfileFile(key: string, kind: ProfileFileKind, content: string, version: string, limit?: number) { return this.forIdentity(key).service.saveProfileFile(key, kind, content, version, limit); }
  async setModelSettings(key: string, provider: string, model: string, confirm: boolean) { return this.forIdentity(key).service.setModelSettings(key, provider, model, confirm); }
  async loadWorkspaceDrafts(): Promise<Record<string, DesktopLocalDraft>> {
    const all = await Promise.all([...this.accounts.values()].filter(a => a.service.status().connectionKey).map(async a => {
      const drafts = await a.service.loadLocalDrafts(a.service.status().connectionKey!);
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
  /** Graceful shutdown, first part, for every connection at once. See DesktopConnectionService.prepareShutdown. */
  async prepareShutdown(timeoutMs: number): Promise<{ sendsSettled: boolean }> {
    const results = await Promise.all([...this.accounts.values()].map(a => a.service.prepareShutdown(timeoutMs)));
    await Promise.all([this.drafts.flush(), this.outbox.flush()]);
    return { sendsSettled: results.every(r => r.sendsSettled) };
  }
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
  async threadUsage(id: string) { const r = this.route(id); return r.account.service.threadUsage(r.raw); }
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
  async answerVaultPrompt(prompt: string, answer: DesktopVaultAnswer, id?: string): Promise<DesktopVaultAnswerResult> { if (!id) return 'failed'; const r = this.route(id); return r.account.service.answerVaultPrompt(prompt, answer, r.raw); }
  async answerInteraction(interaction: string, choice: string, id?: string): Promise<void> { if (!id) return; const r = this.route(id); await r.account.service.answerInteraction(interaction, choice, r.raw); }
  async pickAndUploadAttachments(id?: string) { if (!id) throw new Error('Choose a conversation'); const r = this.route(id); return r.account.service.pickAndUploadAttachments(r.raw); }
  async uploadAttachmentInputs(inputs: readonly AttachmentInput[], id?: string) { if (!id) throw new Error('Choose a conversation'); const r = this.route(id); return r.account.service.uploadAttachmentInputs(inputs, r.raw); }
  async uploadAttachmentPaths(paths: readonly string[], id?: string) { if (!id) throw new Error('Choose a conversation'); const r = this.route(id); return r.account.service.uploadAttachmentPaths(paths, r.raw); }
  async deleteUnattachedAttachment(attachment: string, id?: string): Promise<void> { if (!id) return; const r = this.route(id); await r.account.service.deleteUnattachedAttachment(attachment, r.raw); }
  async attachmentPreview(attachment: string, id: string) { const r = this.route(id); return r.account.service.attachmentPreview(attachment, r.raw); }
  attachmentPage(attachment: string, id: string) { const r = this.route(id); return r.account.service.attachmentPage(attachment, r.raw); }
  previewItems(id: string, ids: readonly string[]) { const r = this.route(id); return r.account.service.previewItems(r.raw, ids); }
  previewResources(id: string) { const r = this.route(id); return r.account.service.previewResources(r.raw); }
  async previewAttachmentImage(attachment: string, id?: string) { if (!id) throw new Error('Choose a conversation'); const r = this.route(id); return r.account.service.previewAttachmentImage(attachment, r.raw); }
  async downloadAttachment(attachment: string, action: 'save' | 'open', id?: string, onProgress?: (received: number, total: number | undefined) => void): Promise<void> { if (!id) throw new Error('Choose a conversation'); const r = this.route(id); await r.account.service.downloadAttachment(attachment, action, r.raw, onProgress); }
  async retryConnection(): Promise<void> { await this.current().service.retryConnection(); }
  dismissError(id?: string): void { (id ? this.route(id).account : this.current()).service.dismissError(); }
  async resumeConnection(): Promise<void> { await Promise.all([...this.accounts.values()].map(a => a.service.resumeConnection())); }
  close(): void { this.closed = true; for (const a of this.accounts.values()) a.service.close(); }
}
