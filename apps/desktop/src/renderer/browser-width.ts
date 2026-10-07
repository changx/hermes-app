// Right preview/browser sidebar width. Without a saved preference it follows the window (42%, 280–560px).
// After the user drags or uses the keyboard, the chosen width is kept locally and clamped to the window.
export const BROWSER_WIDTH_KEY = 'hermes.desktop.browser-width';
export const MIN_BROWSER_WIDTH = 280;
export const MAX_BROWSER_WIDTH = 1600;
/** Space kept for the conversation column beside the preview. */
export const CONVERSATION_RESERVE = 360;
export const automaticBrowserWidth = (available: number): number => Math.max(MIN_BROWSER_WIDTH, Math.min(560, Math.round(available * .42)));
/** `available` is the workspace width minus the visible left sidebar. */
export const browserMaximum = (available: number): number => Math.max(MIN_BROWSER_WIDTH, Math.min(MAX_BROWSER_WIDTH, available - CONVERSATION_RESERVE));
export const clampBrowserWidth = (width: number, available: number): number => Math.round(Math.max(MIN_BROWSER_WIDTH, Math.min(browserMaximum(available), width)));
export function loadBrowserWidth(): number | null {
  try {
    const stored = window.localStorage.getItem(BROWSER_WIDTH_KEY);
    if (stored === null) return null;
    const value = Number(stored);
    if (stored.trim() !== '' && Number.isFinite(value) && value >= MIN_BROWSER_WIDTH && value <= MAX_BROWSER_WIDTH) return Math.round(value);
  } catch { /* A local layout preference must not prevent opening the app. */ }
  return null;
}
/** `null` removes the preference and returns to the automatic width. */
export function saveBrowserWidth(width: number | null): boolean {
  try {
    if (width === null) window.localStorage.removeItem(BROWSER_WIDTH_KEY);
    else window.localStorage.setItem(BROWSER_WIDTH_KEY, String(width));
    return true;
  } catch { return false; }
}
