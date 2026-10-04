/** Local composer state only. Never include this map in server snapshots or send payloads. */
export class LocalDraftMap<T> extends Map<string, T> {
  private revision = 0;
  private readonly listeners = new Set<() => void>();
  private readonly mutations = new Set<(key?: string) => void>();
  private readonly meaningful: (value: T) => boolean;
  constructor(meaningful: (value: T) => boolean) { super(); this.meaningful = meaningful; }
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  readonly getSnapshot = (): number => this.revision;
  /** Observe every content edit, not only changes to badge presence. */
  readonly observeMutations = (listener: (key?: string) => void): (() => void) => {
    this.mutations.add(listener);
    return () => { this.mutations.delete(listener); };
  };
  hasDraft(key: string): boolean {
    const value = this.get(key);
    return value !== undefined && this.meaningful(value);
  }
  private changed() { this.revision++; this.listeners.forEach(listener => listener()); }
  override set(key: string, value: T): this {
    const before = this.hasDraft(key);
    super.set(key, value);
    if (before !== this.hasDraft(key)) this.changed();
    this.mutations.forEach(listener => listener(key));
    return this;
  }
  override delete(key: string): boolean {
    const before = this.hasDraft(key), removed = super.delete(key);
    if (before) this.changed();
    if (removed) this.mutations.forEach(listener => listener(key));
    return removed;
  }
  override clear(): void {
    const before = [...this.keys()].some(key => this.hasDraft(key));
    super.clear();
    if (before) this.changed();
    this.mutations.forEach(listener => listener());
  }
}
