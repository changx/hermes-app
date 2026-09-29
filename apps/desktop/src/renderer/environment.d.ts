import type { HermesDesktopApi } from "../shared/desktop-api";

declare global {
  interface Window {
    hermesDesktop: HermesDesktopApi;
  }
}

export {};
