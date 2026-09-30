export interface MeasuredHistoryRow { key: string; top: number; height: number }
export interface HistoryAnchor { key: string; top: number }

// Window coordinates, not estimated row heights or total content-size deltas.
// Preserve the released pull gap, rather than snapping back to the pre-pull top.
// Measurement can arrive after rebound: compensate by the offset travelled.
export function middleHistoryAnchor(rows: readonly MeasuredHistoryRow[], viewportTop: number, viewportHeight: number, displacement = 0): HistoryAnchor | null {
  const middle = viewportTop + viewportHeight / 2;
  const visible = rows.map(row => ({ ...row, top: row.top + displacement }))
    .filter(row => row.height > 0 && row.top + row.height > viewportTop && row.top < viewportTop + viewportHeight);
  visible.sort((a, b) => Math.abs(a.top + a.height / 2 - middle) - Math.abs(b.top + b.height / 2 - middle));
  const row = visible[0];
  return row ? { key: row.key, top: row.top - viewportTop } : null;
}

export function historyAnchorOffset(anchor: HistoryAnchor, rowTop: number, viewportTop: number, rawOffset: number): number | null {
  const delta = rowTop - viewportTop - anchor.top;
  const target = Math.max(0, rawOffset + delta);
  // Short/exhausted history may not contain enough space above the anchor.
  // Do not repeatedly issue an impossible scroll past the content boundary.
  return Math.abs(delta) > 0.5 && Math.abs(target - rawOffset) > 0.5 ? target : null;
}
