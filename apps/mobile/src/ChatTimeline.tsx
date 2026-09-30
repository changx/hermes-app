import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, FlatList, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './FontSize';
import type { ScrollViewProps } from 'react-native';
import { KeyboardChatScrollView, KeyboardGestureArea, KeyboardStickyView, useKeyboardHandler } from 'react-native-keyboard-controller';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurTargetView, BlurView } from 'expo-blur';
import type { Interaction, Receipt } from '../../../packages/client/src/index';
import { agentOutputAdded, appendedAtEnd, scrollStateFromEvent, scrollToExactEnd, shouldFollowContentChange, type ScrollGeometry, type TimelinePosition, type TimelineRow } from './timeline';
import { MessageContent } from './MessageContent';
import { MessageTime } from './MessageTime';
import { messageNeedsViewport } from './messageMarkdown';
import { hasRunningReceipt } from './receiptState';


const action = (title: string, onPress: () => void, disabled = false, muted = false) => <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress} style={[styles.action, muted && styles.muted, disabled && styles.disabled]}><Text style={[styles.actionText, muted && styles.mutedText]}>{title}</Text></Pressable>;

const MessageRow = memo(function MessageRow({ row, onCancel, busy, renderAttachments }: { row: TimelineRow; onCancel: (receipt: Receipt) => void; busy: boolean; renderAttachments?: (row: TimelineRow) => React.ReactNode }) {
  const own = row.role === 'user';
  const needsViewport = useMemo(() => own && messageNeedsViewport(row.text), [own, row.text]);
  if (row.displayKind === 'system_notice') return <View accessible accessibilityLabel={`System notice: ${row.text}`} style={styles.systemNotice}>
    <Text style={styles.systemNoticeText}>{row.text}</Text><MessageTime seconds={row.timestamp} />
  </View>;
  const toolsOnly = row.role === 'assistant' && !row.text.trim() && !!row.toolCalls?.length;
  const content = <View style={own ? [styles.bubble, styles.own, needsViewport && styles.ownViewport] : row.role === 'assistant' ? [styles.agentMessage, toolsOnly && styles.toolMessage] : styles.bubble}>
    {!row.continuation && <View style={styles.byline}><Text style={styles.sender}>{own ? 'You' : row.role === 'assistant' ? 'Hermes' : 'Message'}{!row.optimistic && !row.refSeq ? ' · Draft' : ''}</Text><MessageTime seconds={row.timestamp} /></View>}
    <MessageContent text={row.text} toolCalls={row.role === 'assistant' ? row.toolCalls : undefined} canExpand={row.role === 'assistant'} pending={own && !!row.optimistic && row.status !== 'accepted'} />
    {own && !!row.feedback && <Text accessibilityLabel={`Feedback after receipt: ${row.feedback}`} style={styles.feedback}>{row.feedback}</Text>}
    {!!row.sendError && <Text accessibilityLiveRegion="polite" style={styles.sendError}>{row.sendError}</Text>}
    {renderAttachments ? renderAttachments(row) : row.attachments?.map(a => <Text key={a.id} style={styles.attachment}>Attachment: {a.name || 'Unnamed attachment'} ({a.state === 'available' ? 'Available' : 'Unavailable for now'})</Text>)}
    {row.reactionSlot && <View style={styles.reactionSlot} accessibilityLabel={row.reaction?.label}>
      {row.reaction && <Text style={styles.reactionText}>{row.reaction.emoji} {row.reaction.label}</Text>}
      {row.receipt?.state === 'queued' && <Pressable accessibilityRole="button" accessibilityLabel="Cancel queued message" disabled={busy} hitSlop={8} onPress={() => onCancel(row.receipt!)}><Text style={styles.cancelText}>Cancel</Text></Pressable>}
    </View>}
  </View>;
  return own ? <View style={styles.userMessageRow}>{content}</View> : content;
}, (prev, next) => prev.renderAttachments === next.renderAttachments && prev.busy === next.busy && prev.onCancel === next.onCancel && prev.row.receipt?.state === next.row.receipt?.state && prev.row.key === next.row.key && prev.row.text === next.row.text && prev.row.displayKind === next.row.displayKind && prev.row.timestamp === next.row.timestamp && prev.row.toolCalls === next.row.toolCalls && prev.row.continuation === next.row.continuation && prev.row.status === next.row.status && prev.row.optimistic === next.row.optimistic && prev.row.refSeq === next.row.refSeq && prev.row.reactionSlot === next.row.reactionSlot && prev.row.reaction?.label === next.row.reaction?.label && prev.row.feedback === next.row.feedback && prev.row.sendError === next.row.sendError && prev.row.attachments === next.row.attachments);

export interface ChatTimelineHandle { followLatest(animate?: boolean): void; holdPosition(): void; pasteText(text: string): void }
interface Props {
  active: boolean;
  threadId: string;
  rows: TimelineRow[];
  startRef: number | null;
  hasOlder: boolean;
  onOlder(): void | Promise<void>;
  locatingMessage?: string;
  onLocateNext?: () => void;
  locatingBusy?: boolean;
  position?: TimelinePosition;
  onPosition(position: TimelinePosition): void;
  onVisibleRef(ref: number): void;
  text: string;
  onText(value: string): void;
  onSend(): void;
  composerAccessory?: (controls: React.ReactNode, onHeight: (height: number) => void) => React.ReactNode;
  typingIndicator?: React.ReactNode;
  attachmentCount?: number;
  attachmentsBusy?: boolean;
  renderAttachments?: (row: TimelineRow) => React.ReactNode;

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
  const [latestRowHeight, setLatestRowHeight] = useState(0);
  const composerID = `composer-${props.threadId}`;
  const composerInput = useRef<React.ElementRef<typeof TextInput>>(null);
  const textSelection = useRef<{ start: number; end: number } | null>(null);
  const reportedInset = useRef(0);
  const onContentInsetChange = useCallback((insets: { bottom: number }) => { reportedInset.current = insets.bottom; }, []);
  const renderScrollComponent = useCallback((scrollProps: ScrollViewProps) =>
    <KeyboardChatScrollView {...scrollProps} automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never"
      // RN 0.81+ otherwise loses drag touches in the contentInset/blank area.
      applyWorkaroundForContentInsetHitTestBug
      offset={bottom} keyboardLiftBehavior="whenAtEnd" onContentInsetChange={onContentInsetChange} />,
  [bottom, onContentInsetChange]);
  const list = useRef<FlatList<TimelineRow>>(null);
  const blurTarget = useRef<View | null>(null);
  const following = useRef(position?.following ?? true);
  const [showLatest, setShowLatest] = useState(!following.current);
  const [refreshingHistory, setRefreshingHistory] = useState(false);
  const historyPullPending = useRef(false);
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
  // Native-stack keeps the departing screen mounted during an interactive
  // swipe-back. Never address its list once the route has lost focus.
  const active = useRef(props.active);
  active.current = props.active;
  const followAnimation = useRef(false);
  const pendingFollow = useRef(false);
  const scheduleFollow = useCallback((animate = false) => {
    if (!active.current) return;
    // Automatic content/geometry corrections must never inherit an older
    // animated jump. Only the caller that explicitly requests animation gets it.
    if (animate) followAnimation.current = true;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (!active.current || !following.current || dragging.current || gestureMomentum.current || momentumEligible.current) {
        pendingFollow.current = false;
        followAnimation.current = false;
        return;
      }
      if (keyboardMoving.current) { pendingFollow.current = true; return; }
      pendingFollow.current = false;
      const animated = followAnimation.current && !reducedMotion.current;
      followAnimation.current = false;
      scrollToExactEnd(list.current, content.current, viewport.current, animated, scrollGeometry.current?.inset ?? reportedInset.current);
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
        pendingFollow.current = false; followAnimation.current = false;
      }
    });
    return () => { mounted = false; sub.remove(); app.remove(); if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, []);
  useEffect(() => {
    if (props.active) return;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    keyboardMoving.current = false; nativeMoving.value = false;
    pendingFollow.current = false; followAnimation.current = false;
  }, [props.active]);
  const callbacks = useRef({ onPosition, onVisibleRef, startRef });
  callbacks.current = { onPosition, onVisibleRef, startRef };
  const savePosition = useCallback(() => callbacks.current.onPosition({ offset: offset.current, following: following.current, startRef: callbacks.current.startRef }), []);
  const pullOlder = async () => {
    if (!active.current || !props.hasOlder || props.locatingBusy || historyPullPending.current) return;
    // A short conversation can still be at the tail when pulled from the top.
    // Stop following before prepending so new history cannot jump to latest.
    historyPullPending.current = true;
    following.current = false; pendingFollow.current = false; followAnimation.current = false;
    setShowLatest(true); savePosition();
    setRefreshingHistory(true);
    try { await props.onOlder(); }
    finally { historyPullPending.current = false; setRefreshingHistory(false); }
  };
  const followLatest = useCallback((animate = true) => {
    if (!active.current) return;
    following.current = true; setShowLatest(false);
    // An explicit send/latest action overrides any older gesture momentum.
    dragging.current = false; gestureMomentum.current = false; momentumEligible.current = false;
    if (!animate) followAnimation.current = false;
    if (keyboardMoving.current) scheduleFollow(animate);
    else {
      const animated = animate && !reducedMotion.current;
      scrollToExactEnd(list.current, content.current, viewport.current, animated, scrollGeometry.current?.inset ?? reportedInset.current);
    }
    savePosition();
  }, [savePosition, scheduleFollow]);
  useImperativeHandle(ref, () => ({ followLatest, pasteText(text: string) {
    const start = Math.min(textSelection.current?.start ?? props.text.length, props.text.length);
    const end = Math.max(start, Math.min(textSelection.current?.end ?? start, props.text.length));
    props.onText(props.text.slice(0, start) + text + props.text.slice(end));
    textSelection.current = { start: start + text.length, end: start + text.length };
  }, holdPosition() {
    following.current = false; pendingFollow.current = false; followAnimation.current = false;
    setShowLatest(true); savePosition();
  } }), [followLatest, savePosition, props.text, props.onText]);
  useEffect(() => { savePosition(); }, [startRef, savePosition]);
  const previousRows = useRef<readonly TimelineRow[]>([]);
  useEffect(() => {
    const newOutput = agentOutputAdded(previousRows.current, rows);
    previousRows.current = rows;
    // Commit the new FlatList data first, then use the native content extent.
    // Content-size may be unchanged (or onScroll may have observed it already).
    // New output should appear at the tail without visibly scrolling the whole
    // conversation. Explicit send/latest actions remain animated.
    if (newOutput && following.current) scheduleFollow();
  }, [rows, scheduleFollow]);
  const visible = useRef({ onVisibleRef });
  visible.current.onVisibleRef = onVisibleRef;
  const viewability = useRef(({ viewableItems }: { viewableItems: Array<{ item: TimelineRow }> }) => {
    const refs = viewableItems.map(v => v.item.refSeq).filter((v): v is number => v !== undefined);
    if (refs.length) visible.current.onVisibleRef(Math.max(...refs));
  });
  const composerControls = <><Pressable accessible={false} focusable={false} style={styles.composeField} onPress={() => composerInput.current?.focus()}>
      <TextInput ref={composerInput} nativeID={composerID} accessibilityLabel="Message text" multiline
        // Fabric iOS: reset empty measurement without fixing font height.
        // Android setLines also fixes the widget's height, so leave it unset there.
        numberOfLines={Platform.OS === 'ios' && props.text.length === 0 ? 1 : undefined}
        style={styles.composeInput} underlineColorAndroid="transparent" placeholder="Message…" value={props.text} onChangeText={props.onText} onSelectionChange={e => { textSelection.current = e.nativeEvent.selection; }} />
      </Pressable>
      {action('Send', props.onSend, props.busy || !!props.attachmentsBusy || (!props.text.trim() && !props.attachmentCount))}</>;
  return <KeyboardGestureArea style={styles.flex} interpolator="ios" textInputNativeID={composerID} offset={composerHeight}>
    <BlurTargetView ref={blurTarget} style={styles.flex}>
      <FlatList ref={list} style={styles.flex} data={rows} keyExtractor={item => item.key} renderItem={({ item }) => <MessageRow row={item} onCancel={props.onCancel} busy={props.busy} renderAttachments={props.renderAttachments} />}
        renderScrollComponent={renderScrollComponent}
        contentContainerStyle={styles.messages} keyboardShouldPersistTaps="always" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} alwaysBounceVertical={Platform.OS === 'ios'}
        initialNumToRender={14} maxToRenderPerBatch={10} windowSize={7} updateCellsBatchingPeriod={60}
        // Keep the native visible-item anchor stable across prepends. Do not
        // toggle it during programmatic follow/keyboard scrolling.
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        refreshControl={props.hasOlder || refreshingHistory ? <RefreshControl
          refreshing={refreshingHistory} onRefresh={pullOlder}
          enabled={props.active && props.hasOlder && !props.locatingBusy}
          accessibilityLabel="Load earlier messages" tintColor="#526780" colors={['#526780']} /> : undefined}
        ListHeaderComponent={props.locatingMessage ? <View style={styles.older}><Text style={styles.locating}>{props.locatingMessage}</Text>
          {props.onLocateNext && action('Keep looking', props.onLocateNext, props.locatingBusy, true)}</View>
          : null}
        ListEmptyComponent={props.locatingMessage || props.locatingBusy ? null : <Text style={styles.empty}>No messages yet</Text>}
        onViewableItemsChanged={viewability.current}
        onLayout={e => {
          if (!active.current) return;
          viewport.current = e.nativeEvent.layout.height;
          if (!restored.current && content.current) {
            restored.current = true;
            if (following.current) scheduleFollow();
            else list.current?.scrollToOffset({ offset: offset.current, animated: false });
          }
        }}
        onContentSizeChange={(_, height) => {
          if (!active.current) return;
          const previous = content.current;
          content.current = height;
          if (!restored.current && viewport.current) {
            restored.current = true;
            if (following.current) scheduleFollow();
            else list.current?.scrollToOffset({ offset: offset.current, animated: false });
          } else if (!dragging.current && !gestureMomentum.current && !momentumEligible.current
            && (shouldFollowContentChange(following.current, false, previous, height) || following.current && appended.current && height > 0)
            && (!keyboardMoving.current || appended.current)) scheduleFollow();
          appended.current = false;
        }}
        onScrollBeginDrag={() => { if (!active.current) return; dragging.current = true; gestureMomentum.current = false; momentumEligible.current = false; followAnimation.current = false; pendingFollow.current = false; }}
        onMomentumScrollBegin={() => { gestureMomentum.current = momentumEligible.current; momentumEligible.current = false; }}
        onScrollEndDrag={e => { dragging.current = false; momentumEligible.current = Math.abs(e.nativeEvent.velocity?.y ?? 0) > 0.01; savePosition(); }}
        onMomentumScrollEnd={() => { gestureMomentum.current = false; momentumEligible.current = false; savePosition(); }}
        onScroll={e => {
          if (!active.current) return;
          const state = scrollStateFromEvent(following.current, offset.current, scrollGeometry.current, e.nativeEvent,
            (dragging.current || gestureMomentum.current) && !keyboardMoving.current, reportedInset.current);
          offset.current = state.offset;
          viewport.current = state.geometry.viewport; content.current = state.geometry.height;
          scrollGeometry.current = state.geometry;
          if (state.following !== following.current) { following.current = state.following; setShowLatest(!state.following); }
          savePosition();
        }} scrollEventThrottle={16} />

    </BlurTargetView>
    <KeyboardStickyView pointerEvents="box-none" style={{ marginTop: showLatest ? -latestRowHeight : 0, zIndex: 1 }} offset={{ opened: bottom }} onLayout={e => {
      if (!active.current) return;
      const height = e.nativeEvent.layout.height;
      if (dockHeight.current !== height) {
        const hadDock = dockHeight.current > 0;
        dockHeight.current = height;
        // A growing composer/controls shrinks the flex list; only follow if already at latest.
        if (hadDock && restored.current && following.current && !keyboardMoving.current) scheduleFollow();
      }
    }}>
    {showLatest && <View pointerEvents="box-none" style={styles.latestRow} onLayout={e => setLatestRowHeight(e.nativeEvent.layout.height)}>
      <Pressable accessibilityRole="button" accessibilityLabel="Jump to latest ↓" onPress={() => followLatest()} style={styles.latest}>
        <Text style={styles.latestText}>↓</Text>
      </Pressable>
    </View>}
    {!!props.interactions.length && <ScrollView style={styles.interactions} keyboardShouldPersistTaps="handled">{props.interactions.map(i => <View key={i.id} style={styles.interaction}>
      <Text style={styles.controlText}>{i.kind === 'approval' ? 'Please confirm' : 'Please answer'} · {i.prompt}</Text>
      <View style={styles.controlRow}>{i.choices.map(choice => <React.Fragment key={choice}>{action(choice, () => props.onAnswer(i, choice), props.busy, true)}</React.Fragment>)}</View>
      {i.kind === 'clarify' && i.choices.length === 0 && <View style={styles.controlRow}>
        <TextInput accessibilityLabel="Your answer" style={[styles.input, styles.flex]} value={props.answers[i.id] || ''} onChangeText={value => props.onAnswerText(i.id, value)} />
        {action('Submit answer', () => props.onAnswer(i, (props.answers[i.id] || '').trim()), props.busy || !props.answers[i.id]?.trim())}
      </View>}
    </View>)}</ScrollView>}

    <BlurView blurTarget={blurTarget} blurMethod="dimezisBlurViewSdk31Plus" intensity={72} tint="systemMaterialLight" style={styles.composerSurface}>
      {hasRunningReceipt(props.threadId, props.receipts) && <View style={styles.runningRow}>
        <View style={styles.runningIndicator}>{props.typingIndicator}</View>
        <Pressable accessibilityRole="button" accessibilityLabel="Stop" disabled={props.busy} onPress={props.onStop} style={[styles.statusStopButton, props.busy && styles.disabled]}>
          <Text style={styles.stopIcon}>■</Text>
        </Pressable>
      </View>}
      {props.composerAccessory ? props.composerAccessory(composerControls, setComposerHeight)
        : <View style={styles.composer} onLayout={e => setComposerHeight(e.nativeEvent.layout.height)}>{composerControls}</View>}
    </BlurView>
    </KeyboardStickyView>
  </KeyboardGestureArea>;
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Keep the real content height: growing short content to the viewport makes
  // the keyboard controller scroll empty space and push top-aligned rows away.
  messages: { paddingTop: 12, paddingBottom: 96 },
  agentMessage: { alignSelf: 'stretch', minWidth: 0, marginHorizontal: 14, marginVertical: 5 },
  toolMessage: { marginVertical: 2 },
  systemNotice: { alignSelf: 'center', maxWidth: '92%', marginHorizontal: 14, marginVertical: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 10, backgroundColor: '#edf2f8', flexDirection: 'row', alignItems: 'center', gap: 8 },
  systemNoticeText: { color: '#50647b', fontSize: 12, lineHeight: 17, flexShrink: 1 },
  userMessageRow: { alignSelf: 'stretch', minWidth: 0, marginHorizontal: 14 },
  bubble: { backgroundColor: '#fff', padding: 13, marginHorizontal: 14, marginVertical: 5, borderRadius: 16, borderTopLeftRadius: 4, maxWidth: '90%', alignSelf: 'flex-start', borderWidth: 1, borderColor: '#e3e9f0' },
  own: { maxWidth: '80%', marginHorizontal: 0, backgroundColor: '#e6f0ff', borderColor: '#d0e2fb', alignSelf: 'flex-end', borderTopLeftRadius: 16, borderTopRightRadius: 4 },
  ownViewport: { width: '80%' },
  byline: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }, sender: { color: '#50647b', fontSize: 12, fontWeight: '600' }, attachment: { color: '#50647b', fontSize: 12, marginTop: 5 },
  reactionSlot: { height: 23, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 5 }, cancelText: { color: '#294e7b', fontSize: 12 }, reactionText: { color: '#50647b', fontSize: 12, lineHeight: 18, alignSelf: 'flex-start', backgroundColor: '#edf2f8', borderWidth: 1, borderColor: '#d7e1ee', borderRadius: 11, paddingHorizontal: 7 }, sendError: { color: '#9d1b32', fontSize: 12, marginTop: 5 },
  feedback: { color: '#415b76', fontSize: 12, lineHeight: 18, marginTop: 7, flexShrink: 1 },
  action: { backgroundColor: '#285ea5', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, minHeight: 40, justifyContent: 'center', margin: 2 },
  muted: { backgroundColor: '#e7eef7' }, actionText: { color: '#fff', fontWeight: '600', fontSize: 13 }, mutedText: { color: '#294e7b' }, disabled: { opacity: 0.5 },
  older: { alignItems: 'center', padding: 12 }, locating: { color: '#566a81', lineHeight: 20, textAlign: 'center' }, empty: { textAlign: 'center', color: '#697b90', margin: 24 },
  // Overlap only this measured row with the list; keep it inside the dock hit bounds.
  latestRow: { backgroundColor: 'transparent', alignItems: 'flex-end', paddingHorizontal: 14, paddingVertical: 6 },
  latest: { minWidth: 40, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#e7eef7' }, latestText: { color: '#294e7b', fontSize: 20 },
  controlRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5 }, controlText: { color: '#233b56', fontSize: 13, flexShrink: 1 },
  interactions: { maxHeight: 170 },
  interaction: { backgroundColor: '#fff7e6', paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: 1, borderColor: '#efdfb8', gap: 5 },

  runningRow: { minHeight: 32, flexDirection: 'row', alignItems: 'center', paddingRight: 10 },
  runningIndicator: { flex: 1, minWidth: 0 },
  statusStopButton: { width: 34, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#e6edf7' },
  stopIcon: { color: '#425874', fontSize: 17 },
  // Center the content-sized native input, not text inside a fixed-height UITextView.
  composeField: { flex: 1, minWidth: 0, minHeight: 42, maxHeight: 120, justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  composeInput: { maxHeight: 102, padding: 0, color: '#172a40' },
  // One shadow around the shared status, attachment, and input blur surface.
  composerSurface: { backgroundColor: 'rgba(248, 250, 253, 0.78)', boxShadow: '0 -4px 10px -4px rgba(23, 42, 64, 0.16)' },
  composer: { backgroundColor: 'transparent', borderTopWidth: 1, borderColor: 'rgba(205, 215, 227, 0.72)', paddingHorizontal: 10, paddingVertical: 7, flexDirection: 'row', alignItems: 'flex-end', gap: 5 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 12, minHeight: 42, paddingHorizontal: 12, paddingVertical: 8, color: '#172a40' }
});
