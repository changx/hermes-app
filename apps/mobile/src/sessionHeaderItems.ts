import { TODO_COLOR } from './todoColor.ts';

export type SessionHeaderButtons = { onPress: () => void; todo?: { on: boolean; busy: boolean; onPress: () => void } };

const TINT = '#2b4e81';

/**
 * iOS header buttons of the Session page as native bar button items.
 * iOS 26+ treats a tap in the navigation bar as scroll-to-top unless a UIControl
 * is under the touch. A React Pressable is not a UIControl, so a press on it also
 * scrolled the transcript to the top. Native UIBarButtonItems are excluded.
 * Android has no such gesture and keeps the Pressable headerRight.
 */
export function sessionHeaderItems({ onPress, todo }: SessionHeaderButtons) {
  const items = [];
  if (todo) {
    const label = todo.on ? 'Remove todo' : 'Mark as todo';
    items.push({ type: 'button' as const, label, accessibilityLabel: label, disabled: todo.busy, onPress: todo.onPress,
      icon: { type: 'sfSymbol' as const, name: todo.on ? 'flag.fill' as const : 'flag' as const }, tintColor: todo.on ? TODO_COLOR : TINT });
  }
  items.push({ type: 'button' as const, label: 'Session options', accessibilityLabel: 'Session options', onPress,
    icon: { type: 'sfSymbol' as const, name: 'ellipsis' as const }, tintColor: TINT });
  return items;
}
