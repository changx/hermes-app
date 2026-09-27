import type { HermesClient, Message, Receipt } from '../../../packages/client/src/index';
import { accepted, restoreSend, validSendContent, type Connection, type SendRecord } from './send.ts';

export interface KeyValueStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}
export const LEGACY_SEND_KEY = 'hermes-app-last-send-v1';
const SLOTS = 24;
const CHUNK_BYTES = 768;
const MAX_BYTES = 65536;
// A code point may leave up to three bytes unused at a chunk boundary.
const MAX_CHUNKS = Math.ceil(MAX_BYTES / (CHUNK_BYTES - 3));
const FINAL = new Set(['completed', 'failed', 'interrupted', 'received']);
const receiptStage = (state?: Receipt['state']) => state === 'queued' ? 0 : state === 'running' ? 1 : state ? 2 : -1;
const callbackChanged = (record: SendRecord, receipt: Receipt) => receipt.processing !== undefined &&
  receipt.processing !== record.receiptProcessing &&
  !['completed', 'failed', 'interrupted'].includes(record.receiptProcessing ?? '');
const feedbackChanged = (record: SendRecord, receipt: Receipt) => receipt.feedback !== undefined && receipt.feedback !== record.receiptFeedback;
export class OutboxLimitError extends Error {}
export class OutboxIdentityError extends Error {}

type Stored = Omit<SendRecord, 'text' | 'attachments' | 'status'> & { version: 2 | 3; status: SendRecord['status'] | 'preparing' | 'discarding'; chunks: number; hash: number; order: number; attempts: number; nextAttemptAt: number };
type Entry = { slot: number; order: number; version: 2 | 3; record: SendRecord; attempts: number; nextAttemptAt: number };
// SecureStore permits only [A-Za-z0-9._-]. Connection IDs are UUIDs today;
// encode the full identity so even an unexpected future ID cannot break keys.
const safeId = (id: string) => Array.from(id, c => c.codePointAt(0)!.toString(16).padStart(6, '0')).join('');
const prefix = (id: string, slot: number) => `hermes-outbox-v2.${safeId(id)}.${slot}`;
const bytes = (part: string) => {
  let n = 0;
  for (const c of part) { const x = c.codePointAt(0)!; n += x <= 0x7f ? 1 : x <= 0x7ff ? 2 : x <= 0xffff ? 3 : 4; }
  return n;
};
function pieces(text: string): string[] {
  if (bytes(text) > MAX_BYTES) throw new OutboxLimitError('消息超过本机安全保存上限（64 KiB），请拆分发送');
  const result: string[] = []; let part = '', length = 0;
  for (const c of text) {
    const size = bytes(c);
    if (length + size > CHUNK_BYTES) { result.push(part); part = ''; length = 0; }
    part += c; length += size;
  }
  if (part) result.push(part);
  return result;
}
function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
const validState = (s: unknown) => ['queued', 'sending', 'ambiguous', 'accepted', 'blocked'].includes(String(s));
const payload = (record: SendRecord) => JSON.stringify({ text: record.text, attachments: record.attachments ?? [] });
const copy = (record: SendRecord): SendRecord => ({ ...record, ...(record.attachments ? { attachments: record.attachments.map(a => ({ ...a })) } : {}) });
const sameAttachments = (a: SendRecord, b: SendRecord) => JSON.stringify(a.attachments ?? []) === JSON.stringify(b.attachments ?? []);

/** Fixed slots avoid a fragile shared index; a record is committed only by its small metadata key. */
export class OutboxStore {
  private entries = new Map<string, Entry>();
  private lock: Promise<unknown> = Promise.resolve();
  private store: KeyValueStore;
  private config: Connection;
  constructor(store: KeyValueStore, config: Connection) { this.store = store; this.config = config; }
  get connectionId() { return this.config.id; }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.lock.then(work);
    this.lock = result.catch(() => {});
    return result;
  }
  get records(): SendRecord[] { return [...this.entries.values()].sort((a, b) => a.order - b.order).map(e => copy(e.record)); }
  async idle() { await this.lock; }
  async load(): Promise<SendRecord[]> {
    return this.serialize(async () => {
      this.entries.clear();
      for (let slot = 0; slot < SLOTS; slot++) {
        const key = prefix(this.config.id, slot), raw = await this.store.getItemAsync(key);
        if (!raw) continue;
        let meta: Stored;
        try { meta = JSON.parse(raw) as Stored; } catch { throw new Error(`本机待发记录 ${slot + 1} 损坏，请保留应用数据并联系支持`); }
        if ((meta.version === 2 || meta.version === 3) && (meta.status === 'preparing' || meta.status === 'discarding') && Number.isInteger(meta.chunks) && meta.chunks > 0 && meta.chunks <= MAX_CHUNKS) {
          for (let i = 0; i < meta.chunks; i++) await this.store.deleteItemAsync(`${key}.part.${i}`);
          await this.store.deleteItemAsync(key);
          continue;
        }
        if ((meta.version !== 2 && meta.version !== 3) || meta.connectionId !== this.config.id || !validState(meta.status) ||
            'attachments' in meta || 'text' in meta ||
            !Number.isInteger(meta.chunks) || meta.chunks < 1 || meta.chunks > MAX_CHUNKS || !Number.isInteger(meta.hash) ||
            !Number.isSafeInteger(meta.order) || meta.order < 1 || [...this.entries.values()].some(e => e.order === meta.order))
          throw new Error(`本机待发记录 ${slot + 1} 损坏，请保留应用数据并联系支持`);
        const chunks: string[] = [];
        for (let i = 0; i < meta.chunks; i++) {
          const chunk = await this.store.getItemAsync(`${key}.part.${i}`);
          if (chunk === null || bytes(chunk) > CHUNK_BYTES) throw new Error(`本机待发消息 ${slot + 1} 不完整，请保留应用数据并联系支持`);
          chunks.push(chunk);
        }
        const data = chunks.join('');
        if (hash(data) !== meta.hash || bytes(data) > MAX_BYTES) throw new Error(`本机待发消息 ${slot + 1} 不完整，请保留应用数据并联系支持`);
        let text: string, attachments: SendRecord['attachments'];
        if (meta.version === 2) { text = data; attachments = undefined; }
        else {
          let decoded: unknown;
          try { decoded = JSON.parse(data); } catch { throw new Error(`本机待发消息 ${slot + 1} 不完整，请保留应用数据并联系支持`); }
          if (!decoded || typeof decoded !== 'object' || !Array.isArray((decoded as { attachments?: unknown }).attachments))
            throw new Error(`本机待发消息 ${slot + 1} 不完整，请保留应用数据并联系支持`);
          text = (decoded as { text: string }).text;
          attachments = (decoded as { attachments: SendRecord['attachments'] }).attachments;
        }
        const restored = restoreSend(JSON.stringify({
          connectionId: meta.connectionId, threadId: meta.threadId, clientMessageId: meta.clientMessageId,
          status: meta.status, receiptId: meta.receiptId, receiptState: meta.receiptState, receiptAdmission: meta.receiptAdmission, receiptHandedOff: meta.receiptHandedOff, receiptProcessing: meta.receiptProcessing, receiptFeedback: meta.receiptFeedback, text, attachments
        }), this.config);
        if (!restored || this.entries.has(restored.clientMessageId)) throw new Error('本机待发记录身份冲突');
        this.entries.set(restored.clientMessageId, { slot, order: meta.order, version: meta.version, record: restored, attempts: meta.attempts || 0, nextAttemptAt: meta.nextAttemptAt || 0 });
      }
      const legacy = await this.store.getItemAsync(LEGACY_SEND_KEY);
      if (legacy) {
        const prior = restoreSend(legacy, this.config);
        if (prior && !this.entries.has(prior.clientMessageId)) await this.insert(prior);
        // Delete only after the new durable commit; leave foreign-identity legacy records untouched.
        if (prior) await this.store.deleteItemAsync(LEGACY_SEND_KEY);
      }
      return this.records;
    });
  }
  private async insert(record: SendRecord): Promise<void> {
    if (record.connectionId !== this.config.id || this.entries.has(record.clientMessageId)) throw new OutboxIdentityError('待发消息身份冲突');
    const occupied = new Set([...this.entries.values()].map(e => e.slot));
    const slot = Array.from({ length: SLOTS }, (_, n) => n).find(n => !occupied.has(n));
    if (slot === undefined) throw new OutboxLimitError('本机待发消息已满（24 条）；请等待自动恢复后再发送');
    const verified = validSendContent(record.threadId, record.text, record.attachments);
    const saved = copy({ ...record, ...(verified.length ? { attachments: verified } : { attachments: undefined }) });
    // Keep the v2 text-only layout and its full 64 KiB budget; v3 stores
    // attachment descriptors beside text in chunked data, never in metadata.
    const version = verified.length ? 3 : 2;
    const data = version === 2 ? saved.text : payload(saved);
    const key = prefix(this.config.id, slot), parts = pieces(data);
    const order = Math.max(0, ...[...this.entries.values()].map(e => e.order)) + 1;
    if (!Number.isSafeInteger(order)) throw new OutboxLimitError('本机待发顺序已达上限');
    // A preparatory marker makes interrupted chunk writes discoverable for cleanup;
    // only the final metadata value commits a send before network I/O.
    await this.store.setItemAsync(key, JSON.stringify({ version, status: 'preparing', chunks: parts.length }));
    for (let i = 0; i < parts.length; i++) await this.store.setItemAsync(`${key}.part.${i}`, parts[i]);
    const meta: Stored = { connectionId: saved.connectionId, threadId: saved.threadId, clientMessageId: saved.clientMessageId,
      status: saved.status, receiptId: saved.receiptId, receiptState: saved.receiptState, receiptAdmission: saved.receiptAdmission, receiptHandedOff: saved.receiptHandedOff, receiptProcessing: saved.receiptProcessing, receiptFeedback: saved.receiptFeedback,
      version, chunks: parts.length, hash: hash(data), order, attempts: 0, nextAttemptAt: 0 };
    await this.store.setItemAsync(key, JSON.stringify(meta));
    this.entries.set(record.clientMessageId, { slot, order, version, record: saved, attempts: 0, nextAttemptAt: 0 });
  }
  async enqueue(record: SendRecord): Promise<void> { return this.serialize(() => this.insert(record)); }
  async update(record: SendRecord, attempts?: number, nextAttemptAt?: number): Promise<void> {
    return this.serialize(async () => {
      const entry = this.entries.get(record.clientMessageId);
      if (!entry || entry.record.text !== record.text || entry.record.threadId !== record.threadId ||
          !sameAttachments(entry.record, record) || record.connectionId !== this.config.id)
        throw new Error('待发消息身份或原文变化');
      const data = entry.version === 2 ? entry.record.text : payload(entry.record);
      const meta: Stored = { connectionId: record.connectionId, threadId: record.threadId, clientMessageId: record.clientMessageId,
        status: record.status, receiptId: record.receiptId, receiptState: record.receiptState, receiptAdmission: record.receiptAdmission, receiptHandedOff: record.receiptHandedOff, receiptProcessing: record.receiptProcessing, receiptFeedback: record.receiptFeedback,
        version: entry.version, chunks: pieces(data).length, hash: hash(data), order: entry.order,
        attempts: attempts ?? entry.attempts, nextAttemptAt: nextAttemptAt ?? entry.nextAttemptAt };
      await this.store.setItemAsync(prefix(this.config.id, entry.slot), JSON.stringify(meta));
      this.entries.set(record.clientMessageId, { ...entry, record: copy(record), attempts: meta.attempts, nextAttemptAt: meta.nextAttemptAt });
    });
  }
  async removeConfirmed(id: string): Promise<void> {
    return this.serialize(async () => {
      const entry = this.entries.get(id);
      if (!entry || entry.record.status !== 'accepted' || !FINAL.has(entry.record.receiptState || '')) return;
      const key = prefix(this.config.id, entry.slot), count = pieces(entry.version === 2 ? entry.record.text : payload(entry.record)).length;
      await this.store.setItemAsync(key, JSON.stringify({ version: entry.version, status: 'discarding', chunks: count }));
      for (let i = 0; i < count; i++) await this.store.deleteItemAsync(`${key}.part.${i}`);
      await this.store.deleteItemAsync(key);
      this.entries.delete(id);
    });
  }
  async clear(): Promise<void> {
    return this.serialize(async () => {
      for (let slot = 0; slot < SLOTS; slot++) {
        const key = prefix(this.config.id, slot), raw = await this.store.getItemAsync(key);
        if (!raw) continue;
        const meta = JSON.parse(raw) as Stored;
        await this.store.setItemAsync(key, JSON.stringify({ version: meta.version, status: 'discarding', chunks: meta.chunks }));
        for (let i = 0; i < meta.chunks; i++) await this.store.deleteItemAsync(`${key}.part.${i}`);
        await this.store.deleteItemAsync(key);
      }
      this.entries.clear();
      const legacy = await this.store.getItemAsync(LEGACY_SEND_KEY);
      if (legacy && restoreSend(legacy, this.config)) await this.store.deleteItemAsync(LEGACY_SEND_KEY);
    });
  }
  entry(id: string): Entry | undefined { return this.entries.get(id); }
}

export type NetworkState = 'connecting' | 'syncing' | 'online' | 'retrying' | 'suspended' | 'blocked';
export type OutboxDeps = Pick<HermesClient, 'send' | 'getReceipt' | 'historyTail' | 'messages' | 'receipts' | 'supportsLatest'>;
export function retryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as Error & { status?: number }).status;
  if (typeof status === 'number') return status === 408 || status === 425 || status === 429 || status >= 500;
  if (error.name === 'ProtocolError' || error.name === 'ResyncRequired' || error.name === 'AbortError') return false;
  return error instanceof TypeError || /network request failed|failed to fetch|timeout|timed out|socket|offline/i.test(error.message);
}
export function delayFor(attempt: number, error: unknown, random = Math.random): number {
  const after = (error as { retryAfterMs?: number } | null)?.retryAfterMs;
  const backoff = Math.min(30000, 500 * 2 ** Math.min(attempt - 1, 6));
  return Math.max(typeof after === 'number' && Number.isFinite(after) ? Math.max(0, after) : 0, backoff * (0.75 + random() * 0.5));
}
export class MobileOutbox {
  private alive = true;
  private online = false;
  private storageFault = false;
  private busy = new Set<string>();
  private controllers = new Map<string, AbortController>();
  private checkedAt = new Map<string, number>();
  private cleanupRetryAt = new Map<string, number>();
  private cleanupNoticed = new Set<string>();
  private noticed = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private tasks = new Set<Promise<void>>();
  readonly storage: OutboxStore;
  private sdk: OutboxDeps;
  private changed: (records: SendRecord[], notice?: string) => void;
  private clock: () => number;
  private random: () => number;
  private pollMs: number;
  constructor(storage: OutboxStore, sdk: OutboxDeps, changed: (records: SendRecord[], notice?: string) => void,
    clock = () => Date.now(), random = Math.random, pollMs = 12000) {
    this.storage = storage; this.sdk = sdk; this.changed = changed; this.clock = clock; this.random = random; this.pollMs = pollMs;
  }
  get records() { return this.storage.records; }
  private emit(notice?: string) { if (this.alive) this.changed(this.records, notice); }
  async start() {
    try { await this.storage.load(); }
    catch (e) { this.storageFault = true; throw e; }
    if (!this.alive) return;
    this.emit(); this.wake();
  }
  async enqueue(record: SendRecord): Promise<void> {
    if (!this.alive) throw new Error('连接已关闭');
    if (this.storageFault) throw new Error('本机待发状态异常，暂不能安全发送；请保留应用数据');
    try { await this.storage.enqueue({ ...record, status: 'queued' }); }
    catch (e) { if (!(e instanceof OutboxLimitError) && !(e instanceof OutboxIdentityError)) this.storageFault = true; throw e; }
    if (!this.alive) return;
    this.emit(); this.wake();
  }
  setConnection(state: NetworkState) {
    if (!this.alive) return;
    this.online = state === 'online';
    if (!this.online) { if (this.timer) clearTimeout(this.timer); this.timer = null; }
    else this.wake();
  }
  /** Snapshot omissions are not evidence of completion; query each outstanding receipt explicitly. */
  reconcile(): void {
    if (!this.alive || !this.online || this.storageFault) return;
    for (const record of this.records) {
      if (record.status !== 'accepted' || !record.receiptId || this.busy.has(record.clientMessageId)) continue;
      if ((this.cleanupRetryAt.get(record.clientMessageId) ?? 0) > this.clock()) continue;
      const cached = this.sdk.receipts.get(record.receiptId);
      if (cached && (receiptStage(cached.state) > receiptStage(record.receiptState) ||
          cached.state === record.receiptState && (cached.admission !== record.receiptAdmission || cached.handed_off !== record.receiptHandedOff || callbackChanged(record, cached) || feedbackChanged(record, cached))))
        this.launch(record.clientMessageId, () => this.recordReceipt(record, cached));
      else if (FINAL.has(record.receiptState || '') && this.sdk.messages.get(record.threadId)?.some((m: Message) => m.role === 'user' && m.client_message_id === record.clientMessageId))
        this.launch(record.clientMessageId, () => this.confirmHistory(record));
      else if (this.clock() - (this.checkedAt.get(record.clientMessageId) ?? -Infinity) >= this.pollMs) {
        this.checkedAt.set(record.clientMessageId, this.clock());
        this.launch(record.clientMessageId, () => this.checkReceipt(record));
      }
    }
  }
  private async confirmHistory(record: SendRecord, authoritative = false, synced = false) {
    const found = this.sdk.messages.get(record.threadId)?.some((m: Message) => m.role === 'user' && m.client_message_id === record.clientMessageId);
    const requiresInput = record.receiptAdmission === 'followup' || record.receiptState === 'received';
    if (FINAL.has(record.receiptState || '') && (found || !requiresInput && authoritative && synced)) {
      // A followup receipt proves admission, not that history contains its original.
      // Keep the local copy until its exact published client identity is available.
      // Normal completed turns retain the bounded-tail cleanup compatibility path.
      try { await this.storage.removeConfirmed(record.clientMessageId); }
      catch {
        // Removal is idempotent: the entry retains its slot in memory, and a
        // durable discarding marker (if written) is recovered on cold start.
        // Do not let this one confirmed entry starve already-durable sends.
        this.cleanupRetryAt.set(record.clientMessageId, this.clock() + this.pollMs);
        if (!this.cleanupNoticed.has(record.clientMessageId)) {
          this.cleanupNoticed.add(record.clientMessageId);
          this.emit('本机已确认记录清理失败；请保留应用数据');
        }
        return;
      }
      this.checkedAt.delete(record.clientMessageId);
      this.cleanupRetryAt.delete(record.clientMessageId);
      this.cleanupNoticed.delete(record.clientMessageId);
      this.noticed.delete(record.clientMessageId);
      this.emit();
    }
  }
  private launch(id: string, work: () => Promise<void>) {
    if (!this.alive || this.busy.has(id)) return;
    this.busy.add(id);
    const task = work().catch(e => {
      if (!this.alive || this.storageFault || retryable(e) || this.noticed.has(id)) return;
      this.noticed.add(id);
      this.emit('收据暂无法核对；记录已保留，新消息不受影响');
    })
      .finally(() => { this.busy.delete(id); this.tasks.delete(task); if (this.alive) this.wake(); });
    this.tasks.add(task);
  }
  private wake() {
    if (!this.alive || !this.online || this.storageFault) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.reconcile();
    let soonest = Infinity;
    const pendingThreads = new Set<string>();
    for (const record of this.records) {
      const entry = this.storage.entry(record.clientMessageId)!;
      if (record.status === 'queued' || record.status === 'ambiguous' || record.status === 'sending') {
        // Only the oldest unresolved submission in a thread may advance. An
        // ambiguous earlier send retains its place throughout backoff/restart.
        if (pendingThreads.has(record.threadId)) continue;
        pendingThreads.add(record.threadId);
        if (!this.busy.has(record.clientMessageId)) {
          if (entry.nextAttemptAt <= this.clock()) this.launch(record.clientMessageId, () => this.submit(record));
          else soonest = Math.min(soonest, entry.nextAttemptAt);
        }
      } else if (record.status === 'accepted' && record.receiptId && !this.busy.has(record.clientMessageId)) {
        const cleanupRetryAt = this.cleanupRetryAt.get(record.clientMessageId);
        if (cleanupRetryAt && cleanupRetryAt > this.clock()) {
          soonest = Math.min(soonest, cleanupRetryAt);
          continue;
        }
        const nextCheck = (this.checkedAt.get(record.clientMessageId) ?? -Infinity) + this.pollMs;
        if (nextCheck > this.clock()) soonest = Math.min(soonest, nextCheck);
      }
    }
    if (soonest < Infinity) this.timer = setTimeout(() => { this.timer = null; this.wake(); }, Math.max(1, soonest - this.clock()));
  }
  private async submit(record: SendRecord) {
    const gen = this.generation, abort = new AbortController();
    this.controllers.set(record.clientMessageId, abort);
    try {
      if (record.status !== 'sending') {
        try { await this.storage.update({ ...record, status: 'sending' }); }
        catch { this.storageFault = true; this.emit('本机待发状态保存失败；消息未提交，请保留应用数据'); return; }
      }
      if (!this.alive || !this.online || gen !== this.generation) return;
      this.emit();
      // Fifth argument is the SDK's optional AbortSignal (fourth is attachments).
      const receipt = await this.sdk.send(record.threadId, record.clientMessageId, record.text, (record.attachments ?? []).map(a => a.id), abort.signal);
      if (!this.alive || gen !== this.generation) return;
      const next = accepted(record, receipt);
      try { await this.storage.update(next, 0, 0); }
      catch { this.storageFault = true; this.emit('服务端已接收，但本机确认保存失败；记录已保留，请保留应用数据'); return; }
      if (!this.alive || gen !== this.generation) return;
      this.emit();
      // A durable ACK releases the thread's submission queue; history catch-up
      // can take another network timeout and must not hold the next send hostage.
      this.wake();
      await this.refreshHistory(next);
    } catch (e) {
      if (!this.alive || gen !== this.generation || abort.signal.aborted) return;
      const entry = this.storage.entry(record.clientMessageId);
      // A successful receipt may be in memory although its metadata write failed.
      // Never replace that proof with an ambiguous retry.
      if (entry?.record.status === 'accepted') return;
      if (retryable(e)) {
        const attempts = (entry?.attempts || 0) + 1;
        try { await this.storage.update({ ...record, status: 'ambiguous' }, attempts, this.clock() + delayFor(attempts, e, this.random)); this.emit(); }
        catch { this.storageFault = true; this.emit('本机待发状态保存失败；消息已保留，请保留应用数据'); }
      } else {
        try { await this.storage.update({ ...record, status: 'blocked' }); this.emit('发送未获服务器确认；请检查连接权限或消息内容'); }
        catch { this.storageFault = true; this.emit('本机待发状态保存失败；消息已保留，请勿清除应用数据'); }
      }
    } finally { this.controllers.delete(record.clientMessageId); }
  }
  private async recordReceipt(record: SendRecord, receipt: Receipt, authoritative = false) {
    if (!this.alive) return;
    const gen = this.generation;
    const next = accepted(record, receipt);
    try { await this.storage.update(next); }
    catch { this.storageFault = true; this.emit('本机收据保存失败；记录已保留，请保留应用数据'); return; }
    if (!this.alive || gen !== this.generation) return;
    this.emit();
    if (FINAL.has(next.receiptState || '')) await this.refreshHistory(next, authoritative);
  }
  private async checkReceipt(record: SendRecord) {
    if (!record.receiptId) return;
    const gen = this.generation, abort = new AbortController(); this.controllers.set(record.clientMessageId, abort);
    try {
      const receipt = await this.sdk.getReceipt(record.receiptId, abort.signal);
      if (this.alive && gen === this.generation) {
        if (receipt.id !== record.receiptId) throw new OutboxIdentityError('收据身份不匹配');
        const verified = accepted(record, receipt); // id alone is not the message identity
        this.noticed.delete(record.clientMessageId);
        // Even unchanged final receipts need another history sync after a
        // transient failure (or after a cold restart with an empty cache).
        if (receipt.state === record.receiptState && (callbackChanged(record, receipt) || feedbackChanged(record, receipt))) await this.recordReceipt(record, receipt, true);
        else if (receipt.state === record.receiptState && FINAL.has(receipt.state)) await this.refreshHistory(verified, true);
        else if (receiptStage(receipt.state) >= receiptStage(record.receiptState)) await this.recordReceipt(record, receipt, true);
      }
    } finally { this.controllers.delete(record.clientMessageId); }
  }
  private async refreshHistory(record: SendRecord, authoritative = false) {
    const gen = this.generation;
    // In the older forward-only SDK, an unanchored tail returns without I/O.
    const canSync = this.sdk.supportsLatest || !!this.sdk.messages.get(record.threadId)?.at(-1)?.ref_seq;
    let synced = false;
    try { await this.sdk.historyTail(record.threadId); synced = canSync; }
    catch { /* A timer retries receipt + history; SDK also recovers its tails. */ }
    if (this.alive && gen === this.generation) await this.confirmHistory(record, authoritative, synced);
  }
  /** Poll only accepted records. Unknown is never resubmitted as a new execution. */
  async stop() {
    this.alive = false; this.online = false; ++this.generation;
    if (this.timer) clearTimeout(this.timer);
    for (const controller of this.controllers.values()) controller.abort();
    await Promise.allSettled([...this.tasks]);
    await this.storage.idle();
  }
}
