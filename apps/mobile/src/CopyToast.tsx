import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';
import { getDefaultHeaderHeight } from 'expo-router/react-navigation';
import * as Clipboard from 'expo-clipboard';
import { Text } from './FontSize';
import { subscribeReducedMotion } from './reducedMotion';

export const COPY_TOAST_MS = 1400;
type Notice = { id: number; text: string };
const listeners = new Set<(notice: Notice) => void>();
let sequence = 0;

/** Show one short app-wide confirmation. A newer notice replaces the current one. */
export function showCopyToast(text: string) {
  const notice = { id: ++sequence, text };
  for (const listener of listeners) listener(notice);
}

/** Copy text and confirm the actual clipboard result with the toast. */
export async function copyWithToast(value: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(value);
    showCopyToast('Copied to clipboard');
    return true;
  } catch {
    showCopyToast('Could not copy to the clipboard');
    return false;
  }
}

/** Mounted once above the Stack. Sits just below the navigation bar and never takes touches. */
export function CopyToast() {
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  const [notice, setNotice] = useState<Notice | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const reduced = useRef(true);
  useEffect(() => subscribeReducedMotion(value => { reduced.current = value; }), []);
  useEffect(() => {
    const listener = (next: Notice) => setNotice(next);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  useEffect(() => {
    if (!notice) return;
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(notice.text);
    opacity.stopAnimation();
    if (reduced.current) opacity.setValue(1);
    else Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      if (reduced.current) { opacity.setValue(0); setNotice(current => current?.id === notice.id ? null : current); return; }
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setNotice(current => current?.id === notice.id ? null : current);
      });
    }, COPY_TOAST_MS);
    return () => clearTimeout(timer);
  }, [notice, opacity]);
  if (!notice) return null;
  const top = getDefaultHeaderHeight(frame, false, insets.top) + 8;
  return <View pointerEvents="none" style={[styles.position, { top }]}>
    <Animated.View accessible accessibilityRole="text" accessibilityLiveRegion="polite" accessibilityLabel={notice.text} style={[styles.toast, { opacity }]}>
      <Text accessible={false} style={styles.text}>{notice.text}</Text>
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  position: { position: 'absolute', left: 16, right: 16, zIndex: 1001, elevation: 21, alignItems: 'center' },
  toast: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: 'rgba(30, 41, 59, 0.92)' },
  text: { fontSize: 13, color: '#ffffff', textAlign: 'center' },
});
