import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// Counts message body renders per row; the native boundary is replaced as in session-entry-composer.
const state = { bodies: new Map() };
globalThis.__rowRenders = state;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
const mocks = {
  'react-native': `export const Platform={OS:'ios'}; export const useWindowDimensions=()=>({fontScale:1}); export const AccessibilityInfo={isReduceMotionEnabled:async()=>false,addEventListener:()=>({remove(){}})}; export const AppState={currentState:'active',addEventListener:()=>({remove(){}})}; export const Alert={alert(){}}; export const ActivityIndicator='ActivityIndicator',Pressable='Pressable',ScrollView='ScrollView',View='View'; export const StyleSheet={create:x=>x,hairlineWidth:1};`,
  './FontSize': `export const Text='Text',TextInput='TextInput'; export const useFontSize=()=>({scale:1});`,
  'react-native-keyboard-controller': `import React from 'react'; export const KeyboardChatScrollView=React.forwardRef((p,r)=>{React.useImperativeHandle(r,()=>({scrollToEnd(){},scrollTo(){}}));return React.createElement('ChatScroll',p,p.children);}); export const KeyboardGestureArea='KeyboardGestureArea',KeyboardStickyView='KeyboardStickyView'; export const useKeyboardHandler=()=>{};`,
  'react-native-reanimated': `const fade={duration:()=>fade,reduceMotion:()=>fade,easing:()=>fade}; export const FadeIn=fade,LinearTransition=fade,Easing={out:x=>x,cubic:'cubic'},withTiming=x=>x,ReduceMotion={System:'System'},runOnJS=x=>x,useSharedValue=x=>({value:x}); export default {View:'AnimatedView'};`,
  'react-native-safe-area-context': `export const useSafeAreaInsets=()=>({bottom:0});`,
  'expo-blur': `export const BlurTargetView='BlurTargetView',BlurView='BlurView';`,
  './MessageContent': `const s=globalThis.__rowRenders; export const MessageContent=p=>{s.bodies.set(p.resourceId,(s.bodies.get(p.resourceId)??0)+1);return null;}; export const copyMessageText=()=>{};`,
  './WorkChevron': `export const WorkChevron='WorkChevron';`,
  './MessageTime': `export const MessageTime='MessageTime';`,
  './MessageToolbar': `export const MessageToolbar='MessageToolbar',MessageCopyButton='MessageCopyButton';`,
  './sessionNavigation': `export const useSessionNavigation=()=>({link(){},thread(){}});`,
};
const bundle = await build({ entryPoints: [new URL('../src/ChatTimeline.tsx', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'], plugins: [{ name: 'native-test-boundary', setup(b) {
  b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
  b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js' }));
} }] });
const mod = { exports: {} }; new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(mod, mod.exports, require);
const { ChatTimeline } = mod.exports;
// Stable callbacks, as the Thread page now passes them.
const defaults = { active: true, threadId: 't', rows: [], text: '', onText() {}, onSend() {}, receipts: [], interactions: [], answers: {}, onAnswerText() {}, onAnswer() {}, onCancel() {}, onStop() {}, busy: false };
const receipt = { id: 'r', thread_id: 't', client_message_id: 'u', state: 'running', processing: 'running', durable: true };
const user = { key: 'u', role: 'user', text: 'Request', timestamp: 1700000000, receipt };
const tool = n => ({ key: 'a' + n, role: 'assistant', text: 'Step ' + n, timestamp: 1700000000 + n, refSeq: n + 1 });
const counts = () => Object.fromEntries(state.bodies);

test('battery: a new tool row in a running turn renders only the new row', async () => {
  state.bodies.clear();
  let root;
  const rows = [user, tool(1), tool(2)];
  await act(async () => { root = create(React.createElement(ChatTimeline, { ...defaults, rows, receipts: [receipt] })); });
  try {
    const first = counts();
    assert.deepEqual(first, { u: 1, a1: 1, a2: 1 });
    await act(async () => root.update(React.createElement(ChatTimeline, { ...defaults, rows: [...rows, tool(3)], receipts: [receipt] })));
    assert.deepEqual(counts(), { u: 1, a1: 1, a2: 1, a3: 1 }, 'earlier rows of the running group do not render again');
    await act(async () => root.update(React.createElement(ChatTimeline, { ...defaults, rows: [...rows, tool(3)], receipts: [receipt], text: 'typing' })));
    assert.deepEqual(counts(), { u: 1, a1: 1, a2: 1, a3: 1 }, 'a parent render with unchanged rows renders no row');
  } finally { await act(async () => root.unmount()); }
});

test('battery: the final reply still updates the group heading of earlier rows', async () => {
  state.bodies.clear();
  let root;
  const rows = [user, tool(1), tool(2)];
  await act(async () => { root = create(React.createElement(ChatTimeline, { ...defaults, rows, receipts: [receipt] })); });
  try {
    const final = { key: 'f', role: 'assistant', displayKind: 'final', text: 'Result', timestamp: 1700000070, refSeq: 9 };
    const done = { ...user, receipt: { ...receipt, state: 'completed', processing: 'completed' } };
    await act(async () => root.update(React.createElement(ChatTimeline, { ...defaults, rows: [done, tool(1), tool(2), final] })));
    const labels = root.root.findAllByType('Text').map(node => node.props.children).filter(value => typeof value === 'string');
    assert.ok(labels.some(label => label.startsWith('Worked for ')), 'the heading shows the finished group');
    assert.ok(!labels.includes('Working'));
  } finally { await act(async () => root.unmount()); }
});
