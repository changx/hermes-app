import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, StyleSheet, View } from 'react-native';
import { Text } from './FontSize';
import type { Interaction, Receipt } from '../../../packages/client/src/index';
import { isReceiptRunning } from './receiptState';

export function isAgentTyping(threadId: string, receipts: readonly Receipt[], interactions: readonly Interaction[], online: boolean): boolean {
  return online && receipts.some(receipt => receipt.thread_id === threadId && isReceiptRunning(receipt)
    && !interactions.some(item => item.thread_id === threadId && item.receipt_id === receipt.id && item.state === 'pending'));
}

/** Only mounted for authoritative active work, never simulated stream progress. */
export function TypingIndicator({ active, name = '' }: { active: boolean; name?: string }) {
  const dots = useRef([new Animated.Value(0.6), new Animated.Value(0.6), new Animated.Value(0.6)]).current;
  const [reduced, setReduced] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduced(value); }).catch(() => {});
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    const app = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => { alive = false; motion.remove(); app.remove(); };
  }, []);
  useEffect(() => {
    dots.forEach(dot => dot.setValue(0.6));
    if (!active || reduced || !foreground) return;
    const loop = Animated.loop(Animated.sequence(dots.map(dot => Animated.sequence([
      Animated.timing(dot, { toValue: 1, duration: 180, useNativeDriver: true, isInteraction: false }),
      Animated.timing(dot, { toValue: 0.6, duration: 180, useNativeDriver: true, isInteraction: false }),
    ]))));
    loop.start();
    return () => { loop.stop(); dots.forEach(dot => { dot.stopAnimation(); dot.setValue(0.6); }); };
  }, [active, reduced, foreground, dots]);
  if (!active || !foreground) return null;
  const label = `${name.trim() || 'Agent'} is running`;
  return <View style={styles.status} accessibilityLabel={label} accessibilityLiveRegion="polite" pointerEvents="none">
    <View style={styles.dots} accessible={false}>{dots.map((scale, index) =>
      <Animated.View key={index} style={[styles.dot, { transform: [{ scale }] }]} />)}</View>
    <Text style={styles.text} numberOfLines={1}>{label}</Text>
  </View>;
}
const styles = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 3, width: 24 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#748296' },
  text: { color: '#607187', fontSize: 12, flexShrink: 1 },
});
