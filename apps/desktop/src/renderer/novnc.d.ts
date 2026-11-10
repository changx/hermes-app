// The parts of noVNC's RFB class (core/rfb.js, 1.7) that the Remote browser tab uses.
declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, urlOrChannel: string | WebSocket, options?: { shared?: boolean; credentials?: Record<string, string> });
    viewOnly: boolean;
    focusOnClick: boolean;
    clipViewport: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    showDotCursor: boolean;
    background: string;
    qualityLevel: number;
    compressionLevel: number;
    disconnect(): void;
    focus(options?: FocusOptions): void;
    blur(): void;
    sendKey(keysym: number, code: string | null, down?: boolean): void;
    clipboardPasteFrom(text: string): void;
  }
}
