import type WebSocket from "ws";

// Open WebSockets of this process (Hermes live connections and browser control), so a graceful
// shutdown can wait for their close handshakes instead of cutting them off at exit.
const open = new Set<WebSocket>();

export const trackSocket = (ws: WebSocket): WebSocket => {
  open.add(ws);
  ws.once("close", () => open.delete(ws));
  return ws;
};

/** Resolves true when every tracked socket has closed, or false after `timeoutMs`. */
export const socketsClosed = (timeoutMs: number): Promise<boolean> => new Promise(resolve => {
  if (open.size === 0) return resolve(true);
  const timer = setTimeout(() => { clearInterval(poll); resolve(open.size === 0); }, timeoutMs);
  const poll = setInterval(() => { if (open.size === 0) { clearTimeout(timer); clearInterval(poll); resolve(true); } }, 20);
});

export const openSocketCount = (): number => open.size;
