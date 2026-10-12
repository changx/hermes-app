import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, AppState, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text, TextInput, useFontSize } from './FontSize';
import type { LayoutChangeEvent } from 'react-native';
import { KeyboardChatScrollView, KeyboardGestureArea, KeyboardStickyView, useKeyboardHandler } from 'react-native-keyboard-controller';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurTargetView, BlurView } from 'expo-blur';
import type { Interaction, Receipt } from '../../../packages/client/src/index';
import { agentOutputAdded, appendedAtEnd, scrollStateFromEvent, type ScrollGeometry, type TimelinePosition, type TimelineRow } from './timeline';

import { MessageContent, copyMessageText } from './MessageContent';
import { WorkChevron } from './WorkChevron';
import { MessageTime } from './MessageTime';
import { ComposerCard, ComposerSendButton } from './ComposerCard';
import { workGroups, workIsExpanded, type WorkChoice, type WorkGroup } from '../../../packages/client/src/workPresentation';
import { hasRunningReceipt } from './receiptState';
import { chatDateSeparators, hasWaitingRequest, needsWorkPlaceholder, processingWarning } from '../../../packages/client/src/chatPresentation';
import { failedMessageId, confirmFailedMessageDelete } from './failedMessageActions';
import { MessageToolbar, type MessageActions } from './MessageToolbar';
import { useSessionNavigation } from './sessionNavigation';

/** Notice text with its Markdown session links (e.g. a branch link) as tappable spans. */
const noticeLink = /\[([^\]\n]{1,300})\]\((hermesapp:\/\/session\/[^)\s]{1,400})\)/g;
function NoticeText({ text }: { text: string }) {
  const navigation = useSessionNavigation();
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(noticeLink)) {
    if (match.index > at) parts.push(text.slice(at, match.index));
    const href = match[2];
    parts.push(<Text key={match.index} accessibilityRole="link" style={styles.noticeLink} onPress={() => navigation.link(href)}>{match[1]}</Text>);
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <Text style={styles.systemNoticeText}>{parts}</Text>;
}
const noticeLabel = (text: string) => text.replace(noticeLink, '$1');


const action = (title: string, onPress: () => void, disabled = false, muted = false) => <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress} style={[styles.action, muted && styles.muted, disabled && styles.disabled]}><Text style={[styles.actionText, muted && styles.mutedText]}>{title}</Text></Pressable>;
const MessageRow = memo(function MessageRow({ row, onCancel, onDeleteFailed, onRetryFailed, busy, renderAttachments, highlighted, work, workExpanded = true, onWorkToggle, actions, canRetry = false, running = false }: { row: TimelineRow; onCancel: (receipt: Receipt) => void; onDeleteFailed?: (id: string) => void; onRetryFailed?: (id: string) => void; busy: boolean; renderAttachments?: (row: TimelineRow) => React.ReactNode; highlighted?: boolean; work?: WorkGroup; workExpanded?: boolean; onWorkToggle?: (group: WorkGroup, expanded: boolean) => void; actions?: MessageActions; canRetry?: boolean; running?: boolean }) {
  const own = row.role === 'user';
  const revealed = useRef({ key: row.key, value: false });
  if (revealed.current.key !== row.key) revealed.current = { key: row.key, value: false };
  if (!work || workExpanded) revealed.current.value = true;
  if (row.displayKind === 'system_notice') return <View accessible={!row.text.includes('](hermesapp://')} accessibilityLabel={`System notice: ${noticeLabel(row.text)}`} style={styles.systemNotice}>
    <NoticeText text={row.text} /><MessageTime seconds={row.timestamp} />
  </View>;
  const toolsOnly = row.role === 'assistant' && !row.text.trim() && !!row.toolCalls?.length;
  const finalReply = row.role === 'assistant' && row.displayKind === 'final';
  const failedId = failedMessageId(row);
  const warning = row.reaction && ['Awaiting approval', 'Awaiting your answer'].includes(row.reaction.label) ? row.reaction.label : processingWarning(row.receipt?.state, row.receipt?.processing);
  const messageStyle = own ? styles.userMessageBubble : row.role === 'assistant' ? [styles.agentMessage, toolsOnly && styles.toolMessage, finalReply && styles.finalReply] : styles.bubble;
  const contentStyle = work && !workExpanded ? [messageStyle, styles.workHidden] : messageStyle;
  const content = <View accessibilityElementsHidden={!!work && !workExpanded} importantForAccessibility={work && !workExpanded ? 'no-hide-descendants' : 'auto'} style={highlighted ? [contentStyle, { backgroundColor: '#d9eaff' }] : contentStyle}>
    {!own && row.role !== 'assistant' && !row.continuation && <View style={styles.byline}><MessageTime seconds={row.timestamp} /></View>}
    {revealed.current.value && <MessageContent key={row.key} resourceId={row.key} text={row.text} toolCalls={row.role === 'assistant' ? row.toolCalls : undefined} canExpand={row.role === 'assistant'} pending={own && !!row.optimistic && row.status !== 'accepted'} />}
    {revealed.current.value && finalReply && row.refSeq !== undefined && !!actions && <MessageToolbar row={row} actions={actions} canRetry={canRetry} running={running} />}
    {own && !!row.feedback && <Text accessibilityLabel={`Feedback after receipt: ${row.feedback}`} style={styles.feedback}>{row.feedback}</Text>}
    {!!row.sendError && <Text accessibilityLiveRegion="polite" style={styles.sendError}>{row.sendError}</Text>}
    {!!failedId && <View style={styles.failedActions}>
      {!!onRetryFailed && action('Retry', () => onRetryFailed(failedId), busy)}
      {!!row.text && action('Copy', () => copyMessageText(row.text))}
      {!!onDeleteFailed && action('Delete', () => confirmFailedMessageDelete(row, onDeleteFailed, Alert.alert), busy)}
    </View>}
    {revealed.current.value && (renderAttachments ? renderAttachments(row) : row.attachments?.map(a => <Text key={a.id} style={styles.attachment}>Attachment: {a.name || 'Unnamed attachment'} ({a.state === 'available' ? 'Available' : 'Unavailable for now'})</Text>))}
    {(warning || row.receipt?.state === 'queued') && <View style={styles.messageWarning}>
      {warning && <Text accessibilityLiveRegion="polite" style={styles.sendError}>{warning}</Text>}
      {row.receipt?.state === 'queued' && <Pressable accessibilityRole="button" accessibilityLabel="Cancel queued message" disabled={busy} hitSlop={8} onPress={() => onCancel(row.receipt!)}><Text style={styles.cancelText}>Cancel</Text></Pressable>}
    </View>}
    {own && <View testID="user-message-time" style={styles.messageTime}><MessageTime seconds={row.timestamp} clockOnly /></View>}
  </View>;
  return <>{work?.key === row.key && <View style={styles.workHeading}><Pressable accessibilityRole="button" accessibilityLabel={work.label} accessibilityState={{ expanded: workExpanded }} onPress={() => onWorkToggle?.(work, !workExpanded)} style={styles.workToggle}><Text style={styles.workLabel}>{work.label}</Text><WorkChevron expanded={workExpanded} /></Pressable></View>}{own ? <View style={styles.userMessageRow}>{content}</View> : content}</>;
}, (prev, next) => prev.actions === next.actions && prev.canRetry === next.canRetry && prev.running === next.running && prev.work === next.work && prev.workExpanded === next.workExpanded && prev.onWorkToggle === next.onWorkToggle && prev.highlighted === next.highlighted && prev.renderAttachments === next.renderAttachments && prev.busy === next.busy && prev.onDeleteFailed === next.onDeleteFailed && prev.onRetryFailed === next.onRetryFailed && prev.onCancel === next.onCancel && prev.row.receipt?.state === next.row.receipt?.state && prev.row.receipt?.processing === next.row.receipt?.processing && prev.row.key === next.row.key && prev.row.text === next.row.text && prev.row.displayKind === next.row.displayKind && prev.row.model === next.row.model && prev.row.timestamp === next.row.timestamp && prev.row.toolCalls === next.row.toolCalls && prev.row.continuation === next.row.continuation && prev.row.status === next.row.status && prev.row.optimistic === next.row.optimistic && prev.row.refSeq === next.row.refSeq && prev.row.reactionSlot === next.row.reactionSlot && prev.row.reaction?.label === next.row.reaction?.label && prev.row.feedback === next.row.feedback && prev.row.sendError === next.row.sendError && prev.row.attachments === next.row.attachments);

export interface ChatTimelineHandle { followLatest(animate?: boolean): void; pasteText(text: string): void }
type ScrollTarget = { scrollToEnd(options: { animated: boolean }): void; scrollTo(options: { y: number; animated: boolean }): void };
interface Props {
  active: boolean;
  threadId: string;
  rows: TimelineRow[];
  targetRef?: number;
  onLatest?(): void;
  locatingMessage?: string;
  onLocateNext?: () => void;
  locatingBusy?: boolean;
  position?: Pick<TimelinePosition, 'following'>;
  onVisibleRefs?(refs: number[]): void;


  text: string;
  onText(value: string): void;
  onSend(): void;
  composerAccessory?: (parts: ComposerParts, onHeight: (height: number) => void) => React.ReactNode;
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
  /** Toolbar under each final reply; Retry only on the latest one. */
  messageActions?: MessageActions;
}
/** The input keeps one tree position; the accessory places it in a ComposerCard. */
export type ComposerParts = { input: React.ReactNode; send: React.ReactNode; expanded: boolean; onPressField: () => void };
export const ChatTimeline = forwardRef<ChatTimelineHandle, Props>(function ChatTimeline(props, ref) {
  const { rows, position } = props;
  const { scale } = useFontSize();
  const { fontScale } = useWindowDimensions();
  const composerLineHeight = Platform.OS === 'ios' ? 22 : 19;
  const composerMaxHeight = composerLineHeight * scale * fontScale * 6;
  const [workChoices, setWorkChoices] = useState<Record<string, WorkChoice>>({});
  const workMessages = rows.map(row => ({ key: row.key, role: row.role, kind: row.displayKind, seconds: row.timestamp,
    waiting: row.role === 'user' && (row.optimistic && ['queued', 'sending', 'ambiguous'].includes(row.status ?? '') || !!row.receipt && ['queued', 'running'].includes(row.receipt.state) && (row.receipt.processing == null || row.receipt.processing === 'running')) }));
  const paused = props.interactions.some(interaction => interaction.thread_id === props.threadId && interaction.state === 'pending');
  const running = !paused && (hasRunningReceipt(props.threadId, props.receipts) || hasWaitingRequest(workMessages));
  const groups = workGroups(workMessages, running);
  // Retry re-runs only the latest turn (core /retry): the last final reply with no later input.
  const retryKey = (() => {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].role === 'user') return undefined;
      if (rows[i].role === 'assistant' && rows[i].displayKind === 'final') return rows[i].key;
    }
    return undefined;
  })();
  const dateSeparators = chatDateSeparators(workMessages);
  const awaitingWork = !paused && !props.locatingBusy && needsWorkPlaceholder(workMessages, groups, running);
  const onWorkToggle = useCallback((group: WorkGroup, expanded: boolean) => setWorkChoices(old => ({ ...old, [`${props.threadId}:${group.key}`]: { completion: group.completion, expanded } })), [props.threadId]);
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
  const [inputFocused, setInputFocused] = useState(false);
  const textSelection = useRef<{ start: number; end: number } | null>(null);
  const reportedInset = useRef(0);

  // One plain native ScrollView renders the complete transcript. No list
  // virtualization: every row stays mounted, so positions are real layout.
  const list = useRef<ScrollTarget | null>(null);
  const visibleCallback = useRef(props.onVisibleRefs);
  visibleCallback.current = props.onVisibleRefs;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const rowFrames = useRef(new Map<string, { y: number; height: number }>());
  const lastVisible = useRef('');

  const following = useRef(position?.following ?? true);
  const [showLatest, setShowLatest] = useState(!following.current);
  const offset = useRef(0);
  const viewport = useRef(0), dragging = useRef(false), gestureMomentum = useRef(false), momentumEligible = useRef(false);
  const keyboardMoving = useRef(false);
  const nativeMoving = useSharedValue(false);
  const scrollGeometry = useRef<ScrollGeometry | null>(null);
  const reducedMotion = useRef(false);
  const motionForeground = useRef(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  // Source navigation scrolls once to the measured target row.
  const targetPending = useRef(props.targetRef !== undefined);
  // Hide the first frame until the initial bottom/target position is applied,
  // so the reader never sees the transcript start and then jump.
  const [positioned, setPositioned] = useState(false);
  const markPositioned = useCallback(() => setPositioned(true), []);
  useEffect(() => { if (positioned) return; const timer = setTimeout(markPositioned, 600); return () => clearTimeout(timer); }, [positioned, markPositioned]);

  const frame = useRef<number | null>(null);
  // Native-stack keeps the departing screen mounted during an interactive
  // swipe-back. Never address its scroll view once the route has lost focus.
  const active = useRef(props.active);
  active.current = props.active;
  const blurTarget = useRef<View | null>(null);
  const followAnimation = useRef(false);
  const pendingFollow = useRef(false);

  const reportVisible = useCallback(() => {
    if (!viewport.current) return;
    const top = offset.current, end = top + viewport.current, refs: number[] = [];
    for (const row of rowsRef.current) {
      const box = rowFrames.current.get(row.key);
      if (!box || row.refSeq === undefined) continue;
      if (box.y + box.height > top && box.y < end) refs.push(row.refSeq);
    }
    if (sourceTarget.current !== undefined && refs.includes(sourceTarget.current)) setHighlightVisible(true);
    const signature = refs.join(',');
    if (signature === lastVisible.current) return;
    lastVisible.current = signature;
    visibleCallback.current?.(refs);
  }, []);
  const scrollToEnd = useCallback((animated: boolean) => {
    list.current?.scrollToEnd({ animated });
    setPositioned(true);
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
      scrollToEnd(animated);
    });
  }, [scrollToEnd]);
  const setKeyboardMoving = useCallback((moving: boolean) => {
    keyboardMoving.current = moving;
    if (!moving && pendingFollow.current) scheduleFollow();
  }, [scheduleFollow]);
  const onContentInsetChange = useCallback((insets: { bottom: number }) => {
    if (reportedInset.current === insets.bottom) return;
    reportedInset.current = insets.bottom;
    if (following.current) scheduleFollow();
  }, [scheduleFollow]);
  useKeyboardHandler({
    onStart: () => { 'worklet'; if (!nativeMoving.value) { nativeMoving.value = true; runOnJS(setKeyboardMoving)(true); } },
    onInteractive: () => { 'worklet'; if (!nativeMoving.value) { nativeMoving.value = true; runOnJS(setKeyboardMoving)(true); } },
    onEnd: () => { 'worklet'; nativeMoving.value = false; runOnJS(setKeyboardMoving)(false); }
  }, [setKeyboardMoving]);
  useEffect(() => {
    let mounted = true;
    active.current = props.active;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) reducedMotion.current = value; }, () => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', value => { reducedMotion.current = value; });
    const app = AppState.addEventListener('change', state => {
      motionForeground.current = state === 'active';
      if (state !== 'active') {
        if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
        dragging.current = false; gestureMomentum.current = false; momentumEligible.current = false;
        keyboardMoving.current = false; nativeMoving.value = false;
        pendingFollow.current = false; followAnimation.current = false;
      }
    });
    return () => { mounted = false; active.current = false; sub.remove(); app.remove(); if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, []);
  useEffect(() => {
    if (props.active) return;
    dragging.current = false; gestureMomentum.current = false; momentumEligible.current = false;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    keyboardMoving.current = false; nativeMoving.value = false;
    pendingFollow.current = false; followAnimation.current = false;
  }, [props.active]);
  const followLatest = useCallback((animate = true) => {
    if (!active.current) return;
    following.current = true; setShowLatest(false);
    // An explicit send/latest action overrides any older gesture momentum.
    dragging.current = false; gestureMomentum.current = false; momentumEligible.current = false;
    if (!animate) followAnimation.current = false;
    if (!keyboardMoving.current) scrollToEnd(animate && !reducedMotion.current);
    // The optimistic row and cleared composer can commit after this call.
    scheduleFollow(keyboardMoving.current && animate);
  }, [scheduleFollow, scrollToEnd]);
  useImperativeHandle(ref, () => ({ followLatest, pasteText(text: string) {
    const start = Math.min(textSelection.current?.start ?? props.text.length, props.text.length);
    const end = Math.max(start, Math.min(textSelection.current?.end ?? start, props.text.length));
    props.onText(props.text.slice(0, start) + text + props.text.slice(end));
    textSelection.current = { start: start + text.length, end: start + text.length };
  } }), [followLatest, props.text, props.onText]);
  const previousRows = useRef<readonly TimelineRow[]>([]);
  useEffect(() => {
    const before = previousRows.current;
    const firstHistory = before.length === 0 && rows.length > 0;
    const appended = appendedAtEnd(before.map(row => row.key), rows.map(row => row.key));
    const newOutput = agentOutputAdded(before, rows);
    previousRows.current = rows;
    const keys = new Set(rows.map(row => row.key));
    for (const key of rowFrames.current.keys()) if (!keys.has(key)) rowFrames.current.delete(key);
    // New output should appear at the tail without visibly scrolling the whole
    // conversation. Explicit send/latest actions remain animated.
    if ((newOutput || appended || firstHistory && sourceTarget.current === undefined) && following.current) scheduleFollow();
  }, [rows, scheduleFollow]);
  const onRowLayout = useCallback((row: TimelineRow, event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    rowFrames.current.set(row.key, { y, height });
    if (targetPending.current && row.refSeq !== undefined && row.refSeq === sourceTarget.current && active.current) {
      targetPending.current = false;
      requestAnimationFrame(() => { list.current?.scrollTo({ y: Math.max(0, y - 12), animated: false }); setPositioned(true); });
    }
    reportVisible();
  }, [reportVisible]);

  const composerInputNode = <TextInput ref={composerInput} nativeID={composerID} accessibilityLabel="Message text" multiline
    // Fabric iOS: reset empty measurement without fixing font height.
    // Android setLines also fixes the widget's height, so leave it unset there.
    numberOfLines={Platform.OS === 'ios' && props.text.length === 0 ? 1 : undefined}
    onFocus={() => setInputFocused(true)} onBlur={() => setInputFocused(false)}
    style={[styles.composeInput, { lineHeight: composerLineHeight, maxHeight: composerMaxHeight }]} scrollEnabled underlineColorAndroid="transparent" placeholder="Message…" value={props.text} onChangeText={props.onText} onSelectionChange={e => { textSelection.current = e.nativeEvent.selection; }} />;
  const composerParts: ComposerParts = { input: composerInputNode, expanded: inputFocused, onPressField: () => composerInput.current?.focus(),
    send: <ComposerSendButton onPress={props.onSend} disabled={props.busy || !!props.attachmentsBusy || (!props.text.trim() && !props.attachmentCount)} busy={props.busy} /> };
  return <KeyboardGestureArea style={styles.flex} interpolator="ios" textInputNativeID={composerID} offset={composerHeight}>
    <BlurTargetView ref={blurTarget} collapsable={false} style={styles.flex}>
      <KeyboardChatScrollView ref={list as never} testID="chat-history" style={[styles.flex, !positioned && rows.length > 0 && styles.unpositioned]}
        automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never"
        // RN 0.81+ otherwise loses drag touches in the contentInset/blank area.
        applyWorkaroundForContentInsetHitTestBug
        offset={bottom} keyboardLiftBehavior="whenAtEnd" onContentInsetChange={onContentInsetChange}
        contentContainerStyle={styles.messages} keyboardShouldPersistTaps="always" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} alwaysBounceVertical={Platform.OS === 'ios'}
        onLayout={e => {
          if (!active.current) return;
          viewport.current = e.nativeEvent.layout.height;
          if (following.current) scheduleFollow();
          reportVisible();
        }}
        onContentSizeChange={(_, height) => {
          if (!active.current) return;
          // onScroll may already have reported this height. Always reconcile
          // the measured extent; scheduleFollow owns gesture/keyboard guards.
          if (following.current && height > 0) scheduleFollow();
        }}
        onScrollBeginDrag={() => {
          if (!active.current || !motionForeground.current) return;
          dragging.current = true; gestureMomentum.current = false; momentumEligible.current = false; followAnimation.current = false; pendingFollow.current = false;
        }}
        onMomentumScrollBegin={() => { gestureMomentum.current = momentumEligible.current; momentumEligible.current = false; }}
        onScrollEndDrag={e => {
          if (!active.current || !motionForeground.current || !dragging.current) return;
          dragging.current = false;
          momentumEligible.current = e.nativeEvent.contentOffset?.y >= 0 && Math.abs(e.nativeEvent.velocity?.y ?? 0) > 0.01;
        }}
        onMomentumScrollEnd={() => { gestureMomentum.current = false; momentumEligible.current = false; }}
        onScroll={e => {
          if (!active.current) return;
          const previousGeometry = scrollGeometry.current;
          const state = scrollStateFromEvent(following.current, offset.current, scrollGeometry.current, e.nativeEvent,
            (dragging.current || gestureMomentum.current) && !keyboardMoving.current && e.nativeEvent.contentOffset.y >= 0, reportedInset.current);
          offset.current = state.offset;
          viewport.current = state.geometry.viewport;
          scrollGeometry.current = state.geometry;
          const follow = props.onLatest ? false : state.following;
          if (follow !== following.current) { following.current = follow; setShowLatest(!follow); }
          if (following.current && previousGeometry && (previousGeometry.height !== state.geometry.height
            || previousGeometry.viewport !== state.geometry.viewport || previousGeometry.inset !== state.geometry.inset)) scheduleFollow();
          reportVisible();
        }} scrollEventThrottle={16}>
        {props.locatingMessage && <View style={styles.older}><Text style={styles.locating}>{props.locatingMessage}</Text>
          {props.onLocateNext && action('Keep looking', props.onLocateNext, props.locatingBusy, true)}</View>}
        {rows.length ? rows.map(item => <View key={item.key} collapsable={false} onLayout={e => onRowLayout(item, e)}>
          {dateSeparators.has(item.key) && <View testID="chat-date-separator" style={styles.dateSeparator}><Text style={styles.dateLabel}>{dateSeparators.get(item.key)}</Text></View>}
          <MessageRow row={item} onCancel={props.onCancel} onDeleteFailed={props.onDeleteFailed} onRetryFailed={props.onRetryFailed} busy={props.busy} renderAttachments={props.renderAttachments}
            actions={props.messageActions} canRetry={item.key === retryKey} running={running || paused}
            work={groups.get(item.key)} workExpanded={!groups.has(item.key) || workIsExpanded(groups.get(item.key)!, workChoices[`${props.threadId}:${groups.get(item.key)!.key}`])} onWorkToggle={onWorkToggle}
            highlighted={highlightedRef !== undefined && item.refSeq === highlightedRef} />
        </View>)
          : props.locatingBusy ? <ConversationLoading active={props.active} /> : props.locatingMessage ? null : <Text style={styles.empty}>No messages yet</Text>}
        {awaitingWork && <View testID="awaiting-agent-work" style={styles.workHeading} accessibilityLiveRegion="polite"><View style={styles.workToggle}><Text style={styles.workLabel}>Working</Text><WorkChevron expanded /></View></View>}
      </KeyboardChatScrollView>

    </BlurTargetView>
    <KeyboardStickyView pointerEvents="box-none" style={{ marginTop: showLatest ? -latestRowHeight : 0, zIndex: 1 }} offset={{ opened: bottom }} onLayout={e => {
      if (!active.current) return;
      const height = e.nativeEvent.layout.height;
      if (dockHeight.current !== height) {
        const hadDock = dockHeight.current > 0;
        dockHeight.current = height;
        // A growing composer/controls shrinks the flex list; only follow if already at latest.
        if (hadDock && following.current && !keyboardMoving.current) scheduleFollow();
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
        <Pressable accessibilityRole="button" accessibilityLabel="Stop" hitSlop={8} disabled={props.busy} onPress={props.onStop}
          style={({ pressed }) => [styles.statusStopButton, pressed && styles.statusStopPressed, props.busy && styles.disabled]}>
          <View style={styles.stopIcon} />
          <Text style={styles.stopText}>Stop</Text>
        </Pressable>
      </View>}
      {props.composerAccessory ? props.composerAccessory(composerParts, setComposerHeight)
        : <ComposerCard expanded={inputFocused} send={composerParts.send} onPressField={composerParts.onPressField}
          onLayout={e => setComposerHeight(e.nativeEvent.layout.height + 14)}>{composerInputNode}</ComposerCard>}
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
  unpositioned: { opacity: 0 },
  agentMessage: { alignSelf: 'stretch', minWidth: 0, marginHorizontal: 14, marginVertical: 5 },
  toolMessage: { marginVertical: 2 },
  finalReply: { marginHorizontal: 0, marginTop: 32, marginBottom: 8, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: '#f7f5ef' },
  systemNotice: { alignSelf: 'center', maxWidth: '92%', marginHorizontal: 14, marginVertical: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 10, backgroundColor: '#edf2f8', flexDirection: 'row', alignItems: 'center', gap: 8 },
  systemNoticeText: { color: '#50647b', fontSize: 12, lineHeight: 17, flexShrink: 1 },
  noticeLink: { color: '#215ca7', textDecorationLine: 'underline' },
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
  messageTime: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 5 },
  dateSeparator: { alignItems: 'center', marginVertical: 16, marginHorizontal: 14 },
  dateLabel: { color: '#697b90', fontSize: 12 },
  failedActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  messageWarning: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 5 }, cancelText: { color: '#294e7b', fontSize: 12 }, sendError: { color: '#9d1b32', fontSize: 12, marginTop: 5 },
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

  // Stop follows the running text as a quiet outlined pill.
  runningRow: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 14, paddingRight: 10 },
  runningIndicator: { flexShrink: 1, minWidth: 0 },
  statusStopButton: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 26, paddingLeft: 9, paddingRight: 11, borderRadius: 13, borderWidth: 1, borderColor: '#d3dce8' },
  statusStopPressed: { backgroundColor: '#eef2f8', borderColor: '#c4d0e0' },
  stopIcon: { width: 8, height: 8, borderRadius: 2, backgroundColor: '#425874' },
  stopText: { color: '#425874', fontSize: 12, fontWeight: '600' },
  composeInput: { padding: 0, color: '#1f2329' },
  // One shadow around the shared surface; blur never owns interactive content.
  composerSurface: { backgroundColor: 'rgba(248, 250, 253, 0.78)', boxShadow: '0 -4px 10px -4px rgba(23, 42, 64, 0.16)' },
  composerBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 0 },
  composerForeground: { zIndex: 1 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cdd7e3', borderRadius: 12, minHeight: 42, paddingHorizontal: 12, paddingVertical: 8, color: '#172a40' }
});
