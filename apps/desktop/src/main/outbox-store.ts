import { app, safeStorage } from "electron";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type OutboxState = "pending" | "sending" | "unknown" | "blocked";

/** A session started on this device: create it (same Thread ID on every retry) before the first send. */
export type OutboxCreate = Readonly<{ channelId: string; title: string; automationEditor?: true }>;

export type OutboxRecord = Readonly<{
  version: 1;
  id: string;
  threadId: string;
  text: string;
  attachmentIds: readonly string[];
  createdAt: number;
  state: OutboxState;
  receiptId?: string;
  receiptRefSeq?: number;
  create?: OutboxCreate;
}>;

type OutboxData = { version: 1; identities: Record<string, OutboxRecord[]> };
type Envelope = { version: 1; encrypted: string };

const destination = () => join(app.getPath("userData"), "outbox.secure.json");
const empty = (): OutboxData => ({ version: 1, identities: {} });
const identity = (value: string): string => {
  if (!/^[0-9a-f]{24}$/.test(value)) throw new Error("invalid outbox identity");
  return value;
};
const record = (value: unknown): OutboxRecord => {
  if (!value || typeof value !== "object") throw new Error("invalid outbox record");
  const item = value as Partial<OutboxRecord>;
  if (
    item.version !== 1 ||
    typeof item.id !== "string" || !/^desktop:[0-9a-f-]{36}$/.test(item.id) ||
    typeof item.threadId !== "string" || !item.threadId || item.threadId.length > 200 ||
    typeof item.text !== "string" || item.text.length > 100_000 ||
    !Array.isArray(item.attachmentIds) || item.attachmentIds.length > 8 || item.attachmentIds.some((id) => typeof id !== "string" || !id.startsWith("att_")) ||
    typeof item.createdAt !== "number" || !Number.isSafeInteger(item.createdAt) || item.createdAt < 0 ||
    !["pending", "sending", "unknown", "blocked"].includes(item.state ?? "") ||
    (item.receiptId !== undefined && (typeof item.receiptId !== "string" || !item.receiptId || item.receiptId.length > 200)) ||
    (item.receiptRefSeq !== undefined && (!item.receiptId || !Number.isSafeInteger(item.receiptRefSeq) || item.receiptRefSeq <= 0)) ||
    (item.create !== undefined && !validCreate(item.create, item.threadId))
  ) throw new Error("invalid outbox record");
  return Object.freeze({
    version: 1,
    id: item.id,
    threadId: item.threadId,
    text: item.text,
    attachmentIds: Object.freeze([...item.attachmentIds]),
    createdAt: item.createdAt,
    state: item.state,
    ...(item.receiptId ? { receiptId: item.receiptId } : {}),
    ...(item.receiptRefSeq !== undefined ? { receiptRefSeq: item.receiptRefSeq } : {}),
    ...(item.create ? { create: Object.freeze({ channelId: item.create.channelId, title: item.create.title, ...(item.create.automationEditor ? { automationEditor: true as const } : {}) }) } : {}),
  }) as OutboxRecord;
};
const validCreate = (value: unknown, threadId: string): boolean => {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<OutboxCreate>;
  return /^th_[A-Za-z0-9_-]{8,64}$/.test(threadId) && typeof item.channelId === "string" && !!item.channelId && item.channelId.length <= 200 &&
    typeof item.title === "string" && !!item.title.trim() && item.title.length <= 200 && (item.automationEditor === undefined || item.automationEditor === true);
};
const data = (value: unknown): OutboxData => {
  if (!value || typeof value !== "object") throw new Error("invalid outbox");
  const item = value as Partial<OutboxData>;
  if (item.version !== 1 || !item.identities || typeof item.identities !== "object" || Array.isArray(item.identities)) throw new Error("invalid outbox");
  const identities: Record<string, OutboxRecord[]> = {};
  for (const [key, records] of Object.entries(item.identities)) {
    identity(key);
    if (!Array.isArray(records) || records.length > 1000) throw new Error("invalid outbox");
    const parsed = records.map(record);
    if (new Set(parsed.map(({ id }) => id)).size !== parsed.length) throw new Error("invalid outbox");
    identities[key] = parsed;
  }
  return { version: 1, identities };
};

export class OutboxStore {
  private mutation: Promise<void> = Promise.resolve();
  /** Resolves when every queued write has finished. */
  async flush(): Promise<void> { await this.mutation; }

  private async read(): Promise<OutboxData> {
    let raw: string;
    try { raw = await readFile(destination(), "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
      throw new Error("outbox unavailable");
    }
    if (!safeStorage.isEncryptionAvailable()) throw new Error("outbox unavailable");
    try {
      const envelope = JSON.parse(raw) as Envelope;
      if (envelope.version !== 1 || typeof envelope.encrypted !== "string") throw new Error();
      return data(JSON.parse(safeStorage.decryptString(Buffer.from(envelope.encrypted, "base64"))));
    } catch { throw new Error("outbox unavailable"); }
  }

  private async write(value: OutboxData): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("outbox unavailable");
    const path = destination();
    if (!Object.keys(value.identities).length) { await rm(path, { force: true }); return; }
    const encrypted = safeStorage.encryptString(JSON.stringify(data(value))).toString("base64");
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(`${path}.new`, `${JSON.stringify({ version: 1, encrypted } satisfies Envelope)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(`${path}.new`, path);
  }

  async list(connectionId: string): Promise<readonly OutboxRecord[]> {
    const current = await this.read();
    return Object.freeze([...(current.identities[identity(connectionId)] ?? [])]);
  }

  private async change(action: (current: OutboxData) => void): Promise<void> {
    const operation = this.mutation.then(async () => {
      const current = await this.read();
      action(current);
      await this.write(current);
    });
    this.mutation = operation.catch(() => {});
    return operation;
  }

  async put(connectionId: string, value: OutboxRecord): Promise<void> {
    const key = identity(connectionId), verified = record(value);
    await this.change((current) => {
      const records = current.identities[key] ?? [];
      const index = records.findIndex(({ id }) => id === verified.id);
      if (index < 0) records.push(verified); else records[index] = verified;
      current.identities[key] = records;
    });
  }

  async remove(connectionId: string, id: string): Promise<void> {
    const key = identity(connectionId);
    await this.change((current) => {
      const remaining = (current.identities[key] ?? []).filter((item) => item.id !== id);
      if (remaining.length) current.identities[key] = remaining; else delete current.identities[key];
    });
  }

  async clear(connectionId: string): Promise<void> {
    const key = identity(connectionId);
    await this.change((current) => { delete current.identities[key]; });
  }
}
