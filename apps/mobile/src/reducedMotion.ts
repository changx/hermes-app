import { AccessibilityInfo } from 'react-native';

const listeners = new Set<(value: boolean) => void>();
let reduced = true; // Conservative until the current system preference arrives.
let generation = 0;
let subscription: ReturnType<typeof AccessibilityInfo.addEventListener> | undefined;

/** One native listener/query for all active sending-color consumers. */
export function subscribeReducedMotion(listener: (value: boolean) => void): () => void {
  listeners.add(listener);
  if (!subscription) {
    const owner = ++generation;
    let changed = false;
    subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      changed = true; reduced = value;
      for (const notify of listeners) notify(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (owner !== generation || changed) return;
      reduced = value; for (const notify of listeners) notify(value);
    }).catch(() => {});
  }
  listener(reduced);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { subscription?.remove(); subscription = undefined; reduced = true; ++generation; }
  };
}
