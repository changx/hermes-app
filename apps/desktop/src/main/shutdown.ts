import { BrowserWindow, app, webContents, type WebContents } from "electron";

/** One step of the quit sequence. A step that passes its time limit is abandoned and the next step runs. */
export type ShutdownStep = { name: string; timeoutMs: number; run: () => unknown };
export type ShutdownRecord = { name: string; ms: number; outcome: "done" | "timeout" | "failed"; detail?: string };

export const runShutdown = async (steps: readonly ShutdownStep[], now = () => Date.now()): Promise<ShutdownRecord[]> => {
  const records: ShutdownRecord[] = [];
  for (const step of steps) {
    const started = now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<"timeout">(resolve => { timer = setTimeout(() => resolve("timeout"), step.timeoutMs); });
    try {
      const result = await Promise.race([Promise.resolve().then(step.run).then(value => ({ value })), limit]);
      records.push(result === "timeout" ? { name: step.name, ms: now() - started, outcome: "timeout" }
        : { name: step.name, ms: now() - started, outcome: "done", detail: describe((result as { value: unknown }).value) });
    } catch (error) {
      records.push({ name: step.name, ms: now() - started, outcome: "failed", detail: error instanceof Error ? error.message : String(error) });
    } finally { clearTimeout(timer); }
  }
  return records;
};
const describe = (value: unknown): string | undefined => value === undefined ? undefined : typeof value === "string" ? value : JSON.stringify(value);

/**
 * During quit a page's beforeunload must not stop the app. Pages still receive their unload events;
 * only the "leave this page?" refusal is ignored.
 */
export const allowUnloadDuringQuit = (): void => {
  const allow = (contents: WebContents) => contents.on("will-prevent-unload", event => event.preventDefault());
  for (const contents of webContents.getAllWebContents()) allow(contents);
  app.on("web-contents-created", (_event, contents) => allow(contents));
};

/**
 * Closes windows the normal way (close event, unload, then closed) and waits for them. A window that is
 * still open after `timeoutMs` is destroyed. Returns the titles of windows that had to be destroyed.
 */
export const closeWindows = async (windows: readonly BrowserWindow[], timeoutMs: number): Promise<string[]> => {
  const open = windows.filter(window => !window.isDestroyed());
  const closed = open.map(window => new Promise<void>(resolve => { if (window.isDestroyed()) resolve(); else window.once("closed", () => resolve()); }));
  for (const window of open) if (!window.isDestroyed()) window.close();
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([Promise.all(closed), new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); })]);
  clearTimeout(timer);
  const forced: string[] = [];
  for (const window of open) if (!window.isDestroyed()) { forced.push(window.getTitle() || "window"); window.destroy(); }
  return forced;
};
