type Entry = { owner: RenderResourceScope; key: unknown; inputs: readonly unknown[]; value: unknown; bytes: number };

/** Accounting bounds for evictable derived values, not a native/JS heap guarantee. */
export class RenderResourceBudget {
  private entries = new Map<Entry, true>();
  private bytes = 0;
  readonly maxBytes: number;
  readonly maxEntries: number;
  constructor(maxBytes = 16 * 1024 * 1024, maxEntries = 256) {
    this.maxBytes = maxBytes; this.maxEntries = maxEntries;
  }
  get snapshot() { return { entries: this.entries.size, bytes: this.bytes }; }
  retain(entry: Entry) {
    this.remove(entry);
    this.entries.set(entry, true); this.bytes += entry.bytes;
    while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value!;
      this.remove(oldest); oldest.owner.evict(oldest);
    }
  }
  remove(entry: Entry) { if (this.entries.delete(entry)) this.bytes -= entry.bytes; }
}

/** An uncommitted render owns only private, collectible entries. The committed
 * page joins the shared budget; losing focus does not change ownership. */
export class RenderResourceScope {
  private entries = new Map<unknown, Entry>();
  private bytes = 0;
  private active = false;
  private disposed = false;
  private readonly budget: RenderResourceBudget;
  constructor(budget: RenderResourceBudget) { this.budget = budget; }
  activate() {
    if (this.disposed) return;
    this.active = true;
    for (const entry of [...this.entries.values()]) this.budget.retain(entry);
  }
  get snapshot() { return { entries: this.entries.size, bytes: this.bytes }; }
  read<T>(key: unknown, inputs: readonly unknown[], create: () => T, estimate: (value: T) => number): T {
    const old = this.entries.get(key);
    if (old && old.inputs.length === inputs.length && inputs.every((value, i) => Object.is(value, old.inputs[i]))) {
      this.entries.delete(key); this.entries.set(key, old);
      if (this.active) this.budget.retain(old);
      return old.value as T;
    }
    if (old) this.evict(old);
    const value = create();
    const bytes = estimate(value);
    if (this.disposed || !Number.isFinite(bytes) || bytes < 0 || bytes > this.budget.maxBytes) return value;
    const entry: Entry = { owner: this, key, inputs: [...inputs], value, bytes };
    this.entries.set(key, entry); this.bytes += bytes;
    if (this.active) this.budget.retain(entry);
    else while (this.bytes > this.budget.maxBytes || this.entries.size > this.budget.maxEntries) this.evict(this.entries.values().next().value!);
    return value;
  }
  evict(entry: Entry) {
    if (this.entries.get(entry.key) !== entry) return;
    this.entries.delete(entry.key); this.bytes -= entry.bytes; this.budget.remove(entry);
  }
  dispose() {
    this.disposed = true; this.active = false;
    for (const entry of [...this.entries.values()]) this.evict(entry);
  }
}
