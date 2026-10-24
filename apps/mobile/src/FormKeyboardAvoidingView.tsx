import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Keyboard, LayoutAnimation, Platform, StyleSheet, View, type KeyboardEvent, type KeyboardMetrics, type LayoutChangeEvent, type LayoutRectangle } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useKeyboardState } from 'react-native-keyboard-controller';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * A keyboard frame that a form can use: sent while the App is in the
 * foreground, with a real size and position. Some third-party iOS keyboards
 * send keyboardWillShow with screenY, width and height 0 while the App is in
 * the background. RN KeyboardAvoidingView then pads the form by almost the
 * full screen, and the keyboard stays open on return, so no later event
 * corrects it. See docs/form-keyboard-background-events.md.
 */
export function usableKeyboardFrame(frame: KeyboardMetrics | null | undefined, appState: string | null | undefined): frame is KeyboardMetrics {
  return appState === 'active' && !!frame
    && [frame.screenY, frame.width, frame.height].every(value => Number.isFinite(value) && value > 0);
}

/** Same displacement as RN KeyboardAvoidingView `padding`: the form bottom part covered by the keyboard. */
export function formKeyboardPadding(layout: LayoutRectangle | null, keyboard: KeyboardMetrics | null, verticalOffset: number): number {
  if (!layout || !keyboard) return 0;
  return Math.max(layout.y + layout.height - (keyboard.screenY - verticalOffset), 0);
}

/**
 * Form pages: bottom padding for the keyboard, only while the page is focused
 * and the keyboard is visible. Retained forms explicitly return to zero
 * padding. The hidden-header home route still starts below the top
 * safe-area inset. Keyboard frames that fail `usableKeyboardFrame` are
 * ignored; the form keeps the last usable frame. A hide always applies.
 */
export function FormKeyboardAvoidingView({ children }: { children: React.ReactNode }) {
  const focused = useIsFocused();
  const keyboardVisible = useKeyboardState(state => state.isVisible);
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const offset = Math.max(headerHeight, insets.top);
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const layout = useRef<LayoutRectangle | null>(null);
  const keyboard = useRef<KeyboardMetrics | null>(null);
  const bottomRef = useRef(0);
  const [bottom, setBottom] = useState(0);

  const update = useCallback((event?: KeyboardEvent | null) => {
    const next = formKeyboardPadding(layout.current, keyboard.current, offsetRef.current);
    if (next === bottomRef.current) return;
    bottomRef.current = next;
    if (event?.duration && event.easing) {
      const duration = Math.max(event.duration, 10);
      LayoutAnimation.configureNext({ duration, update: { duration, type: LayoutAnimation.Types[event.easing] ?? 'keyboard' } });
    }
    setBottom(next);
  }, []);

  useEffect(() => {
    const current = Keyboard.isVisible() ? Keyboard.metrics() : null;
    if (usableKeyboardFrame(current, AppState.currentState)) { keyboard.current = current; update(); }
    const onShow = (event: KeyboardEvent) => {
      if (!usableKeyboardFrame(event?.endCoordinates, AppState.currentState)) return;
      keyboard.current = event.endCoordinates;
      update(event);
    };
    const onHide = (event: KeyboardEvent) => { keyboard.current = null; update(event); };
    const subscriptions = Platform.OS === 'ios'
      ? [Keyboard.addListener('keyboardWillHide', onHide), Keyboard.addListener('keyboardWillShow', onShow)]
      : [Keyboard.addListener('keyboardDidHide', onHide), Keyboard.addListener('keyboardDidShow', onShow)];
    return () => subscriptions.forEach(subscription => subscription.remove());
  }, [update]);

  useEffect(() => { update(); }, [offset, update]);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout;
    const changed = !layout.current || layout.current.height !== next.height || layout.current.y !== next.y;
    layout.current = next;
    if (changed) update();
  }, [update]);

  return <View style={[styles.flex, { paddingBottom: focused && keyboardVisible ? bottom : 0 }]} onLayout={onLayout}>
    {children}
  </View>;
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
