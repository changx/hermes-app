import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const state = { os: 'ios', scale: 1.1, fontScale: 1, commands: [], frames: new Map(), next: 0 };
globalThis.__entryTest = state;
globalThis.requestAnimationFrame = fn => { const id = ++state.next; state.frames.set(id, fn); return id; };
globalThis.cancelAnimationFrame = id => state.frames.delete(id);
const flush = () => { const jobs = [...state.frames.values()]; state.frames.clear(); jobs.forEach(fn => fn()); };
const mocks = {
  'react-native': `const s=globalThis.__entryTest; export const Platform={get OS(){return s.os}}; export const useWindowDimensions=()=>({fontScale:s.fontScale}); export const AccessibilityInfo={isReduceMotionEnabled:async()=>false,addEventListener:()=>({remove(){}})}; export const AppState={currentState:'active',addEventListener:()=>({remove(){}})}; export const Alert={alert(){}}; export const ActivityIndicator='ActivityIndicator',Pressable='Pressable',RefreshControl='RefreshControl',ScrollView='ScrollView',View='View'; export const StyleSheet={create:x=>x,hairlineWidth:1};`,
  './FontSize': `export const Text='Text',TextInput='TextInput'; export const useFontSize=()=>({scale:globalThis.__entryTest.scale});`,
  '@shopify/flash-list': `import React from 'react'; export const FlashList=React.forwardRef((p,r)=>{React.useImperativeHandle(r,()=>({getScrollResponder:()=>({scrollToEnd:o=>globalThis.__entryTest.commands.push(o)}),scrollToOffset:o=>globalThis.__entryTest.commands.push(o)}));return React.createElement('FlashList',p);});`,
  'react-native-keyboard-controller': `export const KeyboardChatScrollView='KeyboardChatScrollView',KeyboardGestureArea='KeyboardGestureArea',KeyboardStickyView='KeyboardStickyView'; export const useKeyboardHandler=()=>{};`,
  'react-native-reanimated': `const fade={duration:()=>fade,reduceMotion:()=>fade}; export const FadeIn=fade,ReduceMotion={System:'System'},runOnJS=x=>x,useSharedValue=x=>({value:x}); export default {View:'AnimatedView'};`,
  'react-native-safe-area-context': `export const useSafeAreaInsets=()=>({bottom:0});`,
  'expo-blur': `export const BlurTargetView='BlurTargetView',BlurView='BlurView';`,
  './MessageContent': `export const MessageContent='MessageContent',copyMessageText=()=>{};`,
  './WorkChevron': `export const WorkChevron='WorkChevron';`,
  './MessageTime': `export const MessageTime='MessageTime';`,
};
const bundle = await build({ entryPoints: [new URL('../src/ChatTimeline.tsx', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'], plugins: [{ name: 'native-test-boundary', setup(b) {
  b.onResolve({filter: /.*/}, args => mocks[args.path] ? {path:args.path,namespace:'mock'} : undefined);
  b.onLoad({filter: /.*/,namespace:'mock'}, args => ({contents:mocks[args.path],loader:'js'}));
}}] });
const mod = {exports:{}}; new Function('module','exports','require',bundle.outputFiles[0].text)(mod,mod.exports,require);
const ChatTimeline = mod.exports.ChatTimeline;
const defaults = { active:true,threadId:'t',rows:[],startRef:null,hasOlder:false,onOlder(){},onPosition(){},text:'',onText(){},onSend(){},receipts:[],interactions:[],answers:{},onAnswerText(){},onAnswer(){},onCancel(){},onStop(){},busy:false };
const rows = [{key:'u1',role:'user',text:'Synthetic history',refSeq:1}];
async function mount(extra={}) { state.commands=[];state.frames.clear();let root;await act(async()=>{root=create(React.createElement(ChatTimeline,{...defaults,...extra}));});return root; }
const list = root => root.root.findByType('FlashList');
test('empty loading page receives first user-only history and follows without a content-size event',async()=>{
  const root=await mount({position:{offset:0,following:true,startRef:null}});
  assert.equal(list(root).props.maintainVisibleContentPosition.startRenderingFromBottom,true);
  await act(async()=>root.update(React.createElement(ChatTimeline,{...defaults,rows,position:{offset:0,following:true,startRef:null}})));
  flush();assert.deepEqual(state.commands,[{animated:false}]);
  await act(async()=>root.unmount());
});
test('onLoad follows final native extent; user reading and covered-page return do not reset',async()=>{
  const root=await mount({rows});
  flush();state.commands=[];
  list(root).props.onLoad();flush();assert.deepEqual(state.commands,[{animated:false}]);
  const geometry=y=>({nativeEvent:{contentOffset:{y},contentSize:{height:2000},layoutMeasurement:{height:500}}});
  await act(async()=>{list(root).props.onScroll(geometry(1500));list(root).props.onScrollBeginDrag();list(root).props.onScroll(geometry(900));
    list(root).props.onScrollEndDrag(geometry(900));});state.commands=[];
  await act(async()=>root.update(React.createElement(ChatTimeline,{...defaults,rows,active:false})));
  await act(async()=>root.update(React.createElement(ChatTimeline,{...defaults,rows,active:true})));
  list(root).props.onLoad();flush();assert.deepEqual(state.commands,[]);
  await act(async()=>root.unmount());
});
test('attachment entry and restored reading positions never initialize at bottom',async()=>{
  for(const extra of [{targetRef:1,rows,position:{offset:0,following:false,startRef:1}},{rows,position:{offset:250,following:false,startRef:1}}]){
    const root=await mount(extra);assert.equal(list(root).props.maintainVisibleContentPosition.startRenderingFromBottom,false);
    if(extra.targetRef)assert.equal(list(root).props.initialScrollIndex,0);
    list(root).props.onLoad();flush();assert.deepEqual(state.commands,[]);await act(async()=>root.unmount());
  }
});
test('six visible lines scale with app and system fonts; overflow keeps complete editable text',async()=>{
  const text=Array.from({length:9},(_,i)=>`Line ${i}`).join('\n');
  for(const os of ['ios','android'])for(const scale of [1,1.1,1.15,1.3])for(const fontScale of [1,1.5]){
    Object.assign(state,{os,scale,fontScale});let changed;
    const root=await mount({text,onText:value=>{changed=value;}});
    const input=root.root.findByProps({accessibilityLabel:'Message text'});
    const style=Object.assign({},...input.props.style);
    assert.equal(style.maxHeight,style.lineHeight*scale*fontScale*6);
    assert.equal(input.props.scrollEnabled,true);assert.equal(input.props.value,text);
    input.props.onChangeText(text+'\nMore');assert.equal(changed,text+'\nMore');
    assert.equal(root.root.findAllByType('Pressable').find(x=>x.props.onPress&&!x.props.accessibilityLabel)?.props.style.maxHeight,undefined);
    await act(async()=>root.unmount());
  }
  Object.assign(state,{os:'ios',scale:1.1,fontScale:1});
});
test('empty iOS composer retains single-line reset; Android does not get fixed native lines',async()=>{
  for(const os of ['ios','android']){state.os=os;const root=await mount();assert.equal(root.root.findByProps({accessibilityLabel:'Message text'}).props.numberOfLines,os==='ios'?1:undefined);await act(async()=>root.unmount());}
});
