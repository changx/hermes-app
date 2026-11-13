import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { createRequire } from 'node:module';
import { projectTimeline } from '../src/timeline.ts';
const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// Counts message body renders per row; the native boundary is replaced as in session-entry-composer.
const state = { bodies: new Map() };
globalThis.__rowRenders = state;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
const mocks = {
  'react-native': `export const Platform={OS:'ios'}; export const useWindowDimensions=()=>({fontScale:1}); export const AccessibilityInfo={isReduceMotionEnabled:async()=>false,addEventListener:()=>({remove(){}})}; export const AppState={currentState:'active',addEventListener:()=>({remove(){}})}; export const Keyboard={addListener:()=>({remove(){}})}; export const Alert={alert(){}}; export const ActivityIndicator='ActivityIndicator',Pressable='Pressable',ScrollView='ScrollView',View='View'; export const StyleSheet={create:x=>x,hairlineWidth:1};`,
  './FontSize': `export const Text='Text',TextInput='TextInput'; export const useFontSize=()=>({scale:1});`,
  'react-native-keyboard-controller': `import React from 'react'; export const KeyboardChatScrollView=React.forwardRef((p,r)=>{React.useImperativeHandle(r,()=>({scrollToEnd(){},scrollTo(){}}));return React.createElement('ChatScroll',p,p.children);}); export const KeyboardGestureArea='KeyboardGestureArea',KeyboardStickyView='KeyboardStickyView'; export const useKeyboardHandler=()=>{};`,
  'react-native-reanimated': `const fade={duration:()=>fade,reduceMotion:()=>fade,easing:()=>fade}; export const FadeIn=fade,LinearTransition=fade,Easing={out:x=>x,cubic:'cubic'},withTiming=x=>x,ReduceMotion={System:'System'},runOnJS=x=>x,useSharedValue=x=>({value:x}); export default {View:'AnimatedView'};`,
  'react-native-safe-area-context': `export const useSafeAreaInsets=()=>({bottom:0});`,
  'expo-blur': `export const BlurTargetView='BlurTargetView',BlurView='BlurView';`,
  './MessageContent': `const s=globalThis.__rowRenders; export const MessageContent=p=>{s.bodies.set(p.resourceId,(s.bodies.get(p.resourceId)??0)+1);return React.createElement('MessageBody',p);}; import React from 'react'; export const copyMessageText=()=>{};`,
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

test('sender label is above the user bubble; display and copy share stripped text, legacy rows stay unchanged', async () => {
  const wire = { id: 'member', ref_seq: 1, role: 'user', sender: 'Wang.Sheng-1', text: '[Wang.Sheng-1] hello' };
  const rows = projectTimeline([wire, { id: 'legacy', ref_seq: 2, role: 'user', text: '[legacy] hello' }], null, 't');
  let root;
  await act(async () => { root = create(React.createElement(ChatTimeline, { ...defaults, rows, composerError: 'This device is not linked to a team member. You can read but not send.' })); });
  try {
    const label = root.root.findByProps({ testID: 'user-message-sender' });
    assert.equal(label.props.children, 'Wang.Sheng-1');
    const elements = label.parent.children;
    assert.equal(elements[0], label, 'label precedes the bubble, outside its gray background');
    assert.deepEqual(root.root.findAllByType('MessageBody').map(n => n.props.text), ['hello', '[legacy] hello']);
    assert.deepEqual(root.root.findAllByType('MessageCopyButton').map(n => n.props.text), ['hello', '[legacy] hello']);
    assert.equal(wire.text, '[Wang.Sheng-1] hello');
    const error = root.root.findAllByType('Text').find(n => n.props.children === 'This device is not linked to a team member. You can read but not send.');
    const dock = root.root.findByProps({ testID: 'composer-dock' });
    assert.ok(dock.findAll(n => n === error).length, 'membership error is inside the composer, not a page banner');
    await act(async () => root.update(React.createElement(ChatTimeline, { ...defaults, rows: [{ ...rows[0], sender: 'Other' }, rows[1]] })));
    assert.equal(root.root.findByProps({ testID: 'user-message-sender' }).props.children, 'Other', 'sender changes invalidate memoized rows');
    await act(async () => root.update(React.createElement(ChatTimeline, { ...defaults, rows: [{ ...rows[0], sender: undefined }] })));
    assert.equal(root.root.findAllByProps({ testID: 'user-message-sender' }).length, 0);
  } finally { await act(async () => root.unmount()); }
});

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
