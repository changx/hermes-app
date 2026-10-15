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
  'react-native-keyboard-controller': `import React from 'react'; export const KeyboardChatScrollView=React.forwardRef((p,r)=>{React.useImperativeHandle(r,()=>({scrollToEnd:o=>globalThis.__entryTest.commands.push(o),scrollTo:o=>globalThis.__entryTest.commands.push({to:o.y,animated:o.animated})}));return React.createElement('ChatScroll',p,p.children);}); export const KeyboardGestureArea='KeyboardGestureArea',KeyboardStickyView='KeyboardStickyView'; export const useKeyboardHandler=handlers=>{globalThis.__entryTest.keyboard=handlers;};`,
  'react-native-reanimated': `const fade={duration:()=>fade,reduceMotion:()=>fade,easing:()=>fade}; export const FadeIn=fade,LinearTransition=fade,Easing={out:x=>x,cubic:'cubic'},withTiming=x=>x,ReduceMotion={System:'System'},runOnJS=x=>x,useSharedValue=x=>({value:x}); export default {View:'AnimatedView'};`,
  'react-native-safe-area-context': `export const useSafeAreaInsets=()=>({bottom:0});`,
  'expo-blur': `export const BlurTargetView='BlurTargetView',BlurView='BlurView';`,
  './MessageContent': `export const MessageContent='MessageContent',copyMessageText=()=>{};`,
  './WorkChevron': `export const WorkChevron='WorkChevron';`,
  './MessageTime': `export const MessageTime='MessageTime';`,
  './MessageToolbar': `export const MessageToolbar='MessageToolbar',MessageCopyButton='MessageCopyButton';`,
  './sessionNavigation': `const s=globalThis.__entryTest; export const useSessionNavigation=()=>({link:h=>{(s.links||(s.links=[])).push(h)},thread(){}});`,
};
const bundle = await build({ entryPoints: [new URL('../src/ChatTimeline.tsx', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'], plugins: [{ name: 'native-test-boundary', setup(b) {
  b.onResolve({filter: /.*/}, args => mocks[args.path] ? {path:args.path,namespace:'mock'} : undefined);
  b.onLoad({filter: /.*/,namespace:'mock'}, args => ({contents:mocks[args.path],loader:'js'}));
}}] });
const mod = {exports:{}}; new Function('module','exports','require',bundle.outputFiles[0].text)(mod,mod.exports,require);
const ChatTimeline = mod.exports.ChatTimeline;
const defaults = { active:true,threadId:'t',rows:[],text:'',onText(){},onSend(){},receipts:[],interactions:[],answers:{},onAnswerText(){},onAnswer(){},onCancel(){},onStop(){},busy:false };
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
    const copies=root.root.findAllByType('MessageCopyButton');
    assert.equal(copies.length,3);assert.ok(copies.every(node=>node.props.text==='Request'));
    for (const node of metadata) {
      const siblings=node.parent.children;
      assert.ok(siblings.findIndex(x=>typeof x==='object'&&x.type==='MessageContent')<siblings.indexOf(node));
      assert.equal(node.props.style.justifyContent,'flex-end');
      // Order: reserved Cancel space (invisible placeholder when not queued), copy, time.
      assert.equal(node.children[0].props.testID,'user-message-cancel-slot');
      assert.equal(node.children[0].props.importantForAccessibility,'no-hide-descendants');
      assert.equal(node.children[1].type,'MessageCopyButton');
      assert.equal(node.children[2].type,'MessageTime');
    }
  } finally { await act(async()=>root.unmount()); }
});
test('user message copy button copies the original text and yields to the failed-message actions', async () => {
  const raw = '  **原文** `code`\n- item  ';
  const root = await mount({rows:[{key:'u',role:'user',text:raw,timestamp:1700000000},{key:'local:f',role:'user',text:'Failed',timestamp:1700000001,optimistic:true,status:'blocked'},{key:'a',role:'assistant',displayKind:'final',text:'Reply',timestamp:1700000002}]});
  try {
    const copies=root.root.findAllByType('MessageCopyButton');
    assert.deepEqual(copies.map(node=>node.props.text),[raw]);
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
const list = root => root.root.findByType('ChatScroll');
const geometry = (y, height=2000, viewport=500) => ({nativeEvent:{contentOffset:{y},contentSize:{height},layoutMeasurement:{height:viewport}}});
const measure = async root => { await act(async()=>{list(root).props.onLayout({nativeEvent:{layout:{height:500}}});list(root).props.onContentSizeChange(300,2000);list(root).props.onScroll(geometry(1500));});flush();state.commands=[]; };
const readOlder = async root => { await act(async()=>{list(root).props.onScrollBeginDrag();list(root).props.onScroll(geometry(900));list(root).props.onScrollEndDrag(geometry(900));});flush();state.commands=[]; };
test('plain scroll view renders every row with no pull-to-load control',async()=>{
  const many=Array.from({length:300},(_,i)=>({key:'m'+i,role:i%2?'assistant':'user',text:'Row '+i,refSeq:i+1}));
  const root=await mount({rows:many});
  try {
    assert.equal(root.root.findAllByType('MessageContent').length,300);
    assert.equal(list(root).props.refreshControl,undefined);
    assert.ok(!labels(root).some(x=>/earlier messages|Release to load|Loading history/.test(x)));
  } finally { await act(async()=>root.unmount()); }
});
test('empty loading page receives first history and follows without a content-size event',async()=>{
  const root=await mount({position:{following:true}});
  await act(async()=>root.update(React.createElement(ChatTimeline,{...defaults,rows,position:{following:true}})));
  flush();assert.deepEqual(state.commands,[{animated:false}]);
  await act(async()=>root.unmount());
});
test('source target scrolls to its measured row and never to the bottom',async()=>{
  const many=[{key:'a',role:'user',text:'A',refSeq:1},{key:'b',role:'assistant',text:'B',refSeq:2},{key:'c',role:'user',text:'C',refSeq:3}];
  const root=await mount({rows:many,targetRef:2,position:{following:false}});
  const cells=list(root).findAll(n=>n.type==='View'&&typeof n.props.onLayout==='function'&&n.parent===list(root));
  await act(async()=>{list(root).props.onLayout({nativeEvent:{layout:{height:500}}});cells.forEach((c,i)=>c.props.onLayout({nativeEvent:{layout:{y:i*400,height:400}}}));});
  flush();assert.deepEqual(state.commands,[{to:388,animated:false}]);
  await act(async()=>root.unmount());
});
test('visible refs come from measured row frames and scroll offset',async()=>{
  const seen=[];const many=Array.from({length:6},(_,i)=>({key:'m'+i,role:'user',text:'Row '+i,refSeq:i+1}));
  const root=await mount({rows:many,onVisibleRefs:refs=>seen.push(refs)});
  const cells=list(root).findAll(n=>n.type==='View'&&typeof n.props.onLayout==='function'&&n.parent===list(root));
  await act(async()=>{list(root).props.onLayout({nativeEvent:{layout:{height:500}}});cells.forEach((c,i)=>c.props.onLayout({nativeEvent:{layout:{y:i*300,height:300}}}));});
  assert.deepEqual(seen.at(-1),[1,2]);
  await act(async()=>list(root).props.onScroll(geometry(700,1800)));
  assert.deepEqual(seen.at(-1),[3,4]);
  await act(async()=>root.unmount());
});
test('delayed rich-content growth still follows when onScroll reports the new height first',async()=>{
  const root=await mount({rows});await measure(root);
  list(root).props.onScroll(geometry(1500,2300));
  list(root).props.onContentSizeChange(300,2300);flush();
  assert.deepEqual(state.commands,[{animated:false}]);state.commands=[];
  list(root).props.onScroll(geometry(1800,2600));flush();
  assert.deepEqual(state.commands,[{animated:false}],'geometry event alone also reconciles');
  await act(async()=>root.unmount());
});
test('viewport and controller inset changes follow; keyboard motion defers the correction',async()=>{
  const root=await mount({rows});await measure(root);
  await act(async()=>list(root).props.onLayout({nativeEvent:{layout:{height:400}}}));flush();
  assert.deepEqual(state.commands,[{animated:false}]);state.commands=[];
  state.keyboard.onStart();list(root).props.onContentInsetChange({bottom:300});flush();
  assert.deepEqual(state.commands,[]);
  state.keyboard.onEnd();flush();assert.deepEqual(state.commands,[{animated:false}]);
  await act(async()=>root.unmount());
});
test('send while reading resumes follow after optimistic row commit, even with unchanged extent',async()=>{
  const ref=React.createRef();const root=await mount({rows,ref});await measure(root);await readOlder(root);
  await act(async()=>ref.current.followLatest());assert.deepEqual(state.commands,[{animated:true}]);flush();state.commands=[];
  await act(async()=>root.update(React.createElement(ChatTimeline,{...defaults,ref,rows:[...rows,{key:'u2',role:'user',text:'New local input'}]})));
  flush();assert.deepEqual(state.commands,[{animated:false}]);
  await act(async()=>root.unmount());
});
test('scrolling down near the end does not snap; reaching the end rejoins follow',async()=>{
  const root=await mount({rows});await measure(root);await readOlder(root);
  const latestShown=()=>root.root.findAllByProps({accessibilityLabel:'Jump to latest ↓'}).length>0;
  // Slow drag down to 40pt above the end, released without momentum.
  await act(async()=>{list(root).props.onScrollBeginDrag();list(root).props.onScroll(geometry(1460));list(root).props.onScrollEndDrag({nativeEvent:{contentOffset:{y:1460},velocity:{y:0}}});});
  assert.equal(latestShown(),true);
  list(root).props.onContentSizeChange(300,2000);list(root).props.onLayout({nativeEvent:{layout:{height:500}}});flush();
  assert.deepEqual(state.commands,[],'near-end reading position is kept');
  await act(async()=>{list(root).props.onScrollBeginDrag();list(root).props.onScroll(geometry(1500));list(root).props.onScrollEndDrag({nativeEvent:{contentOffset:{y:1500},velocity:{y:0}}});});
  assert.equal(latestShown(),false);
  list(root).props.onContentSizeChange(300,2100);flush();
  assert.deepEqual(state.commands,[{animated:false}],'follow resumes at the real end');
  await act(async()=>root.unmount());
});
test('reading, new drag and inactive routes suppress pending content and geometry corrections',async()=>{
  const root=await mount({rows});await measure(root);
  list(root).props.onContentSizeChange(300,2300);list(root).props.onScrollBeginDrag();flush();assert.deepEqual(state.commands,[]);
  await act(async()=>list(root).props.onScrollEndDrag(geometry(1500,2300)));
  await readOlder(root);list(root).props.onContentSizeChange(300,2500);flush();assert.deepEqual(state.commands,[]);
  await act(async()=>root.update(React.createElement(ChatTimeline,{...defaults,rows,active:false})));
  list(root).props.onContentSizeChange(300,3000);list(root).props.onLayout({nativeEvent:{layout:{height:400}}});flush();assert.deepEqual(state.commands,[]);
  await act(async()=>root.unmount());
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

test('ChatGPT-style composer: collapsed pill, focus expands in place, round send reflects draft',async()=>{
  state.os='ios';
  const flat=x=>Object.assign({},...[x].flat(Infinity).filter(Boolean));
  const root=await mount();
  const card=()=>flat(root.root.findByProps({testID:'composer-card'}).props.style);
  const send=()=>root.root.findByProps({accessibilityLabel:'Send'});
  const input=root.root.findByProps({accessibilityLabel:'Message text'});
  assert.equal(card().borderRadius,24);assert.equal(card().marginHorizontal,12);
  // Focus changes animate the card frame, the text and the tool row.
  const cardNode=root.root.findByProps({testID:'composer-card'});
  assert.equal(typeof cardNode.props.layout,'function');
  // The card grows upward: it starts at the old height on the new bottom edge.
  const grow=cardNode.props.layout({currentOriginX:12,currentOriginY:30,currentWidth:400,currentHeight:48,targetOriginX:12,targetOriginY:30,targetWidth:400,targetHeight:88});
  assert.deepEqual(grow.initialValues,{originX:12,originY:70,width:400,height:48});
  assert.deepEqual(grow.animations,{originX:12,originY:30,width:400,height:88});
  assert.ok(root.root.findByProps({testID:'composer-text'}).props.layout);
  assert.ok(root.root.findByProps({testID:'composer-tools'}).props.layout);
  assert.equal(send().props.disabled,true);assert.equal(flat(send().props.style).backgroundColor,'#d7d7d9');
  await act(async()=>input.props.onFocus());
  // Same width focused and not focused.
  assert.equal(card().marginHorizontal,12);
  // Same native input node: focus change never remounts the TextInput.
  assert.equal(root.root.findByProps({accessibilityLabel:'Message text'}),input);
  await act(async()=>root.update(React.createElement(ChatTimeline,{...defaults,text:'hi'})));
  assert.equal(send().props.disabled,false);assert.equal(flat(send().props.style).backgroundColor,'#1f2329');
  await act(async()=>root.root.findByProps({accessibilityLabel:'Message text'}).props.onBlur());
  assert.equal(card().marginHorizontal,12);
  await act(async()=>root.unmount());
});

test('final replies carry the message toolbar; Retry only on the latest reply with no later input',async()=>{
  const actions={branch:async()=>{},exportMessage(){},retry(){}};
  const turn=(n,final=true)=>[{key:`u${n}`,role:'user',text:`Q${n}`,refSeq:n*10},{key:`f${n}`,role:'assistant',displayKind:final?'final':undefined,text:`A${n}`,refSeq:n*10+1}];
  const root=await mount({rows:[...turn(1),...turn(2)],messageActions:actions});
  try{
    const bars=root.root.findAllByType('MessageToolbar');
    assert.deepEqual(bars.map(b=>[b.props.row.key,b.props.canRetry,b.props.actions===actions]),[['f1',false,true],['f2',true,true]]);
    // A later input (queued follow-up) moves Retry away from the old reply.
    await act(async()=>root.update(React.createElement(ChatTimeline,{...defaults,rows:[...turn(1),...turn(2),{key:'u3',role:'user',text:'next',refSeq:30}],messageActions:actions})));
    assert.deepEqual(root.root.findAllByType('MessageToolbar').map(b=>b.props.canRetry),[false,false]);
    // Interim (non-final) assistant rows get no toolbar; no actions, no toolbar.
    await act(async()=>root.update(React.createElement(ChatTimeline,{...defaults,rows:[...turn(1,false)],messageActions:actions})));
    assert.equal(root.root.findAllByType('MessageToolbar').length,0);
    await act(async()=>root.update(React.createElement(ChatTimeline,{...defaults,rows:[...turn(1)]})));
    assert.equal(root.root.findAllByType('MessageToolbar').length,0);
  }finally{await act(async()=>root.unmount());}
});

test('branch notices render their session link as a tappable span',async()=>{
  state.links=[];
  const notice={key:'n',role:'system',displayKind:'system_notice',text:'Branched to [Plan (branch)](hermesapp://session/th_abc123) now',refSeq:5};
  const root=await mount({rows:[notice]});
  try{
    const link=root.root.findAll(n=>n.type==='Text'&&n.props.accessibilityRole==='link');
    assert.equal(link.length,1);assert.equal(link[0].props.children,'Plan (branch)');
    link[0].props.onPress();
    assert.deepEqual(state.links,['hermesapp://session/th_abc123']);
    const box=root.root.find(n=>typeof n.props.accessibilityLabel==='string'&&n.props.accessibilityLabel.startsWith('System notice'));
    assert.equal(box.props.accessibilityLabel,'System notice: Branched to Plan (branch) now');
  }finally{await act(async()=>root.unmount());}
});
test('Stop is an icon + label pill right after the running indicator, not pinned to the right', async () => {
  const receipt = {id:'r',thread_id:'t',client_message_id:'u',state:'running',processing:'running',durable:true};
  let stops = 0;
  const root = await mount({rows, receipts:[receipt], onStop(){ stops++; }, typingIndicator: React.createElement('Indicator')});
  try {
    const stop = root.root.findAll(n => n.type === 'Pressable' && n.props.accessibilityLabel === 'Stop')[0];
    assert.ok(stop, 'stop button');
    const row = stop.parent;
    const order = row.children.map(child => child.type === 'Pressable' ? 'stop' : child.findAllByType('Indicator').length ? 'indicator' : '?');
    assert.deepEqual(order, ['indicator', 'stop'], 'stop follows the indicator');
    const style = Object.assign({}, ...[row.props.style].flat());
    assert.equal(style.justifyContent, undefined); assert.equal(style.gap, 10);
    const indicator = Object.assign({}, ...[row.children[0].props.style].flat());
    assert.equal(indicator.flex, undefined, 'indicator no longer fills the row');
    assert.deepEqual(stop.findAllByType('Text').map(t => t.props.children), ['Stop']);
    assert.ok(stop.props.hitSlop >= 8);
    const pill = Object.assign({}, ...stop.props.style({ pressed: false }).filter(Boolean));
    assert.equal(pill.borderRadius, pill.height / 2); assert.equal(pill.backgroundColor, undefined);
    await act(async () => stop.props.onPress());
    assert.equal(stops, 1);
  } finally { await act(async () => root.unmount()); }
});
