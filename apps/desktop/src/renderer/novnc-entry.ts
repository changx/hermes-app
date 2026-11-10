// noVNC as its own script (dist/renderer/novnc.js). Only Remote browser tabs load it; see
// loadNoVNC() in remote-screen-page.tsx and the top-level await rewrite in build.mjs.
import RFB from '@novnc/novnc';
(window as unknown as { HermesNoVNC?: typeof RFB }).HermesNoVNC = RFB;
