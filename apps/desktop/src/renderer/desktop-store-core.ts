import type { DesktopSnapshot, HermesDesktopApi } from "../shared/desktop-api";

export const initialDesktopSnapshot: DesktopSnapshot = Object.freeze({
  revision: 0,
  phase: "restoring",
  connectionState: "suspended",
  connectionLabel: "Restoring",
  channels: [],
  threads: [],
  messages: [],
});

export class DesktopSnapshotStore {
  private current = initialDesktopSnapshot;
  private readonly listeners = new Set<() => void>();
  private stopBridge: (() => void) | null = null;

  constructor(private readonly api: HermesDesktopApi) {}

  getSnapshot = (): DesktopSnapshot => this.current;

  private update = (snapshot: DesktopSnapshot): void => {
    if (snapshot.revision <= this.current.revision) return;
    this.current = snapshot;
    for (const listener of this.listeners) listener();
  };

  private start(): void {
    if (this.stopBridge) return;
    this.stopBridge = this.api.subscribe((snapshot) => this.update(snapshot));
    void this.api.getSnapshot().then((snapshot) => this.update(snapshot)).catch(() => {
      this.update(Object.freeze({ ...initialDesktopSnapshot, revision: this.current.revision + 1, phase: "unpaired", errorMessage: "Hermes could not restore the saved connection." }));
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    this.start();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size && this.stopBridge) {
        this.stopBridge();
        this.stopBridge = null;
      }
    };
  };
}
