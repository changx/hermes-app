/**
 * Bottom tab lists scroll under the native tab bar. The safe-area inset only
 * covers the home indicator, not the tab bar, so lists add this clearance to
 * keep the last row visible above the bar. Channels uses the same value for
 * its floating New channel button.
 */
export const TAB_BAR_CLEARANCE = 96;

export function tabListBottomPadding(safeAreaBottom: number): number {
  return TAB_BAR_CLEARANCE + Math.max(0, safeAreaBottom);
}
