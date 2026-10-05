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
  '@shopify/flash-list': `import React from 'react'; export const FlashList=React.forwardRef((p,r)=>{React.useImperativeHandle(r,()=>({getScrollResponder:()=>({scrollToEnd:o=>globalThis.__entryTest.commands.push(o)}),scrollToOffset:o=>globalThis.__entryTest.commands.push(o)}));return React.createElement('FlashList',p, p.data.map((item,index)=>React.createElement(React.Fragment,{key:item.key},p.renderItem({item,index,target:'Cell'}))), p.ListFooterComponent);});`,
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
const labels = root => root.root.findAllByType('Text').map(node => node.props.children).filter(value => typeof value === 'string');
test('Agent response Working is visible before output, merges once and disappears on final', async () => {
  const user = {key:'u',role:'user',text:'Request',optimistic:true,status:'sending',timestamp:1700000000};
  const root = await mount({rows:[user]});
  try {
    assert.equal(labels(root).filter(label=>label==='Working').length,1);
    const receipt = {id:'r',thread_id:'t',client_message_id:'u',state:'running',processing:'running',durable:true};
    const process = {key:'a',role:'assistant',text:'Public explanation',timestamp:1700000002};
    await act(async()=>root.update(React.createElement(ChatTimeline,{...defaults,rows:[{...user,status:'accepted',receipt},process],receipts:[receipt]})));
    assert.equal(labels(root).filter(label=>label==='Working').length,1);
    const final = {key:'f',role:'assistant',displayKind:'final',text:'Result',timestamp:1700000010};
    await act(async()=>root.update(React.createElement(ChatTimeline,{...defaults,rows:[user,process,final]})));
    assert.equal(labels(root).filter(label=>label==='Working').length,0);
    assert.ok(labels(root).some(label=>label.startsWith('Worked for ')));
  } finally { await act(async()=>root.unmount()); }
});
test('user metadata moves below content, dates group days, and normal reaction is absent', async () => {
  const timestamp = new Date(2026,9,5,22,11).getTime()/1000;
  const user = {key:'u',role:'user',text:'Request',timestamp,reactionSlot:true,reaction:{emoji:'✅',label:'Completed'},receipt:{state:'completed',processing:'completed'}};
  const root = await mount({rows:[user,{...user,key:'u2',timestamp:timestamp+60},{...user,key:'u3',timestamp:timestamp+86400}]});
  try {
    assert.ok(!labels(root).some(label=>label.includes('Completed')));
    const dates=root.root.findAllByProps({testID:'chat-date-separator'});
    assert.equal(dates.length,2);
    const times=root.root.findAllByType('MessageTime');
    assert.equal(times.length,3);assert.ok(times.every(node=>node.props.clockOnly===true));
    const metadata=root.root.findAllByProps({testID:'user-message-time'});
    assert.equal(metadata.length,3);
    for (const node of metadata) {
      const siblings=node.parent.children;
      assert.ok(siblings.findIndex(x=>typeof x==='object'&&x.type==='MessageContent')<siblings.indexOf(node));
      assert.equal(node.props.style.justifyContent,'flex-end');
    }
  } finally { await act(async()=>root.unmount()); }
});
test('failed send has no Working; abnormal processing remains a plain warning', async () => {
  for(const row of [
    {key:'u',role:'user',text:'Request',optimistic:true,status:'blocked',sendError:'Not sent.'},
    {key:'u',role:'user',text:'Request',reactionSlot:true,reaction:{emoji:'⚠️',label:'Outcome unknown'},receipt:{state:'unknown',processing:'unknown'}},
  ]) {
    const root=await mount({rows:[row]});
    try {assert.ok(!labels(root).includes('Working'));if(row.reaction)assert.ok(labels(root).includes('Outcome unknown'));}
    finally {await act(async()=>root.unmount());}
  }
});
test('receipt lifecycle, approvals and direct replies stop or retain the single response heading correctly', async () => {
  const user={key:'u',role:'user',text:'Request',status:'accepted'};
  for (const [state,processing,expected] of [['queued',null,1],['running','running',1],['running','completed',0],['running','failed',0],['unknown','unknown',0],['interrupted','interrupted',0],['received',null,0]]) {
    const receipt={id:'r',thread_id:'t',client_message_id:'u',durable:true,state,processing};
    const root=await mount({rows:[{...user,receipt}],receipts:[receipt]});
    try {assert.equal(labels(root).filter(x=>x==='Working').length,expected,`${state}/${processing}`);}
    finally {await act(async()=>root.unmount());}
  }
  const receipt={id:'r',thread_id:'t',client_message_id:'u',durable:true,state:'running',processing:'running'};
  const root=await mount({rows:[{...user,receipt}],receipts:[receipt],interactions:[{id:'i',thread_id:'t',receipt_id:'r',state:'pending',kind:'approval',prompt:'Approve?',choices:['Approve']}]});
  try {assert.ok(!labels(root).includes('Working'));}
  finally {await act(async()=>root.unmount());}
  const directRoot=await mount({rows:[{...user,receipt},{key:'d',role:'assistant',text:'Direct answer',displayKind:'direct'}],receipts:[receipt]});
  try {assert.ok(!labels(directRoot).includes('Working'));assert.ok(!labels(directRoot).some(x=>x.startsWith('Worked')));}
  finally {await act(async()=>directRoot.unmount());}
});
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
