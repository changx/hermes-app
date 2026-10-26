/** Main window title: the active tab's title on one line (at most 200 characters), or "Hermes". */
export const windowTitle = (title: string | undefined): string => [...(title ?? '').replace(/\s+/g, ' ').trim()].slice(0, 200).join('') || 'Hermes';
