export interface WindowRect { y: number; height: number }
export interface KeyboardRect { screenY: number; height: number }

// Both coordinates are in the native window/screen coordinate space. The measured
// outer dock never includes its own padding, so recalculation cannot accumulate it.
export function keyboardInset(view: WindowRect | null, keyboard: KeyboardRect | null, screenHeight: number): number {
  if (!view || !keyboard || !Number.isFinite(screenHeight) || screenHeight <= 0 ||
      !Number.isFinite(view.y) || !Number.isFinite(view.height) || view.height <= 0 ||
      !Number.isFinite(keyboard.screenY) || !Number.isFinite(keyboard.height) || keyboard.height <= 0 ||
      keyboard.screenY <= 0 || keyboard.screenY >= screenHeight ||
      // A docked keyboard can slide *below* the screen during interactive dismiss.
      // Floating/undocked frames ending well above the screen do not own the dock.
      keyboard.screenY + keyboard.height < screenHeight - 24) return 0;
  const bottom = view.y + view.height;
  if (bottom <= view.y || bottom > screenHeight + 1 || keyboard.screenY <= view.y) return 0;
  return Math.min(view.height, Math.max(0, bottom - keyboard.screenY));
}

// A background frame must never survive foregrounding. A foreground metric is
// only a candidate when native Keyboard still reports the keyboard as visible.
export function keyboardFrameAfter(
  state: 'background' | 'foreground' | 'show' | 'hide',
  active: boolean,
  visible: boolean,
  frame: KeyboardRect | null,
  view: WindowRect | null,
  screenHeight: number
): KeyboardRect | null {
  if (state === 'background' || state === 'hide' || !active || (state === 'foreground' && !visible)) return null;
  return keyboardInset(view, frame, screenHeight) > 0 ? frame : null;
}
