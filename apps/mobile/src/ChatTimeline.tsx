import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, AppState, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { Text, TextInput } from './FontSize';
import type { ScrollViewProps } from 'react-native';
import { KeyboardChatScrollView, KeyboardGestureArea, KeyboardStickyView, useKeyboardHandler } from 'react-native-keyboard-controller';
import Animated, { FadeIn, ReduceMotion, runOnJS, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurTargetView, BlurView } from 'expo-blur';
import type { Interaction, Receipt } from '../../../packages/client/src/index';
import { agentOutputAdded, appendedAtEnd, scrollStateFromEvent, scrollToExactEnd, shouldFollowContentChange, type ScrollGeometry, type TimelinePosition, type TimelineRow } from './timeline';

import { MessageContent, copyMessageText } from './MessageContent';
import { WorkChevron } from './WorkChevron';
import { MessageTime } from './MessageTime';
import { workGroups, workIsExpanded, type WorkChoice, type WorkGroup } from '../../../packages/client/src/workPresentation';
import { hasRunningReceipt } from './receiptState';
import { historyDrawDistance, historyItemType } from './historyLayout';
import { failedMessageId, confirmFailedMessageDelete } from './failedMessageActions';


const action = (title: string, onPress: () => void, disabled = false, muted = false) => <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress} style={[styles.action, muted && styles.muted, disabled && styles.disabled]}><Text style={[styles.actionText, muted && styles.mutedText]}>{title}</Text></Pressable>;
const historyPosition = { disabled: false };
const historyEntrance = FadeIn.duration(220).reduceMotion(ReduceMotion.System);
type HistoryPullRequest = { started: boolean; release?: (released: boolean) => void };

const MessageRow = memo(function MessageRow({ row, onCancel, onDeleteFailed, onRetryFailed, busy, renderAttachments, animateHistory, onHistoryShown, historyBoundary, highlighted, work, workExpanded = true, onWorkToggle }: { row: TimelineRow; onCancel: (receipt: Receipt) => void; onDeleteFailed?: (id: string) => void; onRetryFailed?: (id: string) => void; busy: boolean; renderAttachments?: (row: TimelineRow) => React.ReactNode; animateHistory?: boolean; onHistoryShown?: (key: string) => void; historyBoundary?: boolean; highlighted?: boolean; work?: WorkGroup; workExpanded?: boolean; onWorkToggle?: (group: WorkGroup, expanded: boolean) => void }) {
  const own = row.role === 'user';
  const revealed = useRef({ key: row.key, value: false });
  if (revealed.current.key !== row.key) revealed.current = { key: row.key, value: false };
  if (!work || workExpanded) revealed.current.value = true;
  // Keep the native entering configuration stable after the parent consumes
  // eligibility; ordinary rerenders must not change the animation's nativeID.
  const entrance = useRef({ key: row.key, animation: animateHistory ? historyEntrance : undefined });
  if (entrance.current.key !== row.key) entrance.current = { key: row.key, animation: animateHistory ? historyEntrance : undefined };
  useEffect(() => { if (animateHistory) onHistoryShown?.(row.key); }, [animateHistory, row.key, onHistoryShown]);
  const entering = entrance.current.animation;
  // Keep the spacer outside the original message root. FlashList measures it
  // with this keyed cell; a Fragment adds no native wrapper or correction scroll.
  const boundary = historyBoundary ? <View testID="history-boundary" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.historyBoundary}>
    <View style={styles.historyBoundaryLine} />
  </View> : null;
  if (row.displayKind === 'system_notice') return <>{boundary}<Animated.View entering={entering} accessible accessibilityLabel={`System notice: ${row.text}`} style={styles.systemNotice}>
    <Text style={styles.systemNoticeText}>{row.text}</Text><MessageTime seconds={row.timestamp} />
  </Animated.View></>;
  const toolsOnly = row.role === 'assistant' && !row.text.trim() && !!row.toolCalls?.length;
  const finalReply = row.role === 'assistant' && row.displayKind === 'final';
  const failedId = failedMessageId(row);
  const messageStyle = own ? styles.userMessageBubble : row.role === 'assistant' ? [styles.agentMessage, toolsOnly && styles.toolMessage, finalReply && styles.finalReply] : styles.bubble;
  const contentStyle = work && !workExpanded ? [messageStyle, styles.workHidden] : messageStyle;
  const content = <Animated.View entering={own ? undefined : entering} accessibilityElementsHidden={!!work && !workExpanded} importantForAccessibility={work && !workExpanded ? 'no-hide-descendants' : 'auto'} style={highlighted ? [contentStyle, { backgroundColor: '#d9eaff' }] : contentStyle}>
    {row.role !== 'assistant' && !row.continuation && <View style={styles.byline}><MessageTime seconds={row.timestamp} absolute={row.role === 'user'} /></View>}
    {revealed.current.value && <MessageContent key={row.key} resourceId={row.key} text={row.text} toolCalls={row.role === 'assistant' ? row.toolCalls : undefined} canExpand={row.role === 'assistant'} pending={own && !!row.optimistic && row.status !== 'accepted'} />}
    {own && !!row.feedback && <Text accessibilityLabel={`Feedback after receipt: ${row.feedback}`} style={styles.feedback}>{row.feedback}</Text>}
    {!!row.sendError && <Text accessibilityLiveRegion="polite" style={styles.sendError}>{row.sendError}</Text>}
    {!!failedId && <View style={styles.failedActions}>
      {!!onRetryFailed && action('Retry', () => onRetryFailed(failedId), busy)}
      {!!row.text && action('Copy', () => copyMessageText(row.text))}
      {!!onDeleteFailed && action('Delete', () => confirmFailedMessageDelete(row, onDeleteFailed, Alert.alert), busy)}
    </View>}
    {revealed.current.value && (renderAttachments ? renderAttachments(row) : row.attachments?.map(a => <Text key={a.id} style={styles.attachment}>Attachment: {a.name || 'Unnamed attachment'} ({a.state === 'available' ? 'Available' : 'Unavailable for now'})</Text>))}
    {row.reactionSlot && <View style={styles.reactionSlot} accessibilityLabel={row.reaction?.label}>
      {row.reaction && <Text style={styles.reactionText}>{row.reaction.emoji} {row.reaction.label}</Text>}
      {row.receipt?.state === 'queued' && <Pressable accessibilityRole="button" accessibilityLabel="Cancel queued message" disabled={busy} hitSlop={8} onPress={() => onCancel(row.receipt!)}><Text style={styles.cancelText}>Cancel</Text></Pressable>}
    </View>}
  </Animated.View>;
  return <>{boundary}{work?.key === row.key && <View style={styles.workHeading}><Pressable accessibilityRole="button" accessibilityLabel={work.label} accessibilityState={{ expanded: workExpanded }} onPress={() => onWorkToggle?.(work, !workExpanded)} style={styles.workToggle}><Text style={styles.workLabel}>{work.label}</Text><WorkChevron expanded={workExpanded} /></Pressable></View>}{own ? <Animated.View entering={entering} style={styles.userMessageRow}>{content}</Animated.View> : content}</>;
}, (prev, next) => prev.work === next.work && prev.workExpanded === next.workExpanded && prev.onWorkToggle === next.onWorkToggle && prev.highlighted === next.highlighted && prev.historyBoundary === next.historyBoundary && prev.animateHistory === next.animateHistory && prev.onHistoryShown === next.onHistoryShown && prev.renderAttachments === next.renderAttachments && prev.busy === next.busy && prev.onDeleteFailed === next.onDeleteFailed && prev.onRetryFailed === next.onRetryFailed && prev.onCancel === next.onCancel && prev.row.receipt?.state === next.row.receipt?.state && prev.row.key === next.row.key && prev.row.text === next.row.text && prev.row.displayKind === next.row.displayKind && prev.row.timestamp === next.row.timestamp && prev.row.toolCalls === next.row.toolCalls && prev.row.continuation === next.row.continuation && prev.row.status === next.row.status && prev.row.optimistic === next.row.optimistic && prev.row.refSeq === next.row.refSeq && prev.row.reactionSlot === next.row.reactionSlot && prev.row.reaction?.label === next.row.reaction?.label && prev.row.feedback === next.row.feedback && prev.row.sendError === next.row.sendError && prev.row.attachments === next.row.attachments);

export interface ChatTimelineHandle { followLatest(animate?: boolean): void; holdPosition(): void; pasteText(text: string): void }
interface Props {
  active: boolean;
  threadId: string;
  rows: TimelineRow[];
  targetRef?: number;
  hasNewer?: boolean;
  onNewer?(): void;
  onLatest?(): void;
  startRef: number | null;
  hasOlder: boolean;
  onOlder(): void | Promise<void>;
  locatingMessage?: string;
  onLocateNext?: () => void;
  locatingBusy?: boolean;
  position?: TimelinePosition;
  onPosition(position: TimelinePosition): void;
  onVisibleRefs?(refs: number[]): void;

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
  onDeleteFailed?(clientMessageId: string): void;
  onRetryFailed?(clientMessageId: string): void;
  onStop(): void;
  busy: boolean;
}
export const ChatTimeline = forwardRef<ChatTimelineHandle, Props>(function ChatTimeline(props, ref) {
  const { rows, startRef, position, onPosition } = props;
  const [workChoices, setWorkChoices] = useState<Record<string, WorkChoice>>({});
  const groups = workGroups(rows.map(row => ({ key: row.key, role: row.role, kind: row.displayKind, seconds: row.timestamp })), hasRunningReceipt(props.threadId, props.receipts));
  const onWorkToggle = useCallback((group: WorkGroup, expanded: boolean) => setWorkChoices(old => ({ ...old, [`${props.threadId}:${group.key}`]: { completion: group.completion, expanded } })), [props.threadId]);
  const [initialTargetIndex] = useState(() => { const index = rows.findIndex(row => row.refSeq === props.targetRef); return props.targetRef !== undefined && index >= 0 ? index : undefined; });
  const [highlightedRef, setHighlightedRef] = useState(props.targetRef);
  const [highlightVisible, setHighlightVisible] = useState(false);
  const sourceTarget = useRef(props.targetRef);
  useEffect(() => { if (highlightedRef === undefined || !highlightVisible) return; const timer = setTimeout(() => setHighlightedRef(undefined), 2400); return () => clearTimeout(timer); }, [highlightedRef, highlightVisible]);
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
  const list = useRef<FlashListRef<TimelineRow>>(null);
  const visibleCallback = useRef(props.onVisibleRefs);
  visibleCallback.current = props.onVisibleRefs;
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: { item: TimelineRow; isViewable: boolean }[] }) => {
    if (sourceTarget.current !== undefined && viewableItems.some(v => v.isViewable && v.item.refSeq === sourceTarget.current)) setHighlightVisible(true);
    visibleCallback.current?.(viewableItems.filter(v => v.isViewable && v.item.refSeq !== undefined).map(v => v.item.refSeq!));
  }, []);

  const blurTarget = useRef<View | null>(null);
  const following = useRef(position?.following ?? true);
  const [showLatest, setShowLatest] = useState(!following.current);
  const [refreshingHistory, setRefreshingHistory] = useState(false);
  const [historyHint, setHistoryHint] = useState<'idle' | 'release' | 'loading'>('idle');
  const [renderAhead, setRenderAhead] = useState(250);
  const historyPullPending = useRef<HistoryPullRequest | null>(null);
  const historyReleased = useRef(false);
  const historyLoadProps = useRef({ hasOlder: props.hasOlder, locatingBusy: props.locatingBusy, onOlder: props.onOlder });
  historyLoadProps.current = { hasOlder: props.hasOlder, locatingBusy: props.locatingBusy, onOlder: props.onOlder };
  const offset = useRef(position?.offset ?? 0);
  const historyReading = useRef(false);
  const viewport = useRef(0), content = useRef(0), dragging = useRef(false), gestureMomentum = useRef(false), momentumEligible = useRef(false);
  const keyboardMoving = useRef(false);
  const nativeMoving = useSharedValue(false);
  const scrollGeometry = useRef<ScrollGeometry | null>(null);
  const restored = useRef(initialTargetIndex !== undefined);
  const reducedMotion = useRef(false);
  const [reduceLoadingMotion, setReduceLoadingMotion] = useState(true);
  const previousKeys = useRef<string[]>([]);
  const historyBoundaryKey = useRef<string | null>(null);
  const historyThread = useRef(props.threadId);
  const historyEnteringKeys = useRef(new Set<string>());
  const motionForeground = useRef(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const onHistoryShown = useCallback((key: string) => { historyEnteringKeys.current.delete(key); }, []);
  const appended = useRef(false);
  const nextKeys = rows.map(row => row.key);
  if (historyThread.current !== props.threadId) {
    historyThread.current = props.threadId;
    previousKeys.current = [];
    historyBoundaryKey.current = null;
  }
  if (historyBoundaryKey.current && !nextKeys.includes(historyBoundaryKey.current)) historyBoundaryKey.current = null;
  if (nextKeys.length !== previousKeys.current.length || nextKeys.some((key, i) => key !== previousKeys.current[i])) {
    appended.current = appendedAtEnd(previousKeys.current, nextKeys);
    const oldKeys = new Set(previousKeys.current), firstOld = nextKeys.indexOf(previousKeys.current[0]);
    if (firstOld > 0 && (historyReading.current || historyPullPending.current?.started)) historyBoundaryKey.current = previousKeys.current[0];
    historyEnteringKeys.current = props.active && motionForeground.current && historyReading.current && !reducedMotion.current && firstOld > 0
      ? new Set(nextKeys.slice(0, firstOld).filter(key => !oldKeys.has(key))) : new Set();
    previousKeys.current = nextKeys;
  }
  const frame = useRef<number | null>(null);
  // Native-stack keeps the departing screen mounted during an interactive
  // swipe-back. Never address its list once the route has lost focus.
  const active = useRef(props.active);
  active.current = props.active;
  const followAnimation = useRef(false);
  const pendingFollow = useRef(false);
  const cancelPendingHistory = useCallback(() => {
    const request = historyPullPending.current;
    if (!request || request.started) return;
    historyPullPending.current = null;
    request.release?.(false);
    request.release = undefined;
    if (active.current) { setRefreshingHistory(false); setHistoryHint('idle'); }
  }, []);
  const clearHistoryReading = useCallback(() => {
    historyReading.current = false;
    historyEnteringKeys.current.clear();
  }, []);
  const scheduleFollow = useCallback((animate = false) => {
    if (!active.current || !motionForeground.current) return;
    // Automatic content/geometry corrections must never inherit an older
    // animated jump. Only the caller that explicitly requests animation gets it.
    if (animate) followAnimation.current = true;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (!active.current || !motionForeground.current || !following.current || dragging.current || gestureMomentum.current || momentumEligible.current) {
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
    active.current = props.active;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) { reducedMotion.current = value; setReduceLoadingMotion(value); } }, () => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', value => { reducedMotion.current = value; setReduceLoadingMotion(value); });
    const app = AppState.addEventListener('change', state => {
      motionForeground.current = state === 'active';
      if (state !== 'active') {
        if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
        historyReleased.current = false;
        dragging.current = false; gestureMomentum.current = false; momentumEligible.current = false;
        cancelPendingHistory();
        historyEnteringKeys.current.clear();
        keyboardMoving.current = false; nativeMoving.value = false;
        pendingFollow.current = false; followAnimation.current = false;
      }
    });
    return () => { mounted = false; active.current = false; cancelPendingHistory(); clearHistoryReading(); sub.remove(); app.remove(); if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, []);
  useEffect(() => {
    if (props.active) return;
    historyReleased.current = false;
    dragging.current = false; gestureMomentum.current = false; momentumEligible.current = false;
    cancelPendingHistory();
    clearHistoryReading();
    setRefreshingHistory(false);
    setHistoryHint('idle');
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    keyboardMoving.current = false; nativeMoving.value = false;
    pendingFollow.current = false; followAnimation.current = false;
  }, [props.active]);
  const callbacks = useRef({ onPosition, startRef });
  callbacks.current = { onPosition, startRef };
  const savePosition = useCallback(() => callbacks.current.onPosition({ offset: offset.current, following: following.current, startRef: callbacks.current.startRef }), []);
  const pullOlder = async () => {
    if (!active.current || !motionForeground.current || !historyLoadProps.current.hasOlder || historyLoadProps.current.locatingBusy || historyPullPending.current) return;
    // A short conversation can still be at the tail when pulled from the top.
    // Stop following before prepending so new history cannot jump to latest.
    const request: HistoryPullRequest = { started: false };
    historyPullPending.current = request;
    historyReading.current = true;
    following.current = false; pendingFollow.current = false; followAnimation.current = false;
    setShowLatest(true); savePosition();
    setRefreshingHistory(true);
    setHistoryHint(historyReleased.current ? 'loading' : 'release');
    try {
      // Native refresh can fire at the pull threshold while the finger is still
      // down. Queue intent; neither cached expansion nor HTTP starts until end-drag.
      if (!historyReleased.current) {
        const released = await new Promise<boolean>(resolve => { request.release = resolve; });
        if (!released) return;
      }
      const current = historyLoadProps.current;
      if (historyPullPending.current !== request || !active.current || !motionForeground.current || dragging.current || !current.hasOlder || current.locatingBusy) return;
      request.started = true;
      setHistoryHint('loading');
      await current.onOlder();
    } finally {
      if (historyPullPending.current === request) {
        historyPullPending.current = null;
        if (active.current) { setRefreshingHistory(false); setHistoryHint('idle'); }
      }
    }
  };
  const followLatest = useCallback((animate = true) => {
    if (!active.current) return;
    cancelPendingHistory();
    clearHistoryReading();
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
    // Commit the new FlashList data first, then use the native content extent.
    // Content-size may be unchanged (or onScroll may have observed it already).
    // New output should appear at the tail without visibly scrolling the whole
    // conversation. Explicit send/latest actions remain animated.
    if (newOutput && following.current) scheduleFollow();
  }, [rows, scheduleFollow]);

  const composerControls = <><Pressable accessible={false} focusable={false} style={styles.composeField} onPress={() => composerInput.current?.focus()}>
      <TextInput ref={composerInput} nativeID={composerID} accessibilityLabel="Message text" multiline
        // Fabric iOS: reset empty measurement without fixing font height.
        // Android setLines also fixes the widget's height, so leave it unset there.
        numberOfLines={Platform.OS === 'ios' && props.text.length === 0 ? 1 : undefined}
        style={styles.composeInput} underlineColorAndroid="transparent" placeholder="Message…" value={props.text} onChangeText={props.onText} onSelectionChange={e => { textSelection.current = e.nativeEvent.selection; }} />
      </Pressable>
      {action('Send', props.onSend, props.busy || !!props.attachmentsBusy || (!props.text.trim() && !props.attachmentCount))}</>;
  // The app currently has an English-only interface. Keep copy in that language.
  const historyHintText = historyHint === 'loading' ? 'Loading history…' : historyHint === 'release' ? 'Release to load'
    : rows.length && !props.locatingMessage && !props.locatingBusy ? props.hasOlder ? 'Pull down for earlier messages' : 'Start of conversation' : '';
  return <KeyboardGestureArea style={styles.flex} interpolator="ios" textInputNativeID={composerID} offset={composerHeight}>
    <BlurTargetView ref={blurTarget} collapsable={false} style={styles.flex}>
      <FlashList ref={list} style={styles.flex} data={rows} keyExtractor={item => item.key} renderItem={({ item, target }) => <MessageRow row={item} onCancel={props.onCancel} onDeleteFailed={props.onDeleteFailed} onRetryFailed={props.onRetryFailed} busy={props.busy} renderAttachments={props.renderAttachments}
        work={groups.get(item.key)} workExpanded={!groups.has(item.key) || workIsExpanded(groups.get(item.key)!, workChoices[`${props.threadId}:${groups.get(item.key)!.key}`])} onWorkToggle={onWorkToggle}
        highlighted={highlightedRef !== undefined && item.refSeq === highlightedRef}
        animateHistory={props.active && target === 'Cell' && historyEnteringKeys.current.has(item.key)} onHistoryShown={onHistoryShown}
        historyBoundary={target !== 'StickyHeader' && item.key === historyBoundaryKey.current} />}
        renderScrollComponent={renderScrollComponent}
        drawDistance={renderAhead} getItemType={historyItemType}
        initialScrollIndex={initialTargetIndex}
        ListFooterComponent={props.hasNewer ? action('Load later messages', () => props.onNewer?.(), props.busy || !!props.locatingBusy, true) : null}
        contentContainerStyle={styles.messages} keyboardShouldPersistTaps="always" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} alwaysBounceVertical={Platform.OS === 'ios'}
        // List-owned position maintenance; no competing prepend scrolls.
        maintainVisibleContentPosition={historyPosition}
        // Rich message descendants have image/video/WebView state; use the
        // supported non-recycling mode instead of reusing that state across messages.
        maxItemsInRecyclePool={0}
        refreshControl={props.hasOlder || refreshingHistory ? <RefreshControl
          refreshing={refreshingHistory} onRefresh={pullOlder}
          enabled={props.active && props.hasOlder && !props.locatingBusy}
          accessibilityLabel="Load earlier messages" tintColor="#526780" colors={['#526780']} /> : undefined}
        ListHeaderComponent={<View>
          <View testID="history-hint" style={styles.historyHint} accessible={!!historyHintText} accessibilityLabel={historyHintText || undefined} accessibilityLiveRegion={historyHint === 'loading' ? 'polite' : 'none'}>
            <View style={styles.historyHintIcon} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {historyHint === 'loading' ? <ActivityIndicator size="small" color="#697b90" animating={!reduceLoadingMotion && props.active && motionForeground.current} /> : !!historyHintText && props.hasOlder ? <Text style={styles.historyHintArrow}>↓</Text> : null}
            </View>
            {!!historyHintText && <Text numberOfLines={1} style={styles.historyHintText}>{historyHintText}</Text>}
          </View>
          {props.locatingMessage && <View style={styles.older}><Text style={styles.locating}>{props.locatingMessage}</Text>
            {props.onLocateNext && action('Keep looking', props.onLocateNext, props.locatingBusy, true)}</View>}
        </View>}
        ListEmptyComponent={props.locatingBusy ? <ConversationLoading active={props.active} /> : props.locatingMessage ? null : <Text style={styles.empty}>No messages yet</Text>}

        onViewableItemsChanged={onViewableItemsChanged}
        onLayout={e => {
          if (!active.current) return;
          viewport.current = e.nativeEvent.layout.height;
          setRenderAhead(historyDrawDistance(viewport.current));
          if (!restored.current && content.current) {
            restored.current = true;
            if (following.current) scheduleFollow();
            else if (!historyReading.current) list.current?.scrollToOffset({ offset: offset.current, animated: false });
          }
        }}
        onContentSizeChange={(_, height) => {
          if (!active.current) return;
          const previous = content.current;
          content.current = height;
          if (!restored.current && viewport.current) {
            restored.current = true;
            if (following.current) scheduleFollow();
            else if (!historyReading.current) list.current?.scrollToOffset({ offset: offset.current, animated: false });
          } else if (!dragging.current && !gestureMomentum.current && !momentumEligible.current
            && (shouldFollowContentChange(following.current, false, previous, height) || following.current && appended.current && height > 0)
            && (!keyboardMoving.current || appended.current)) scheduleFollow();
          appended.current = false;
        }}
        onScrollBeginDrag={() => {
          if (!active.current || !motionForeground.current) return;
          if (dragging.current || historyReleased.current) cancelPendingHistory();
          historyReleased.current = false;
          clearHistoryReading();
          if (historyPullPending.current?.release) historyReading.current = true;
          dragging.current = true; gestureMomentum.current = false; momentumEligible.current = false; followAnimation.current = false; pendingFollow.current = false;
        }}
        onMomentumScrollBegin={() => { gestureMomentum.current = momentumEligible.current; momentumEligible.current = false; }}
        onScrollEndDrag={e => {
          if (!active.current || !motionForeground.current || (!dragging.current && !historyPullPending.current?.release)) return;
          dragging.current = false;
          historyReleased.current = true;
          momentumEligible.current = e.nativeEvent.contentOffset?.y >= 0 && Math.abs(e.nativeEvent.velocity?.y ?? 0) > 0.01;
          savePosition();
          const request = historyPullPending.current, release = request?.release;
          if (request) request.release = undefined;
          release?.(true);
        }}
        onMomentumScrollEnd={() => { gestureMomentum.current = false; momentumEligible.current = false; savePosition(); }}
        onScroll={e => {
          if (!active.current) return;
          const state = scrollStateFromEvent(following.current, offset.current, scrollGeometry.current, e.nativeEvent,
            (dragging.current || gestureMomentum.current) && !keyboardMoving.current && !historyPullPending.current && !historyReading.current && e.nativeEvent.contentOffset.y >= 0, reportedInset.current);
          offset.current = state.offset;
          viewport.current = state.geometry.viewport; content.current = state.geometry.height;
          scrollGeometry.current = state.geometry;
          const follow = props.onLatest ? false : state.following;
          if (follow !== following.current) { following.current = follow; setShowLatest(!follow); }
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
      <Pressable accessibilityRole="button" accessibilityLabel="Jump to latest ↓" onPress={() => props.onLatest ? props.onLatest() : followLatest()} style={styles.latest}>
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

    <View collapsable={false} style={styles.composerSurface}>
      {/* Reported iOS input blur persists despite sibling layers. Remove the
          native effect as a fallback; Android retains its existing blur. */}
      {Platform.OS === 'android' && <BlurView pointerEvents="none" blurTarget={blurTarget} blurMethod="dimezisBlurViewSdk31Plus" intensity={72} tint="systemMaterialLight" style={styles.composerBackdrop} />}
      <View collapsable={false} style={styles.composerForeground}>
      {hasRunningReceipt(props.threadId, props.receipts) && <View style={styles.runningRow}>
        <View style={styles.runningIndicator}>{props.typingIndicator}</View>
        <Pressable accessibilityRole="button" accessibilityLabel="Stop" disabled={props.busy} onPress={props.onStop} style={[styles.statusStopButton, props.busy && styles.disabled]}>
          <Text style={styles.stopIcon}>■</Text>
        </Pressable>
      </View>}
      {props.composerAccessory ? props.composerAccessory(composerControls, setComposerHeight)
        : <View style={styles.composer} onLayout={e => setComposerHeight(e.nativeEvent.layout.height)}>{composerControls}</View>}
      </View>
    </View>
    </KeyboardStickyView>
  </KeyboardGestureArea>;
});

export function ConversationLoading({ active = true }: { active?: boolean }) {
  const [reduced, setReduced] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) setReduced(value); }).catch(() => {});
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    const app = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => { mounted = false; motion.remove(); app.remove(); };
  }, []);
  return <View testID="conversation-loading" style={styles.loading} accessible accessibilityLabel="Loading messages…" accessibilityLiveRegion="polite" accessibilityState={{ busy: true }}>
    {reduced ? <View style={styles.loadingStatic} accessible={false} /> : <ActivityIndicator size="small" color="#697b90" animating={active && foreground} accessible={false} />}
    <Text style={styles.locating}>Loading messages…</Text>
  </View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: { alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  loadingStatic: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#697b90' },
  // Keep the real content height: growing short content to the viewport makes
  // the keyboard controller scroll empty space and push top-aligned rows away.
  messages: { paddingTop: 12, paddingBottom: 96 },
  historyHint: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, gap: 6 },
  historyHintIcon: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  historyHintArrow: { color: '#697b90', fontSize: 14 },
  historyHintText: { color: '#697b90', fontSize: 12, lineHeight: 17, flexShrink: 1 },
  historyBoundary: { paddingVertical: 8, marginHorizontal: 14 },
  historyBoundaryLine: { height: StyleSheet.hairlineWidth, backgroundColor: '#bdccdf' },
  agentMessage: { alignSelf: 'stretch', minWidth: 0, marginHorizontal: 14, marginVertical: 5 },
  toolMessage: { marginVertical: 2 },
  finalReply: { marginHorizontal: 0, marginTop: 32, marginBottom: 8, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: '#f7f5ef' },
  systemNotice: { alignSelf: 'center', maxWidth: '92%', marginHorizontal: 14, marginVertical: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 10, backgroundColor: '#edf2f8', flexDirection: 'row', alignItems: 'center', gap: 8 },
  systemNoticeText: { color: '#50647b', fontSize: 12, lineHeight: 17, flexShrink: 1 },
  userMessageRow: { alignSelf: 'stretch', minWidth: 0, marginHorizontal: 14 },
  bubble: { backgroundColor: '#fff', padding: 13, marginHorizontal: 14, marginVertical: 5, borderRadius: 16, borderTopLeftRadius: 4, maxWidth: '90%', alignSelf: 'flex-start', borderWidth: 1, borderColor: '#e3e9f0' },
  // Shrink-wrap short content; longer messages wrap within the same 80% cap.
  // MessageContent list bodies retain an auto flex basis for intrinsic sizing.
  userMessageBubble: { alignSelf: 'flex-end', maxWidth: '80%', minWidth: 0, paddingVertical: 13, paddingHorizontal: 14, marginVertical: 5, borderRadius: 22, backgroundColor: '#f3f3f3' },
  workHeading: { marginHorizontal: 14, marginTop: 12, marginBottom: 8, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#dedede' },
  workToggle: { paddingVertical: 6, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6 },
  workLabel: { color: '#727272', fontSize: 15 },
  workHidden: { display: 'none' },
  byline: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }, attachment: { color: '#50647b', fontSize: 12, marginTop: 5 },
  failedActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
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
  // One shadow around the shared surface; blur never owns interactive content.
  composerSurface: { backgroundColor: 'rgba(248, 250, 253, 0.78)', boxShadow: '0 -4px 10px -4px rgba(23, 42, 64, 0.16)' },
  composerBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 0 },
  composerForeground: { zIndex: 1 },
  composer: { backgroundColor: 'transparent', borderTopWidth: 1, borderColor: 'rgba(205, 215, 227, 0.72)', paddingHorizontal: 10, paddingVertical: 7, flexDirection: 'row', alignItems: 'flex-end', gap: 5 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 12, minHeight: 42, paddingHorizontal: 12, paddingVertical: 8, color: '#172a40' }
});
