import { contextBridge } from "electron";

export type DesktopRuntimeInfo = Readonly<{
  platform: NodeJS.Platform;
  versions: Readonly<{
    chrome: string;
    electron: string;
  }>;
}>;

const runtimeInfo: DesktopRuntimeInfo = Object.freeze({
  platform: process.platform,
  versions: Object.freeze({
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  }),
});

contextBridge.exposeInMainWorld(
  "hermesDesktop",
  Object.freeze({
    getRuntimeInfo: (): DesktopRuntimeInfo => runtimeInfo,
  }),
);
