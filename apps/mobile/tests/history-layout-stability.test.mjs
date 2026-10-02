import test from 'node:test';
import * as failedMessageActions from '../src/failedMessageActions.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import ts from 'typescript';
import React from 'react';
import { act, create } from 'react-test-renderer';
import * as timeline from '../src/timeline.ts';
import * as historyLayout from '../src/historyLayout.ts';
import * as attachmentHelpers from '../src/attachmentHelpers.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function load(source, modules, extras = {}) {
  const output = { exports: {} };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
    { module: output, exports: output.exports, require: name => { assert.ok(name in modules, name); return modules[name]; }, ...extras });
  return output.exports;
}
const row = (key, role, text = '') => ({ key, role, text });

test('render ahead is viewport-relative and bounded to a small window, not all history', () => {
  assert.equal(historyLayout.historyDrawDistance(600), 1200);
  assert.equal(historyLayout.historyDrawDistance(350), 700);
  for (const value of [0, -1, NaN, Infinity]) assert.equal(historyLayout.historyDrawDistance(value), 250);
});

test('compact tools/notices, user media and long prose have distinct prediction types without Markdown parsing', () => {
  assert.equal(historyLayout.historyItemType({ ...row('s', 'system'), displayKind: 'system_notice' }), 'notice');
  assert.equal(historyLayout.historyItemType({ ...row('t', 'assistant'), toolCalls: [{ id: 'call' }] }), 'tools');
  assert.equal(historyLayout.historyItemType(row('a', 'assistant', 'Short')), 'assistant');
  assert.equal(historyLayout.historyItemType(row('b', 'assistant', 'x'.repeat(2000))), 'assistant-long');
  assert.equal(historyLayout.historyItemType({ ...row('u', 'user'), attachments: [{ id: 'att' }] }), 'user-attachments');
  const text = { length: 5000, trim() { assert.fail('frequent callback must not scan full text'); } };
  assert.equal(historyLayout.historyItemType(row('c', 'assistant', text)), 'assistant-long');
});

async function chat() {
  const native = { Platform: { OS: 'ios' }, StyleSheet: { create: x => x }, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) } };
  for (const name of ['View','Pressable','RefreshControl','ScrollView']) native[name] = name;
  const commands = [];
  const modules = { react: React, 'react-native': native, './failedMessageActions': failedMessageActions, './historyLayout': historyLayout,
    '@shopify/flash-list': { FlashList: 'FlashList' }, './FontSize': { Text: 'Text', TextInput: 'TextInput' },
    'expo-blur': { BlurTargetView: 'BlurTargetView', BlurView: 'BlurView' },
    'react-native-reanimated': { View: 'View', FadeIn: { duration: () => ({ reduceMotion: () => undefined }) }, ReduceMotion: { System: 'system' }, runOnJS: fn => fn, useSharedValue: value => React.useRef({ value }).current },
    'react-native-keyboard-controller': { KeyboardChatScrollView: 'KeyboardChatScrollView', KeyboardGestureArea: 'KeyboardGestureArea', KeyboardStickyView: 'KeyboardStickyView', useKeyboardHandler() {} },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) }, './timeline': timeline,
    './MessageContent': { MessageContent: 'MessageContent' }, './MessageTime': { MessageTime: 'MessageTime' },
    './messageMarkdown': { messageNeedsViewport: () => false }, './receiptState': { hasRunningReceipt: () => false } };
  const { ChatTimeline } = load(readFileSync(new URL('../src/ChatTimeline.tsx', import.meta.url), 'utf8'), modules, { requestAnimationFrame: () => 1, cancelAnimationFrame() {} });
  let root;
  await act(async () => { root = create(React.createElement(ChatTimeline, { active: true, threadId: 't', rows: [row('a', 'assistant', 'Already loaded')], startRef: 1, hasOlder: false,
    onOlder() { assert.fail('scrolling must not load'); }, onPosition() {}, onVisibleRef() {}, text: '', onText() {}, onSend() {}, receipts: [], interactions: [], answers: {}, onAnswerText() {}, onAnswer() {}, onCancel() {}, onStop() {}, busy: false,
    position: { offset: 400, following: false, startRef: 1 } }), { createNodeMock: node => node.type === 'FlashList' ? { scrollToOffset: command => commands.push(command), getScrollResponder: () => ({ scrollToEnd: command => commands.push(command) }) } : null }); });
  return { root, commands, list: () => root.root.findByType('FlashList').props };
}

test('production timeline forwards two-screen draw distance and stable item classifier without a competing anchor', async () => {
  const h = await chat(); const config = h.list().maintainVisibleContentPosition;
  await act(async () => h.list().onLayout({ nativeEvent: { layout: { height: 600 } } }));
  assert.equal(h.list().drawDistance, 1200); assert.equal(h.list().getItemType, historyLayout.historyItemType);
  assert.equal(h.list().maintainVisibleContentPosition, config); assert.equal(config.disabled, false);
  await act(async () => h.list().onLayout({ nativeEvent: { layout: { height: 350 } } }));
  assert.equal(h.list().drawDistance, 700); assert.equal(h.list().maxItemsInRecyclePool, 0);
  // Complete the ordinary initial restore before testing already-loaded reading.
  await act(async () => h.list().onContentSizeChange(400, 2000));
  assert.equal(h.commands.length, 1); h.commands.length = 0;
  await act(async () => {
    h.list().onScrollBeginDrag();
    h.list().onScroll({ nativeEvent: { contentOffset: { y: 300 }, contentSize: { height: 2000 }, layoutMeasurement: { height: 350 }, contentInset: { bottom: 0 } } });
    h.list().onScrollEndDrag({ nativeEvent: { contentOffset: { y: 300 }, velocity: { y: 0 } } });
    h.list().onContentSizeChange(400, 2030);
  });
  assert.equal(h.commands.length, 0, 'reading already loaded content cannot issue app-level scroll correction');
  await act(async () => h.root.unmount());
});

// Installed useLayoutState is exercised directly; native/file/network objects
// below are explicit doubles, not physical iPhone geometry or actual downloads.
const LayoutContext = React.createContext(null);
const { useLayoutState } = load(readFileSync(new URL('../node_modules/@shopify/flash-list/src/recyclerview/hooks/useLayoutState.ts', import.meta.url), 'utf8'),
  { react: React, '../RecyclerViewContextProvider': { useRecyclerViewContext: () => React.useContext(LayoutContext) } });
async function attachmentRow() {
  let finish; const layoutEvents = [], disk = new Map();
  class File { constructor(...parts) { this.uri = `file://synthetic-${parts.at(-1)}`; } get exists() { return disk.has(this.uri); } create() { disk.set(this.uri, null); } write(bytes) { disk.set(this.uri, bytes); } delete() { disk.delete(this.uri); } }
  const native = { Platform: { OS: 'ios' }, StyleSheet: { create: x => x }, useWindowDimensions: () => ({ width: 400, height: 800 }) };
  for (const name of ['Image','Pressable','ScrollView','View']) native[name] = name;
  const modules = { react: React, 'react-native': native, './FontSize': { Text: 'Text' }, '@shopify/flash-list': { useLayoutState },
    'expo-image-picker': {}, 'expo-document-picker': {}, 'expo-clipboard': {}, 'expo-file-system': { File, Paths: { cache: 'synthetic-cache' } },
    'base64-js': { toByteArray() {} }, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    './attachmentHelpers': attachmentHelpers, './Viewers': { useViewer: () => ({ openViewer() {} }) } };
  const source = readFileSync(process.env.HISTORY_ATTACHMENTS_SOURCE ?? new URL('../src/Attachments.tsx', import.meta.url), 'utf8');
  const { MessageAttachments } = load(source, modules, { AbortController, Uint8Array, Date, Math });
  const client = { download: () => new Promise(resolve => { finish = resolve; }) };
  let root;
  await act(async () => { root = create(React.createElement(LayoutContext.Provider, { value: { layout: () => layoutEvents.push('layout') } },
    React.createElement(MessageAttachments, { client, threadId: 't', attachments: [{ id: 'att_test', name: 'Synthetic.png', mime: 'image/png', size: 2, state: 'available' }] }))); });
  const slot = () => root.root.findAllByType('View').find(node => node.props.style?.width === 62 && node.props.style?.height === 62);
  return { root, slot, layoutEvents, disk,
    async finish() { await act(async () => finish(Uint8Array.from([1,2]))); },
    async close() { await act(async () => root.unmount()); } };
}

test('loading and remount of a known image reserve identical thumbnail geometry before bytes exist', async () => {
  const h = await attachmentRow();
  assert.ok(h.slot(), 'loading row must already reserve the 62px thumbnail slot');
  const style = h.slot().props.style; assert.equal(h.root.root.findAllByType('Image').length, 0);
  await h.finish(); assert.equal(h.root.root.findAllByType('Image').length, 1);
  assert.equal(h.slot().props.style, style);
  await h.close(); assert.equal(h.disk.size, 0);
  const again = await attachmentRow(); assert.ok(again.slot()); assert.equal(again.slot().props.style.height, style.height);
  await again.close();
});

test('production image state updates notify installed FlashList layout hook, not only a later onLayout', async () => {
  const h = await attachmentRow(); const before = h.layoutEvents.length;
  assert.ok(before > 0, 'initial/loading state participates in layout coordination');
  await h.finish(); assert.ok(h.layoutEvents.length > before);
  await h.close();
});

// Use the installed layout manager + controller for final content coordinates;
// measured dimensions and native scrollBy are controlled inputs, not new math.
const compiled = buildSync({ entryPoints: [new URL('../node_modules/@shopify/flash-list/src/recyclerview/layout-managers/LinearLayoutManager.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'cjs', external: ['react-native'], write: false }).outputFiles[0].text;
const lmOutput = { exports: {} };
runInNewContext(compiled, { module: lmOutput, exports: lmOutput.exports, require: name => { assert.equal(name, 'react-native'); return { PixelRatio: { getPixelSizeForLayoutSize: Math.round, roundToNearestPixel: value => value } }; } });
const { RVLinearLayoutManagerImpl } = lmOutput.exports;
const { useRecyclerViewController } = load(readFileSync(new URL('../node_modules/@shopify/flash-list/src/recyclerview/hooks/useRecyclerViewController.tsx', import.meta.url), 'utf8'), {
  react: React, 'react-native': { I18nManager: { isRTL: false } }, '../utils/adjustOffsetForRTL': { adjustOffsetForRTL: value => value },
  '../../native/config/PlatformHelper': { PlatformConfig: { supportsOffsetCorrection: true } }, '../../errors/WarningMessages': {},
  './useUnmountFlag': { useUnmountFlag: () => React.useRef(false) }, './useUnmountAwareCallbacks': { useUnmountAwareTimeout: () => ({ setTimeout() {} }) }
});

test('final measured batch preserves CURRENT anchor viewport coordinate and never undoes deliberate user scrolling', async () => {
  const data = [row('attachment','user'),row('prose','assistant'),row('reading','assistant'),row('tail','assistant')];
  const layout = new RVLinearLayoutManagerImpl({ windowSize: { width: 400, height: 600 }, horizontal: false, maxColumns: 1,
    getItemType: index => historyLayout.historyItemType(data[index]), overrideItemLayout() {} });
  const measured = heights => layout.modifyLayout(heights.map((height,index) => ({ index, dimensions: { width: 400, height } })), data.length);
  measured([74,200,100,200]);
  let visible = 2, offset = layout.getLayout(visible).y - 240, api;
  const corrections = [];
  const manager = { props: { data, horizontal: false }, getDataLength: () => data.length, getIsFirstLayoutComplete: () => true,
    hasStableDataKeys: () => true, shouldMaintainVisibleContentPosition: () => true, getDataKey: index => data[index].key,
    getLayout: index => layout.getLayout(index), computeVisibleIndices: () => ({ startIndex: visible }),
    getEngagedIndices: () => ({ findValue: predicate => data.findIndex((_,index) => predicate(index)) }),
    getAbsoluteLastScrollOffset: () => offset, updateScrollOffset() {}, ignoreScrollEvents: false, animationOptimizationsEnabled: false };
  function Harness() { api = useRecyclerViewController(manager, React.useRef(null), React.useRef({}), React.useRef({ scrollBy: delta => { offset += delta; corrections.push(delta); } })); return null; }
  let root; await act(async () => { root = create(React.createElement(Harness)); });
  await act(async () => api.computeFirstVisibleIndexForOffsetCorrection());
  const original = layout.getLayout(visible).y - offset;
  measured([94,210,100,200]); await act(async () => api.applyOffsetCorrection());
  assert.equal(layout.getLayout(visible).y - offset, original);
  assert.equal(corrections.length, 1, 'one correction for final batch, not an app scroll loop');
  // The reader moves: capture the current visible key, not the old reading key.
  visible = 1; offset = 140; await act(async () => api.computeFirstVisibleIndexForOffsetCorrection());
  const current = layout.getLayout(visible).y - offset;
  measured([114,210,100,200]); await act(async () => api.applyOffsetCorrection());
  assert.equal(layout.getLayout(visible).y - offset, current);
  const count = corrections.length; await act(async () => api.applyOffsetCorrection()); assert.equal(corrections.length, count);
  await act(async () => root.unmount());
});
