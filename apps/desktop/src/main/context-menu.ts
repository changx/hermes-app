import type { ContextMenuItem } from '../shared/desktop-api';

const MAX_ITEMS = 16, MAX_LABEL = 80, ID = /^[a-z][a-z0-9-]{0,39}$/;

/**
 * Validates a renderer-built context menu. Only plain items and separators;
 * no roles, accelerators or submenus cross the IPC boundary.
 */
export function contextMenuItems(value: unknown): ContextMenuItem[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ITEMS) throw new Error('Invalid desktop request');
  const ids = new Set<string>();
  return value.map((raw): ContextMenuItem => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid desktop request');
    const item = raw as Record<string, unknown>;
    if (item.separator === true) return { separator: true };
    const { id, label, enabled } = item;
    if (typeof id !== 'string' || !ID.test(id) || ids.has(id)) throw new Error('Invalid desktop request');
    if (typeof label !== 'string' || !label.trim() || label.length > MAX_LABEL) throw new Error('Invalid desktop request');
    if (enabled !== undefined && typeof enabled !== 'boolean') throw new Error('Invalid desktop request');
    ids.add(id);
    return { id, label, enabled: enabled !== false };
  });
}

/** Window content coordinates, or the pointer position when absent. */
export function menuPosition(x: unknown, y: unknown): { x: number; y: number } | Record<string, never> {
  return Number.isFinite(x) && Number.isFinite(y) ? { x: Math.max(0, Math.round(x as number)), y: Math.max(0, Math.round(y as number)) } : {};
}
