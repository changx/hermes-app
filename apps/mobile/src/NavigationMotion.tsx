import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View } from 'react-native';

const EDGE = 24;
const START = 12;
const DURATION = 230;

type Props = {
  pageKey: string;
  direction: 'forward' | 'back';
  children: React.ReactNode;
  backPage?: React.ReactNode;
  canBack?: () => boolean;
  onBack?: () => void;
  onSettled?: () => void;
};

/** Animate one live page only: cloning outgoing chat trees would rerun effects.
 * Capture edge gestures on the ancestor, never with an overlay over the list. */
export function NavigationMotion({ pageKey, direction, children, backPage, canBack, onBack, onSettled }: Props) {
  const x = useRef(new Animated.Value(0)).current;
  const root = useRef<View>(null);
  const left = useRef(0), width = useRef(320);
  const reduced = useRef(false);
  const [preview, setPreview] = useState(false);
  const current = useRef(pageKey);
  const active = useRef(false), blocked = useRef(false), animating = useRef(false);
  const skipNext = useRef(false), generation = useRef(0), mounted = useRef(true);
  const onBackRef = useRef(onBack), canBackRef = useRef(canBack), settledRef = useRef(onSettled);
  onBackRef.current = onBack; canBackRef.current = canBack; settledRef.current = onSettled;
  const start = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    mounted.current = true;
    let live = true, changed = false;
    const update = (value: boolean) => {
      reduced.current = value;
      if (value && (active.current || animating.current)) {
        const hadTransition = animating.current;
        ++generation.current; active.current = false; animating.current = false;
        x.stopAnimation(); x.setValue(0); setPreview(false);
        if (hadTransition) settledRef.current?.();
      }
    };
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (live && !changed) update(value); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', value => { changed = true; update(value); });
    return () => { live = false; mounted.current = false; ++generation.current; x.stopAnimation(); sub.remove(); };
  }, [x]);

  useLayoutEffect(() => {
    if (pageKey === current.current) return;
    current.current = pageKey;
    const token = ++generation.current;
    active.current = false; blocked.current = false;
    x.stopAnimation(); setPreview(false);
    if (skipNext.current || reduced.current) {
      skipNext.current = false; animating.current = false; x.setValue(0); settledRef.current?.(); return;
    }
    animating.current = true;
    // The previous page is deliberately not remounted for decoration.
    x.setValue(direction === 'back' ? -width.current * 0.25 : width.current);
    Animated.timing(x, { toValue: 0, duration: DURATION, useNativeDriver: true }).start(() => {
      if (!mounted.current || generation.current !== token) return;
      animating.current = false; x.setValue(0); settledRef.current?.();
    });
  }, [pageKey, direction, x]);

  // The route layout effect consumes successful swipes first; a declined back
  // cannot suppress a later unrelated forward animation.
  useEffect(() => { skipNext.current = false; });

  const cancel = () => {
    if (!active.current) return;
    active.current = false;
    const token = ++generation.current;
    if (reduced.current) { x.setValue(0); setPreview(false); return; }
    animating.current = true;
    Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start(() => {
      if (!mounted.current || generation.current !== token) return;
      animating.current = false; x.setValue(0); setPreview(false);
    });
  };
  const touches = (event: any) => event.nativeEvent.touches?.length ?? 0;
  const origin = (e: any) => e.nativeEvent.touches?.[0] ?? e.nativeEvent;
  const startTouch = (e: any) => {
    const touch = origin(e), localX = touch.pageX - left.current;
    blocked.current = touches(e) !== 1 || localX < 0 || localX > EDGE;
    start.current = { x: touch.pageX, y: touch.pageY };
    return false;
  };
  const shouldMove = (e: any) => {
    if (blocked.current || touches(e) !== 1 || !start.current || animating.current || !onBackRef.current || !canBackRef.current?.()) {
      if (touches(e) !== 1) blocked.current = true;
      return false;
    }
    const touch = origin(e), dx = touch.pageX - start.current.x, dy = touch.pageY - start.current.y;
    if (Math.abs(dy) > START && Math.abs(dy) >= Math.abs(dx)) { blocked.current = true; return false; }
    return dx > START && dx > Math.abs(dy) * 1.3;
  };
  const move = (e: any) => {
    if (!active.current) return;
    if (touches(e) !== 1 || !canBackRef.current?.()) { cancel(); blocked.current = true; return; }
    if (!reduced.current) x.setValue(Math.max(0, Math.min(width.current, origin(e).pageX - (start.current?.x ?? 0))));
  };
  const release = (e: any) => {
    if (!active.current) return;
    if (touches(e) > 1 || blocked.current || !canBackRef.current?.()) { cancel(); return; }
    const dx = origin(e).pageX - (start.current?.x ?? 0);
    if (dx < Math.max(55, width.current * 0.3)) { cancel(); return; }
    if (reduced.current) { active.current = false; onBackRef.current?.(); return; }
    active.current = false; animating.current = true;
    const token = ++generation.current;
    Animated.timing(x, { toValue: width.current, duration: DURATION, useNativeDriver: true }).start(({ finished }) => {
      if (!mounted.current || generation.current !== token) return;
      animating.current = false;
      if (finished && canBackRef.current?.()) { skipNext.current = true; onBackRef.current?.(); }
      // A synchronous parent decline must never leave an invisible page.
      x.setValue(0); setPreview(false);
    });
  };

  return <View ref={root} style={s.root} onLayout={e => {
    width.current = e.nativeEvent.layout.width || width.current;
    root.current?.measureInWindow(px => { left.current = px; });
  }} onStartShouldSetResponderCapture={startTouch} onMoveShouldSetResponderCapture={shouldMove}
    onResponderGrant={e => { if (touches(e) !== 1 || blocked.current || animating.current || !canBackRef.current?.()) return; active.current = true; x.stopAnimation(); if (!reduced.current) setPreview(true); move(e); }}
    onResponderStart={e => { if (touches(e) !== 1) { blocked.current = true; cancel(); } }}
    onResponderMove={move} onResponderRelease={release} onResponderTerminate={cancel}>
    {preview && backPage && <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.layer}>{backPage}</View>}
    <Animated.View style={[s.fill, { transform: [{ translateX: x }] }]}>{children}</Animated.View>
  </View>;
}
const s = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', backgroundColor: '#f8fafc' },
  fill: { flex: 1, backgroundColor: '#f8fafc' },
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#f8fafc' },
});
