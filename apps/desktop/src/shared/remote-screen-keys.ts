/**
 * Mac keyboard shortcuts on the remote Linux screen (docs/remote-screen.md). Cmd is not
 * sent; Cmd+letter becomes Ctrl+letter, and Cmd+arrows move like they do on a Mac.
 */

export const CONTROL_L = 0xffe3;

export type RemoteShortcut = Readonly<{ keysym: number; code: string; ctrl: boolean; paste: boolean }>;

const ARROWS: Readonly<Record<string, RemoteShortcut>> = {
  ArrowLeft: { keysym: 0xff50, code: 'Home', ctrl: false, paste: false },
  ArrowRight: { keysym: 0xff57, code: 'End', ctrl: false, paste: false },
  ArrowUp: { keysym: 0xff50, code: 'Home', ctrl: true, paste: false },
  ArrowDown: { keysym: 0xff57, code: 'End', ctrl: true, paste: false },
};

/**
 * `undefined`: not a Mac shortcut, let noVNC send the key. `null`: swallow the key (Cmd itself).
 * Otherwise the key to send instead.
 */
export function macShortcut(event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey'>): RemoteShortcut | null | undefined {
  if (event.key === 'Meta' || event.code === 'MetaLeft' || event.code === 'MetaRight') return null;
  if (!event.metaKey || event.ctrlKey || event.altKey) return undefined;
  const arrow = ARROWS[event.code];
  if (arrow) return arrow;
  // The layout's letter wins (Cmd+V on Dvorak is the key that types v), then the physical key.
  const letter = (/^[a-z]$/i.test(event.key) ? event.key : /^Key([A-Z])$/.exec(event.code)?.[1])?.toLowerCase();
  if (letter) return { keysym: letter.charCodeAt(0), code: `Key${letter.toUpperCase()}`, ctrl: true, paste: letter === 'v' };
  const digit = /^Digit([0-9])$/.exec(event.code)?.[1];
  if (digit) return { keysym: digit.charCodeAt(0), code: event.code, ctrl: true, paste: false };
  return null;
}
