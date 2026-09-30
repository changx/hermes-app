export interface MeasuredHistoryRow { key: string; top: number; height: number }
export interface HistoryAnchor { key: string; top: number }

// Cell top is in content coordinates. Freeze the first original visible message
// at drag-end, not a newly selected middle row after refresh/rebound.
export function releasedHistoryAnchor(rows: readonly MeasuredHistoryRow[], releasedOffset: number, viewportHeight: number, viewportTop = 0): HistoryAnchor | null {
  const first = rows.filter(row => row.height > 0 && row.top + row.height > releasedOffset && row.top < releasedOffset + viewportHeight)
    .sort((a, b) => a.top - b.top)[0];
  return first ? { key: first.key, top: viewportTop + first.top - releasedOffset } : null;
}

// Absolute target from committed cell layout: never combine a delayed window
// measurement with a newer scroll offset (which can double-count native scroll).
export function historyAnchorOffset(anchor: HistoryAnchor, contentTop: number, viewportTop: number, rawOffset: number): number | null {
  const target = Math.max(0, contentTop + viewportTop - anchor.top);
  return Math.abs(target - rawOffset) > 0.5 ? target : null;
}
