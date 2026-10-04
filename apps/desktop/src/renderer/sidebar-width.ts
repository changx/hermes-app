export const SIDEBAR_WIDTH_KEY = 'hermes.desktop.sidebar-width';
export const DEFAULT_SIDEBAR_WIDTH = 280;
export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 480;
export const sidebarMaximum = (available: number): number => Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, available - 360));
export const clampSidebarWidth = (width: number, available: number): number => Math.round(Math.max(MIN_SIDEBAR_WIDTH, Math.min(sidebarMaximum(available), width)));
export function loadSidebarWidth(): number {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    const value = stored === null ? DEFAULT_SIDEBAR_WIDTH : Number(stored);
    if (Number.isFinite(value) && value >= MIN_SIDEBAR_WIDTH && value <= MAX_SIDEBAR_WIDTH) return Math.round(value);
  } catch { /* A local layout preference must not prevent opening the app. */ }
  return DEFAULT_SIDEBAR_WIDTH;
}
export function saveSidebarWidth(width: number): boolean {
  try { window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width)); return true; }
  catch { return false; }
}
