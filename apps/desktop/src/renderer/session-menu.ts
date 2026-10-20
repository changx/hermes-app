import type { ContextMenuItem } from '../shared/desktop-api';

export type SessionMenuAction = 'rename' | 'todo' | 'labels' | 'copy-link' | 'export' | 'archive';

/**
 * The Session menu, in display order: the sidebar row menu and the Session
 * page's status bar "More" menu. macOS title case; "…" marks items that open a
 * dialog. Server actions are disabled while the Session's connection is
 * offline; Copy Link works offline. Todo and labels need server label support.
 * Export is offered only on the Session page (`exportable`), as before.
 */
export function sessionMenuItems({ todo, labels, online, exportable = false }: { todo: boolean; labels: boolean; online: boolean; exportable?: boolean }): ContextMenuItem[] {
  return [
    { id: 'rename', label: 'Rename…', enabled: online },
    ...(labels ? [{ id: 'todo', label: todo ? 'Remove Todo' : 'Mark as Todo', enabled: online }, { id: 'labels', label: 'Edit Labels…', enabled: online }] : []),
    { separator: true },
    { id: 'copy-link', label: 'Copy Link' },
    ...(exportable ? [{ id: 'export', label: 'Export Conversation…', enabled: online }] : []),
    { separator: true },
    { id: 'archive', label: 'Archive…', enabled: online },
  ];
}

export const isSessionMenuAction = (id: string | null): id is SessionMenuAction =>
  id === 'rename' || id === 'todo' || id === 'labels' || id === 'copy-link' || id === 'export' || id === 'archive';
