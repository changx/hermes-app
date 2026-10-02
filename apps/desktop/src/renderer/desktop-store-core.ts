import type { DesktopSnapshot, HermesDesktopApi } from "../shared/desktop-api";
import { applySnapshotDelta, reconcileSnapshot, type DesktopSnapshotDelta, type DesktopUpdate } from "../shared/snapshot-delta";

export const initialDesktopSnapshot: DesktopSnapshot = Object.freeze({
  revision: 0, phase: "restoring", connectionState: "suspended", connectionLabel: "Restoring",
  channels: [], threads: [], messages: [], interactions: [], canLoadOlder: false,
});

export class DesktopSnapshotStore {
  private current = initialDesktopSnapshot;
  private readonly listeners = new Set<() => void>();
  private stopBridge: (() => void) | null = null;
  private baselineReady = false;
  private readonly pending = new Map<number, DesktopSnapshotDelta>();
  private restoring = false;
  private generation = 0;

  constructor(private readonly api: HermesDesktopApi) {}
  getSnapshot = (): DesktopSnapshot => this.current;

  private notify(): void { for (const listener of this.listeners) listener(); }

  private drain(): void {
    for (const [revision] of this.pending) if (revision <= this.current.revision) this.pending.delete(revision);
    while (this.baselineReady) {
      const next = [...this.pending.values()].find(value => value.baseRevision === this.current.revision);
      if (!next) break;
      this.current = applySnapshotDelta(this.current,next);
      this.pending.delete(next.revision);
    }
  }

  private update = (update: DesktopUpdate): void => {
    if (update.revision <= this.current.revision && this.baselineReady) return;
    const before = this.current;
    if ('kind' in update && update.kind === 'delta') {
      this.pending.set(update.revision,update);
      // IPC interruption/reload is recovered from the exact full baseline;
      // never apply a delta against the wrong selection or entity set.
      if (this.pending.size > 200) { this.pending.clear(); this.baselineReady = false; }
    } else {
      this.current = reconcileSnapshot(this.current,update as DesktopSnapshot);
      this.baselineReady = true;
    }
    this.drain();
    if (before !== this.current) this.notify();
    if ((!this.baselineReady || this.pending.size) && !this.restoring) this.restore();
  };

  private restore(): void {
    if (this.restoring) return;
    this.restoring = true;
    const generation = this.generation;
    void this.api.getSnapshot().then(snapshot => {
      if (generation !== this.generation) return;
      this.update(snapshot);
    }).catch(() => {
      if (generation !== this.generation || this.baselineReady) return;
      // A local read failure must not invent a server revision.
      this.current = Object.freeze({...this.current, phase:"unpaired",errorMessage:"Hermes could not restore the saved connection."});
      this.notify();
    }).finally(() => { if (generation === this.generation) this.restoring = false; });
  }

  private start(): void {
    if (this.stopBridge) return;
    this.generation++;
    this.stopBridge = this.api.subscribe(this.update);
    this.restore();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener); this.start();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size && this.stopBridge) {
        this.stopBridge(); this.stopBridge = null;
        this.generation++; this.restoring = false;
      }
    };
  };
}
