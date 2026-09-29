import { contextBridge, ipcRenderer } from "electron";
import type { DesktopRuntimeInfo, DesktopSnapshot, HermesDesktopApi, PairingRequest } from "../shared/desktop-api";

const runtimeInfo: DesktopRuntimeInfo = Object.freeze({
  platform: process.platform,
  versions: Object.freeze({ chrome: process.versions.chrome, electron: process.versions.electron }),
});

const api: HermesDesktopApi = Object.freeze({
  getRuntimeInfo: (): DesktopRuntimeInfo => runtimeInfo,
  getSnapshot: (): Promise<DesktopSnapshot> => ipcRenderer.invoke("desktop:get-snapshot"),
  subscribe(listener: (snapshot: DesktopSnapshot) => void): () => void {
    const receive = (_event: Electron.IpcRendererEvent, snapshot: DesktopSnapshot) => listener(snapshot);
    ipcRenderer.on("desktop:snapshot", receive);
    return () => ipcRenderer.removeListener("desktop:snapshot", receive);
  },
  pair: (request: PairingRequest): Promise<void> => ipcRenderer.invoke("desktop:pair", request),
  cancelPairing: (): Promise<void> => ipcRenderer.invoke("desktop:cancel-pairing"),
  forgetConnection: (): Promise<void> => ipcRenderer.invoke("desktop:forget-connection"),
  selectChannel: (channelId: string): Promise<void> => ipcRenderer.invoke("desktop:select-channel", channelId),
  selectThread: (threadId: string): Promise<void> => ipcRenderer.invoke("desktop:select-thread", threadId),
  retryConnection: (): Promise<void> => ipcRenderer.invoke("desktop:retry-connection"),
});

contextBridge.exposeInMainWorld("hermesDesktop", api);
