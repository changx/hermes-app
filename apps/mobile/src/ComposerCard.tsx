import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Animated, { Easing, LinearTransition, ReduceMotion, withTiming } from 'react-native-reanimated';
import type { LayoutAnimationsValues } from 'react-native-reanimated';
import { Text } from './FontSize';

/** ChatGPT-style input card (measured from Jamie's iPhone screenshots).
 * Collapsed (not focused): one 48pt pill; `+` on the left and a 32pt round
 * Send on the right sit inside the pill, the text line between them.
 * Expanded (focused): the text line spans the card and the tool row (`+` … Send)
 * is below it. The card keeps the same width in both states.
 * The field and its TextInput keep one tree position in both states, so a
 * focus change never remounts or refocuses the native input.
 * Focus changes and line wraps animate the card frame (bottom edge fixed),
 * the text and the tool row; reduced motion applies the new frame at once.
 */
export function ComposerCard({ expanded, leading, send, onPressField, onLayout, children }: {
  expanded: boolean; leading?: React.ReactNode; send: React.ReactNode;
  onPressField: () => void; onLayout?: (event: LayoutChangeEvent) => void; children: React.ReactNode;
}) {
  return <Animated.View testID="composer-card" layout={cardTransition} style={s.card} onLayout={onLayout}>
    <Pressable accessible={false} focusable={false} onPress={onPressField}
      style={[s.field, expanded ? s.fieldExpanded : leading ? s.fieldCollapsed : s.fieldCollapsedPlain]}>
      <Animated.View testID="composer-text" layout={partTransition}>{children}</Animated.View>
    </Pressable>
    <Animated.View testID="composer-tools" layout={partTransition} pointerEvents="box-none" style={[s.tools, !expanded && s.toolsCollapsed]}>
      {leading ?? <View />}
      {send}
    </Animated.View>
  </Animated.View>;
}

const MOTION = { duration: 220, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System };
const partTransition = LinearTransition.duration(MOTION.duration).easing(MOTION.easing).reduceMotion(MOTION.reduceMotion);
/** The dock places the card at its final position at once. Start from the old
 * height on the same bottom edge, so the card grows upward, not over the keyboard. */
function cardTransition(values: LayoutAnimationsValues) {
  'worklet';
  return {
    initialValues: {
      originX: values.currentOriginX, width: values.currentWidth, height: values.currentHeight,
      originY: values.targetOriginY + values.targetHeight - values.currentHeight,
    },
    animations: {
      originX: withTiming(values.targetOriginX, MOTION), width: withTiming(values.targetWidth, MOTION),
      originY: withTiming(values.targetOriginY, MOTION), height: withTiming(values.targetHeight, MOTION),
    },
  };
}

export function ComposerSendButton({ disabled, onPress, hint, busy = false }: { disabled: boolean; onPress: () => void; hint?: string; busy?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="Send" accessibilityHint={hint} accessibilityState={{ disabled, busy }}
    disabled={disabled} onPress={onPress} hitSlop={6} style={[s.send, disabled && s.sendDisabled]}>
    <Text style={s.sendArrow}>↑</Text>
  </Pressable>;
}

const TOOL_ROW = 46;
const s = StyleSheet.create({
  // One width in both states: only the height and inner layout change on focus.
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 24, marginTop: 6, marginBottom: 8, marginHorizontal: 12, boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)' },
  // Center the content-sized native input; never fix the UITextView height.
  field: { minWidth: 0, justifyContent: 'center' },
  fieldCollapsed: { minHeight: TOOL_ROW, paddingVertical: 12, paddingLeft: 46, paddingRight: 46 },
  fieldCollapsedPlain: { minHeight: TOOL_ROW, paddingVertical: 12, paddingLeft: 16, paddingRight: 46 },
  fieldExpanded: { minHeight: 40, paddingTop: 14, paddingBottom: 4, paddingHorizontal: 16 },
  tools: { height: TOOL_ROW, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6 },
  // Collapsed: overlay the single text line; the middle passes touches to the field.
  toolsCollapsed: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  send: { width: 32, height: 32, borderRadius: 16, marginRight: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1f2329' },
  sendDisabled: { backgroundColor: '#d7d7d9' },
  sendArrow: { color: '#fff', fontSize: 18, lineHeight: 22, fontWeight: '700' },
});
