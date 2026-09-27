import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ScrollViewProps } from 'react-native';
import { KeyboardChatScrollView, KeyboardGestureArea, KeyboardStickyView, useKeyboardHandler } from 'react-native-keyboard-controller';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Interaction, Receipt } from '../../../packages/client/src/index';
import { appendedAtEnd, scrollStateFromEvent, scrollToExactEnd, shouldFollowContentChange, type ScrollGeometry, type TimelinePosition, type TimelineRow } from './timeline';
import { MessageContent } from './MessageContent';
import { messageNeedsViewport } from './messageMarkdown';


const action = (title: string, onPress: () => void, disabled = false, muted = false) => <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress} style={[styles.action, muted && styles.muted, disabled && styles.disabled]}><Text style={[styles.actionText, muted && styles.mutedText]}>{title}</Text></Pressable>;

const MessageRow = memo(function MessageRow({ row, onCancel, busy }: { row: TimelineRow; onCancel: (receipt: Receipt) => void; busy: boolean }) {
  const own = row.role === 'user';
  const needsViewport = useMemo(() => own && messageNeedsViewport(row.text), [own, row.text]);
  const content = <View style={own ? [styles.bubble, styles.own, needsViewport && styles.ownViewport] : row.role === 'assistant' ? styles.agentMessage : styles.bubble}>
    <Text style={styles.byline}>{own ? '我' : row.role === 'assistant' ? 'Hermes' : '消息'}{!row.optimistic && !row.refSeq ? ' · 草稿' : ''}</Text>
    <MessageContent text={row.text} canExpand={row.role === 'assistant'} pending={own && !!row.optimistic && row.status !== 'accepted'} />
    {!!row.sendError && <Text accessibilityLiveRegion="polite" style={styles.sendError}>{row.sendError}</Text>}
    {row.attachments?.map(a => <Text key={a.id} style={styles.attachment}>附件：{a.name || '未命名附件'}（{a.state === 'available' ? '可查看' : '暂时无法查看'}）</Text>)}
    {row.reactionSlot && <View style={styles.reactionSlot} accessibilityLabel={row.reaction?.label}>
      {row.reaction && <Text style={styles.reactionText}>{row.reaction.emoji} {row.reaction.label}</Text>}
      {row.receipt?.state === 'queued' && <Pressable accessibilityRole="button" accessibilityLabel="取消排队" disabled={busy} hitSlop={8} onPress={() => onCancel(row.receipt!)}><Text style={styles.cancelText}>取消</Text></Pressable>}
    </View>}
  </View>;
  return own ? <View style={styles.userMessageRow}>{content}</View> : content;
}, (prev, next) => prev.busy === next.busy && prev.onCancel === next.onCancel && prev.row.receipt?.state === next.row.receipt?.state && prev.row.key === next.row.key && prev.row.text === next.row.text && prev.row.status === next.row.status && prev.row.optimistic === next.row.optimistic && prev.row.refSeq === next.row.refSeq && prev.row.reactionSlot === next.row.reactionSlot && prev.row.reaction?.label === next.row.reaction?.label && prev.row.sendError === next.row.sendError && prev.row.attachments === next.row.attachments);

export interface ChatTimelineHandle { followLatest(animate?: boolean): void; holdPosition(): void }
interface Props {
  threadId: string;
  rows: TimelineRow[];
  startRef: number | null;
  hasOlder: boolean;
  onOlder(): void;
  locatingMessage?: string;
  onLocateNext?: () => void;
  locatingBusy?: boolean;
  position?: TimelinePosition;
  onPosition(position: TimelinePosition): void;
  onVisibleRef(ref: number): void;
  text: string;
  onText(value: string): void;
  onSend(): void;

  receipts: Receipt[];
  interactions: Interaction[];
  answers: Record<string, string>;
  onAnswerText(id: string, value: string): void;
  onAnswer(item: Interaction, choice: string): void;
  onCancel(receipt: Receipt): void;
  onStop(): void;
  busy: boolean;
}
export const ChatTimeline = forwardRef<ChatTimelineHandle, Props>(function ChatTimeline(props, ref) {
  const { rows, startRef, position, onPosition, onVisibleRef } = props;
  const { bottom } = useSafeAreaInsets();
  const dockHeight = useRef(0);
  const [composerHeight, setComposerHeight] = useState(0);
  const composerID = `composer-${props.threadId}`;
  const reportedInset = useRef(0);
  const onContentInsetChange = useCallback((insets: { bottom: number }) => { reportedInset.current = insets.bottom; }, []);
  const renderScrollComponent = useCallback((scrollProps: ScrollViewProps) =>
    <KeyboardChatScrollView {...scrollProps} automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never"
      offset={bottom} keyboardLiftBehavior="whenAtEnd" onContentInsetChange={onContentInsetChange} />,
  [bottom, onContentInsetChange]);
  const list = useRef<FlatList<TimelineRow>>(null);
  const following = useRef(position?.following ?? true);
  const [showLatest, setShowLatest] = useState(!following.current);
  const offset = useRef(position?.offset ?? 0);
  const viewport = useRef(0), content = useRef(0), dragging = useRef(false), gestureMomentum = useRef(false), momentumEligible = useRef(false);
  const keyboardMoving = useRef(false);
  const nativeMoving = useSharedValue(false);
  const scrollGeometry = useRef<ScrollGeometry | null>(null);
  const restored = useRef(false);
  const reducedMotion = useRef(false);
  const previousKeys = useRef<string[]>([]);
  const appended = useRef(false);
  const nextKeys = rows.map(row => row.key);
  if (nextKeys.length !== previousKeys.current.length || nextKeys.some((key, i) => key !== previousKeys.current[i])) {
    appended.current = appendedAtEnd(previousKeys.current, nextKeys);
    previousKeys.current = nextKeys;
  }
  const frame = useRef<number | null>(null);
  const followAnimation = useRef(false);
  const pendingFollow = useRef(false);
  const animatingFollow = useRef(false);
  const scheduleFollow = useCallback((animate = false) => {
    // Geometry corrections must not turn a queued/ongoing append into a jump.
    if (animate) followAnimation.current = true;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (!following.current || dragging.current || gestureMomentum.current || momentumEligible.current) {
        pendingFollow.current = false;
        followAnimation.current = false;
        return;
      }
      if (keyboardMoving.current) { pendingFollow.current = true; return; }
      pendingFollow.current = false;
      const animated = (followAnimation.current || animatingFollow.current) && !reducedMotion.current;
      followAnimation.current = false;
      if (scrollToExactEnd(list.current, content.current, viewport.current, animated, scrollGeometry.current?.inset ?? reportedInset.current)) {
        animatingFollow.current = animated;
      }
    });
  }, []);
  const setKeyboardMoving = useCallback((moving: boolean) => {
    keyboardMoving.current = moving;
    if (!moving && pendingFollow.current) scheduleFollow();
  }, [scheduleFollow]);
  useKeyboardHandler({
    onStart: () => { 'worklet'; if (!nativeMoving.value) { nativeMoving.value = true; runOnJS(setKeyboardMoving)(true); } },
    onInteractive: () => { 'worklet'; if (!nativeMoving.value) { nativeMoving.value = true; runOnJS(setKeyboardMoving)(true); } },
    onEnd: () => { 'worklet'; nativeMoving.value = false; runOnJS(setKeyboardMoving)(false); }
  }, [setKeyboardMoving]);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) reducedMotion.current = value; }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', value => { reducedMotion.current = value; });
    const app = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        keyboardMoving.current = false; nativeMoving.value = false;
        pendingFollow.current = false; followAnimation.current = false; animatingFollow.current = false;
      }
    });
    return () => { mounted = false; sub.remove(); app.remove(); if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, []);
  const callbacks = useRef({ onPosition, onVisibleRef, startRef });
  callbacks.current = { onPosition, onVisibleRef, startRef };
  const savePosition = useCallback(() => callbacks.current.onPosition({ offset: offset.current, following: following.current, startRef: callbacks.current.startRef }), []);
  const followLatest = useCallback((animate = true) => {
    following.current = true; setShowLatest(false);
    // An explicit send/latest action overrides any older gesture momentum.
    dragging.current = false; gestureMomentum.current = false; momentumEligible.current = false;
    if (!animate) { followAnimation.current = false; animatingFollow.current = false; }
    if (keyboardMoving.current) scheduleFollow(animate);
    else {
      const animated = animate && !reducedMotion.current;
      if (scrollToExactEnd(list.current, content.current, viewport.current, animated, scrollGeometry.current?.inset ?? reportedInset.current)) {
        animatingFollow.current = animated;
      }
    }
    savePosition();
  }, [savePosition, scheduleFollow]);
  useImperativeHandle(ref, () => ({ followLatest, holdPosition() {
    following.current = false; pendingFollow.current = false; followAnimation.current = false; animatingFollow.current = false;
    setShowLatest(true); savePosition();
  } }), [followLatest, savePosition]);
  useEffect(() => { savePosition(); }, [startRef, savePosition]);
  const visible = useRef({ onVisibleRef });
  visible.current.onVisibleRef = onVisibleRef;
  const viewability = useRef(({ viewableItems }: { viewableItems: Array<{ item: TimelineRow }> }) => {
    const refs = viewableItems.map(v => v.item.refSeq).filter((v): v is number => v !== undefined);
    if (refs.length) visible.current.onVisibleRef(Math.max(...refs));
  });
  return <KeyboardGestureArea style={styles.flex} interpolator="ios" textInputNativeID={composerID} offset={composerHeight}>
    <View style={styles.flex}>
      <FlatList ref={list} style={styles.flex} data={rows} keyExtractor={item => item.key} renderItem={({ item }) => <MessageRow row={item} onCancel={props.onCancel} busy={props.busy} />}
        renderScrollComponent={renderScrollComponent}
        contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} alwaysBounceVertical={Platform.OS === 'ios'}
        initialNumToRender={14} maxToRenderPerBatch={10} windowSize={7} updateCellsBatchingPeriod={60}
        // Keep the native visible-item anchor stable across prepends. Do not
        // toggle it during programmatic follow/keyboard scrolling.
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        ListHeaderComponent={props.locatingMessage ? <View style={styles.older}><Text style={styles.locating}>{props.locatingMessage}</Text>
          {props.onLocateNext && action('继续查看', props.onLocateNext, props.locatingBusy, true)}</View>
          : props.hasOlder ? <View style={styles.older}>{action('查看更早消息', props.onOlder, props.busy, true)}</View> : null}
        ListEmptyComponent={props.locatingMessage ? null : <Text style={styles.empty}>暂无消息</Text>}
        onViewableItemsChanged={viewability.current}
        onLayout={e => {
          viewport.current = e.nativeEvent.layout.height;
          if (!restored.current && content.current) {
            restored.current = true;
            if (following.current) scheduleFollow();
            else list.current?.scrollToOffset({ offset: offset.current, animated: false });
          }
        }}
        onContentSizeChange={(_, height) => {
          const previous = content.current;
          content.current = height;
          if (!restored.current && viewport.current) {
            restored.current = true;
            if (following.current) scheduleFollow();
            else list.current?.scrollToOffset({ offset: offset.current, animated: false });
          } else if (!dragging.current && !gestureMomentum.current && !momentumEligible.current
            && (shouldFollowContentChange(following.current, false, previous, height) || following.current && appended.current && height > 0)
            && (!keyboardMoving.current || appended.current)) scheduleFollow(appended.current);
          appended.current = false;
        }}
        onScrollBeginDrag={() => { dragging.current = true; gestureMomentum.current = false; momentumEligible.current = false; animatingFollow.current = false; followAnimation.current = false; pendingFollow.current = false; }}
        onMomentumScrollBegin={() => { gestureMomentum.current = momentumEligible.current; momentumEligible.current = false; }}
        onScrollEndDrag={e => { dragging.current = false; momentumEligible.current = Math.abs(e.nativeEvent.velocity?.y ?? 0) > 0.01; savePosition(); }}
        onMomentumScrollEnd={() => { gestureMomentum.current = false; momentumEligible.current = false; animatingFollow.current = false; savePosition(); }}
        onScroll={e => {
          const state = scrollStateFromEvent(following.current, offset.current, scrollGeometry.current, e.nativeEvent,
            (dragging.current || gestureMomentum.current) && !keyboardMoving.current, reportedInset.current);
          offset.current = state.offset;
          viewport.current = state.geometry.viewport; content.current = state.geometry.height;
          scrollGeometry.current = state.geometry;
          if (state.following !== following.current) { following.current = state.following; setShowLatest(!state.following); }
          savePosition();
        }} scrollEventThrottle={16} />

    </View>
    <KeyboardStickyView offset={{ opened: bottom }} onLayout={e => {
      const height = e.nativeEvent.layout.height;
      if (dockHeight.current !== height) {
        const hadDock = dockHeight.current > 0;
        dockHeight.current = height;
        // A growing composer/controls shrinks the flex list; only follow if already at latest.
        if (hadDock && restored.current && following.current && !keyboardMoving.current) scheduleFollow();
      }
    }}>
    {!!props.interactions.length && <ScrollView style={styles.interactions} keyboardShouldPersistTaps="handled">{props.interactions.map(i => <View key={i.id} style={styles.interaction}>
      <Text style={styles.controlText}>{i.kind === 'approval' ? '请确认' : '请回答'} · {i.prompt}</Text>
      <View style={styles.controlRow}>{i.choices.map(choice => <React.Fragment key={choice}>{action(choice, () => props.onAnswer(i, choice), props.busy, true)}</React.Fragment>)}</View>
      {i.kind === 'clarify' && i.choices.length === 0 && <View style={styles.controlRow}>
        <TextInput accessibilityLabel="你的回答" style={[styles.input, styles.flex]} value={props.answers[i.id] || ''} onChangeText={value => props.onAnswerText(i.id, value)} />
        {action('提交回答', () => props.onAnswer(i, (props.answers[i.id] || '').trim()), props.busy || !props.answers[i.id]?.trim())}
      </View>}
    </View>)}</ScrollView>}

    <View style={styles.composer} onLayout={e => setComposerHeight(e.nativeEvent.layout.height)}><TextInput nativeID={composerID} accessibilityLabel="消息内容" multiline style={[styles.input, styles.composeInput]} placeholder="输入消息…" value={props.text} onChangeText={props.onText} />
      {showLatest && <Pressable accessibilityRole="button" accessibilityLabel="回到最新 ↓" onPress={() => followLatest()} style={styles.latest}>
        <Text style={styles.latestText}>↓</Text>
      </Pressable>}
      {props.receipts.some(r => r.thread_id === props.threadId && r.state === 'running')
        ? action('停止', props.onStop, props.busy)
        : action('发送', props.onSend, props.busy || !props.text.trim())}
    </View>
    </KeyboardStickyView>
  </KeyboardGestureArea>;
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Keep the real content height: growing short content to the viewport makes
  // the keyboard controller scroll empty space and push top-aligned rows away.
  messages: { paddingVertical: 12 },
  agentMessage: { alignSelf: 'stretch', minWidth: 0, marginHorizontal: 14, marginVertical: 5 },
  userMessageRow: { alignSelf: 'stretch', minWidth: 0, marginHorizontal: 14 },
  bubble: { backgroundColor: '#fff', padding: 13, marginHorizontal: 14, marginVertical: 5, borderRadius: 16, borderTopLeftRadius: 4, maxWidth: '90%', alignSelf: 'flex-start', borderWidth: 1, borderColor: '#e3e9f0' },
  own: { maxWidth: '80%', marginHorizontal: 0, backgroundColor: '#e6f0ff', borderColor: '#d0e2fb', alignSelf: 'flex-end', borderTopLeftRadius: 16, borderTopRightRadius: 4 },
  ownViewport: { width: '80%' },
  byline: { color: '#50647b', fontSize: 12, fontWeight: '600', marginBottom: 6 }, attachment: { color: '#50647b', fontSize: 12, marginTop: 5 },
  reactionSlot: { height: 23, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 5 }, cancelText: { color: '#294e7b', fontSize: 12 }, reactionText: { color: '#50647b', fontSize: 12, lineHeight: 18, alignSelf: 'flex-start', backgroundColor: '#edf2f8', borderWidth: 1, borderColor: '#d7e1ee', borderRadius: 11, paddingHorizontal: 7 }, sendError: { color: '#9d1b32', fontSize: 12, marginTop: 5 },
  action: { backgroundColor: '#285ea5', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, minHeight: 40, justifyContent: 'center', margin: 2 },
  muted: { backgroundColor: '#e7eef7' }, actionText: { color: '#fff', fontWeight: '600', fontSize: 13 }, mutedText: { color: '#294e7b' }, disabled: { opacity: 0.5 },
  older: { alignItems: 'center', padding: 12 }, locating: { color: '#566a81', lineHeight: 20, textAlign: 'center' }, empty: { textAlign: 'center', color: '#697b90', margin: 24 },
  latest: { minWidth: 40, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#e7eef7' }, latestText: { color: '#294e7b', fontSize: 20 },
  controlRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5 }, controlText: { color: '#233b56', fontSize: 13, flexShrink: 1 },
  interactions: { maxHeight: 170 },
  interaction: { backgroundColor: '#fff7e6', paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: 1, borderColor: '#efdfb8', gap: 5 },

  composer: { backgroundColor: '#fff', borderTopWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 10, paddingVertical: 7, flexDirection: 'row', alignItems: 'flex-end', gap: 5 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 12, minHeight: 42, paddingHorizontal: 12, paddingVertical: 8, color: '#172a40' }, composeInput: { flex: 1, maxHeight: 120 }
});
