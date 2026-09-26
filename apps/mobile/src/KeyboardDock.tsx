import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Dimensions, Keyboard, Platform, View } from 'react-native';
import type { KeyboardEvent } from 'react-native';
import { keyboardFrameAfter, keyboardInset, type KeyboardRect, type WindowRect } from './keyboardLayout';

// Only the chat region is shortened; the header is never a keyboard accessory.
// Android's native adjustResize owns the inset there (no second JS adjustment).
export function KeyboardDock({ children }: { children: (keyboardMoving: boolean) => React.ReactNode }) {
  const root = useRef<View>(null);
  const view = useRef<WindowRect | null>(null);
  const frame = useRef<KeyboardRect | null>(null);
  const active = useRef(AppState.currentState === 'active');
  const reduced = useRef(false);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [inset, setInset] = useState(0);
  const insetRef = useRef(0);
  const [moving, setMoving] = useState(false);
  const screenHeight = () => Dimensions.get('screen').height;
  const apply = useCallback((event?: KeyboardEvent) => {
    const next = active.current ? keyboardInset(view.current, frame.current, screenHeight()) : 0;
    if (next === insetRef.current) return;
    if (event && !reduced.current) Keyboard.scheduleLayoutAnimation(event);
    insetRef.current = next;
    setInset(next);
  }, []);
  const measure = useCallback(() => {
    const token = ++generation.current;
    root.current?.measureInWindow((_x, y, _width, height) => {
      if (token !== generation.current) return;
      view.current = height > 0 ? { y, height } : null;
      apply();
    });
  }, [apply]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) reduced.current = value; }).catch(() => {});
    const accessibility = AccessibilityInfo.addEventListener('reduceMotionChanged', value => { reduced.current = value; });
    const stopMotion = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; setMoving(false); };
    const keyboardChange = (event: KeyboardEvent) => {
      frame.current = view.current
        ? keyboardFrameAfter('show', active.current, true, event.endCoordinates, view.current, screenHeight())
        : active.current ? event.endCoordinates : null;
      // During native keyboard motion, avoid an independent animated list scroll.
      stopMotion(); setMoving(true);
      timer.current = setTimeout(stopMotion, Math.max(100, event.duration ?? 0) + 50);
      apply(event);
      measure();
    };
    const keyboardHide = (event: KeyboardEvent) => {
      frame.current = null;
      stopMotion(); setMoving(true);
      timer.current = setTimeout(stopMotion, Math.max(100, event.duration ?? 0) + 50);
      apply(event);
      measure();
    };
    const subs = [
      Keyboard.addListener('keyboardWillShow', keyboardChange),
      Keyboard.addListener('keyboardWillChangeFrame', keyboardChange),
      Keyboard.addListener('keyboardWillHide', keyboardHide),
      AppState.addEventListener('change', state => {
        active.current = state === 'active';
        ++generation.current; // discard measurements begun before the transition
        if (!active.current) {
          frame.current = null; stopMotion(); apply();
        } else {
          // Never reuse the last willShow event after a background round trip.
          frame.current = keyboardFrameAfter('foreground', true, Keyboard.isVisible(), Keyboard.metrics() ?? null, view.current, screenHeight());
          apply(); measure();
        }
      })
    ];
    measure();
    return () => {
      mounted = false; ++generation.current;
      if (timer.current) clearTimeout(timer.current);
      accessibility.remove(); subs.forEach(s => s.remove());
    };
  }, [apply, measure]);

  return <View ref={root} onLayout={Platform.OS === 'ios' ? measure : undefined} style={{ flex: 1, paddingBottom: Platform.OS === 'ios' ? inset : 0 }}>
    {children(moving)}
  </View>;
}
