import { app, safeStorage } from "electron";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface StoredConnection {
  version: 1;
  baseUrl: string;
  id: string;
  token: string;
}

export interface StoredPairing {
  version: 1;
  connection: StoredConnection;
  code: string;
  deviceName: string;
}

interface SecureState {
  version: 1;
  connection?: StoredConnection;
  pairing?: StoredPairing;
}

interface Envelope {
  version: 1;
  encrypted: string;
}



const assertConnection = (value: unknown): StoredConnection => {
  if (!value || typeof value !== "object") throw new Error("invalid connection");
  const item = value as Partial<StoredConnection>;
  if (
    item.version !== 1 ||
    typeof item.baseUrl !== "string" ||
    !/^https:\/\/[^/?#@]+$/i.test(item.baseUrl) ||
    typeof item.id !== "string" ||
    !/^[0-9a-f]{24}$/.test(item.id) ||
    typeof item.token !== "string" ||
    !/^ha_dev_[0-9a-f]{24}_[A-Za-z0-9_-]{43}$/.test(item.token)
  ) throw new Error("invalid connection");
  return item as StoredConnection;
};

const assertState = (value: unknown): SecureState => {
  if (!value || typeof value !== "object") throw new Error("invalid state");
  const item = value as Partial<SecureState>;
  if (item.version !== 1 || Boolean(item.connection) === Boolean(item.pairing)) throw new Error("invalid state");
  if (item.connection) return { version: 1, connection: assertConnection(item.connection) };
  const pending = item.pairing as Partial<StoredPairing>;
  if (
    pending.version !== 1 ||
    typeof pending.code !== "string" ||
    !/^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/.test(pending.code) ||
    typeof pending.deviceName !== "string" ||
    !pending.deviceName.trim() ||
    pending.deviceName.length > 64
  ) throw new Error("invalid state");
  return {
    version: 1,
    pairing: {
      version: 1,
      connection: assertConnection(pending.connection),
      code: pending.code,
      deviceName: pending.deviceName,
    },
  };
};

export class CredentialStore {
  private mutation: Promise<void> = Promise.resolve();
  /** Resolves when every queued write has finished. */
  async flush(): Promise<void> { await this.mutation; }
  constructor(private readonly filename = 'connection.secure.json') {
    if (!/^connection(?:-[0-9a-f]{24})?\.secure\.json$/.test(filename)) throw new Error('invalid credential path');
  }
  private path(): string { return join(app.getPath('userData'), this.filename); }
  async load(): Promise<SecureState | null> {
    await this.mutation;
    let raw: string;
    try {
      raw = await readFile(this.path(), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error("secure storage unavailable");
    }
    if (!safeStorage.isEncryptionAvailable()) throw new Error("secure storage unavailable");
    try {
      const envelope = JSON.parse(raw) as Envelope;
      if (envelope.version !== 1 || typeof envelope.encrypted !== "string") throw new Error();
      const decrypted = safeStorage.decryptString(Buffer.from(envelope.encrypted, "base64"));
      return assertState(JSON.parse(decrypted));
    } catch {
      throw new Error("secure storage unavailable");
    }
  }

  async saveConnection(connection: StoredConnection): Promise<void> {
    await this.save({ version: 1, connection });
  }

  async savePairing(pairing: StoredPairing): Promise<void> {
    await this.save({ version: 1, pairing });
  }

  private change(operation: () => Promise<void>): Promise<void> {
    const result = this.mutation.then(operation); this.mutation = result.catch(() => {}); return result;
  }
  private save(state: SecureState): Promise<void> { return this.change(() => this.write(state)); }
  private async write(state: SecureState): Promise<void> {
    const verified = assertState(state);
    if (!safeStorage.isEncryptionAvailable()) throw new Error("secure storage unavailable");
    const destination = this.path();
    const temporary = `${destination}.new`;
    const encrypted = safeStorage.encryptString(JSON.stringify(verified)).toString("base64");
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(temporary, `${JSON.stringify({ version: 1, encrypted } satisfies Envelope)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, destination);
  }

  async delete(): Promise<void> {
    await this.change(() => rm(this.path(), { force: true }));
  }
}
