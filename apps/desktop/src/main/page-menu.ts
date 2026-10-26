/**
 * The right-click menu of the app's own pages (main window and tab pages).
 * Pure helpers: the Electron wiring is in index.ts. External web pages in the browser panel are not covered.
 */

export type PageMenuAction = 'cut' | 'copy' | 'paste' | 'select-all' | 'copy-link' | 'search-web' | 'find' | 'search-app';
export type PageMenuEntry = { separator: true } | { action: PageMenuAction; label: string; accelerator?: string; enabled?: boolean };
export type PageMenuParams = {
  selectionText?: string; isEditable?: boolean; linkURL?: string;
  editFlags?: { canCut?: boolean; canCopy?: boolean; canPaste?: boolean; canSelectAll?: boolean };
};

/** Shortcuts shown in the menu and handled in tab-manager.ts / shell.tsx. */
export const PAGE_SHORTCUTS = { find: 'CmdOrCtrl+F', findNext: 'CmdOrCtrl+G', findPrevious: 'Shift+CmdOrCtrl+G', findSelection: 'CmdOrCtrl+E', searchApp: 'CmdOrCtrl+K', searchWeb: 'Shift+CmdOrCtrl+E' } as const;

const MAX_QUERY = 500, MAX_LABEL_TEXT = 24;

/** Selected text as a search query: one line, single spaces, at most 500 characters. Empty when there is no text. */
export function searchText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return [...value.replace(/\s+/g, ' ').trim()].slice(0, MAX_QUERY).join('');
}

/** The web search for a query. Google, opened in the page's browser panel. */
export function webSearchUrl(value: unknown): string | undefined {
  const query = searchText(value);
  return query ? `https://www.google.com/search?q=${encodeURIComponent(query)}` : undefined;
}

const quoted = (text: string) => { const chars = [...text]; return `“${chars.length > MAX_LABEL_TEXT ? `${chars.slice(0, MAX_LABEL_TEXT - 1).join('')}…` : text}”`; };

/**
 * Menu entries for a right-click. `canFind` is false when no page can show the find bar
 * (the main window with no open tab).
 */
export function pageMenuEntries(params: PageMenuParams, canFind: boolean): PageMenuEntry[] {
  const selection = searchText(params.selectionText), flags = params.editFlags ?? {}, entries: PageMenuEntry[] = [];
  const link = typeof params.linkURL === 'string' && /^https?:/i.test(params.linkURL) ? params.linkURL : '';
  if (link) entries.push({ action: 'copy-link', label: 'Copy Link' }, { separator: true });
  if (params.isEditable) {
    entries.push({ action: 'cut', label: 'Cut', accelerator: 'CmdOrCtrl+X', enabled: flags.canCut !== false && !!selection },
      { action: 'copy', label: 'Copy', accelerator: 'CmdOrCtrl+C', enabled: flags.canCopy !== false && !!selection },
      { action: 'paste', label: 'Paste', accelerator: 'CmdOrCtrl+V', enabled: flags.canPaste !== false },
      { action: 'select-all', label: 'Select All', accelerator: 'CmdOrCtrl+A', enabled: flags.canSelectAll !== false });
  } else if (selection) entries.push({ action: 'copy', label: 'Copy', accelerator: 'CmdOrCtrl+C' });
  if (entries.length && !('separator' in entries[entries.length - 1])) entries.push({ separator: true });
  if (selection) {
    entries.push({ action: 'search-web', label: `Search the Web for ${quoted(selection)}`, accelerator: PAGE_SHORTCUTS.searchWeb });
    if (canFind) entries.push({ action: 'find', label: `Find ${quoted(selection)} in Page`, accelerator: PAGE_SHORTCUTS.findSelection });
    entries.push({ action: 'search-app', label: `Search Hermes for ${quoted(selection)}`, accelerator: PAGE_SHORTCUTS.searchApp });
  } else {
    if (canFind) entries.push({ action: 'find', label: 'Find in Page…', accelerator: PAGE_SHORTCUTS.find });
    entries.push({ action: 'search-app', label: 'Search Hermes…', accelerator: PAGE_SHORTCUTS.searchApp });
  }
  return entries;
}
