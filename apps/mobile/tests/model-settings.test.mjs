import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a; reject=b;}); return {promise,resolve,reject}; };
const initial = {provider:'one',model:'m1',providers:[{id:'one',name:'Provider One',models:['m1','m2']},{id:'two',name:'Provider Two',models:['m3']}]};
function harness(client, onNavigationBlocked, onNavigationSaving) {
  const cells=[]; let cursor=0, effects=[];
  const slot = init => cells[cursor++] ??= {value: typeof init==='function'?init():init};
  const react = {
    Fragment:'Fragment', createElement:(type,props,...children)=>({type,props:{...props,children}}),
    useState(init){const c=slot(init);return [c.value,v=>{c.value=typeof v==='function'?v(c.value):v;}];},
    useRef(init){return slot(()=>({current:init})).value;},
    useEffect(fn,deps){const c=slot(null);if(!c.deps||deps.some((d,i)=>d!==c.deps[i]))effects.push(()=>{c.cleanup?.();c.cleanup=fn();c.deps=deps;});},
  };
  const native={Text:'Text',TextInput:'TextInput',View:'View',Pressable:'Pressable',StyleSheet:{create:x=>x}};
  const mods={react:{...react,default:react},'react-native':native,'./FontSize':native};
  const output={exports:{}};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/ModelSettings.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText,
    {module:output,exports:output.exports,require:k=>{assert.ok(k in mods,k);return mods[k];},AbortController});
  const walk=node=>Array.isArray(node)?node.flatMap(walk):node&&typeof node==='object'?[node,...walk(node.props?.children)]:[];
  const render=()=>{cursor=0;effects=[];const tree=output.exports.ModelSettings({client,onNavigationBlocked,onNavigationSaving});effects.forEach(f=>f());return walk(tree);};
  const button=label=>{const n=render().find(n=>n.type==='Pressable'&&n.props.accessibilityLabel===label);assert.ok(n,`missing ${label}`);return n;};
  return {render,button,field:()=>render().find(n=>n.type==='TextInput'),unmount:()=>cells.forEach(c=>c.cleanup?.())};
}
test('model draft and in-flight save block route exit until the authoritative result',async()=>{
  const gate=deferred(), blocks=[], saving=[];
  const h=harness({getModelSettings:async()=>initial,setModelSettings:()=>gate.promise}, value=>blocks.push(value), value=>saving.push(value));
  h.render();await tick();h.render();assert.equal(blocks.at(-1),false);
  h.field().props.onChangeText('m2');h.render();assert.equal(blocks.at(-1),true);assert.equal(saving.at(-1),false);
  h.button('Save model').props.onPress();h.render();assert.equal(blocks.at(-1),true);assert.equal(saving.at(-1),true);
  gate.resolve({...initial,model:'m2'});await tick();h.render();assert.equal(blocks.at(-1),false);assert.equal(saving.at(-1),false);
  h.unmount();assert.equal(blocks.at(-1),false);
});
test('loads authoritative model; provider selection and explicit save use returned server value',async()=>{
  const saves=[]; const client={getModelSettings:async()=>initial,setModelSettings:async(...args)=>{saves.push(args);return {...initial,provider:'two',model:'m3'};}};
  const h=harness(client);h.render();await tick();
  assert.equal(h.field().props.value,'m1');assert.equal(h.button('Save model').props.disabled,true);
  h.button('Provider One').props.onPress();h.button('Provider Two').props.onPress();
  assert.equal(h.field().props.value,'');assert.equal(h.button('Save model').props.disabled,true);
  h.button('Choose model').props.onPress();h.button('m3').props.onPress();h.button('Save model').props.onPress();await tick();
  assert.equal(saves.length,1);assert.equal(saves[0][0],'two');assert.equal(saves[0][1],'m3');
  assert.equal(h.field().props.value,'m3');assert.ok(h.render().some(n=>n.props.children.includes('Model settings saved.')));
});
test('load failure offers reload and never shows credentials or raw errors',async()=>{
  let fail=true;const h=harness({getModelSettings:async()=>{if(fail)throw Error('private-secret');return initial;}});
  h.render();await tick();assert.ok(h.render().some(n=>n.props.children.includes('Could not load model settings. Try again.')));
  assert.ok(!JSON.stringify(h.render()).includes('private-secret'));fail=false;h.button('Reload model settings').props.onPress();h.render();await tick();assert.equal(h.field().props.value,'m1');
});
test('pending save is single-flight; failure retains draft and asks for authoritative reload',async()=>{
  const d=deferred();let count=0;
  const h=harness({getModelSettings:async()=>initial,setModelSettings:()=>{count++;return d.promise;}});
  h.render();await tick();h.field().props.onChangeText('m2');const save=h.button('Save model');save.props.onPress();save.props.onPress();
  assert.equal(count,1);assert.equal(h.button('Saving model…').props.disabled,true);
  d.reject(Error('private error'));await tick();assert.equal(h.field().props.value,'m2');
  assert.ok(h.render().some(n=>n.props.children.includes('Could not confirm the change. Reload settings before trying again.')));
  assert.ok(!h.render().some(n=>n.props.children.includes('Model settings saved.')));
});
test('closing cancels the request and ignores late load/save results',async()=>{
  const d=deferred();let signal;
  const h=harness({getModelSettings:s=>{signal=s;return d.promise;}});h.render();h.unmount();assert.equal(signal.aborted,true);d.resolve(initial);await tick();assert.equal(h.field(),undefined);
  const s=deferred();let saveSignal;
  const second=harness({getModelSettings:async()=>initial,setModelSettings:(p,m,signal)=>{saveSignal=signal;return s.promise;}});
  second.render();await tick();second.field().props.onChangeText('m2');second.button('Save model').props.onPress();second.unmount();assert.equal(saveSignal.aborted,true);s.resolve({...initial,model:'m2'});await tick();
  assert.ok(!second.render().some(n=>n.props.children.includes('Model settings saved.')));
});

test('native selection warning requires explicit confirmation for the unchanged selection',async()=>{
  const calls=[];
  const h=harness({getModelSettings:async()=>initial,setModelSettings:async(p,m,s,confirm)=>{
    calls.push([p,m,confirm]);return confirm?{...initial,model:m}:{confirmation_required:true,provider:p,model:m,warning:'This model may store your prompts.'};
  }});
  h.render();await tick();h.field().props.onChangeText('m2');h.button('Save model').props.onPress();await tick();
  assert.ok(h.render().some(n=>n.props.children.includes('This model may store your prompts.')));
  assert.ok(!h.render().some(n=>n.props.children.includes('Model settings saved.')));
  h.button('Confirm model selection').props.onPress();await tick();assert.equal(calls[1][2],true);
  assert.ok(h.render().some(n=>n.props.children.includes('Model settings saved.')));
  h.field().props.onChangeText('m1');h.button('Save model').props.onPress();await tick();
  h.button('Confirm model selection');h.field().props.onChangeText('m2');
  assert.ok(!h.render().some(n=>n.props.accessibilityLabel==='Confirm model selection'));
  // A new Save always asks the server to evaluate policy again, not auto-confirm.
  h.field().props.onChangeText('another');h.button('Save model').props.onPress();await tick();assert.equal(calls.at(-1)[2],false);
});
