import { useSyncExternalStore } from "react";
import type { DesktopSnapshot } from "../shared/desktop-api";
import { DesktopSnapshotStore, initialDesktopSnapshot } from "./desktop-store-core";

let store: DesktopSnapshotStore | undefined;

export const useDesktopSnapshot = (): DesktopSnapshot => {
  store ??= new DesktopSnapshotStore(window.hermesDesktop);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => initialDesktopSnapshot);
};
