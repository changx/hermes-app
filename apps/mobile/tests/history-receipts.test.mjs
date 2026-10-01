import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { HermesClient, ProtocolError } from '../../../packages/client/dist/index.js';
import { projectTimeline } from '../src/timeline.ts';

const module = { exports: {} };
runInNewContext(ts.transpileModule(readFileSync(new URL('../src/receiptHydration.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { module, exports: module.exports, require: () => ({ ProtocolError }), AbortController, Map, JSON });
const { VisibleReceiptHydrator } = module.exports;

for (const [processing, label] of [['running','Working'], ['completed','Completed'], ['failed','Failed'], ['unknown','Outcome unknown'], ['interrupted',undefined], [null,undefined]]) {
  test(`cold history ${processing} reaction is ready on first publish with no separate receipt fetch`, async () => {
    const receipt = {id:'r',client_message_id:'c',thread_id:'th',ref_seq:1,state:processing === 'running' ? 'running' : 'completed',durable:true,processing,version:4};
    const message = {id:'receipt:r',role:'user',text:'same',ref_seq:1,receipt_id:'r',client_message_id:'c'};
    for (let launch = 0; launch < 2; launch++) {
      const requests = [], seen = [], hydrator = new VisibleReceiptHydrator();
      const sdk = new HermesClient({token:()=>'test',socket:{connect(){}},http:{async request(_method,path) {
        requests.push(path);
        assert.ok(path.includes('/messages'));
        return {status:200,body:{messages:[message],receipts:[receipt],next_cursor:null,older_cursor:null,incomplete_turns:[],turn_outcomes:[]}};
      }},onChange() {
        const messages = sdk.messages.get('th') ?? [];
        if (!messages.length) return;
        hydrator.update(sdk,'th',messages,0);
        seen.push(projectTimeline(messages,null,'th',undefined,true,[],sdk.receipts));
      }});
      await sdk.history('th');
      assert.equal(requests.length,1);
      assert.equal(seen.length,1);
      assert.equal(seen[0].length,1);
      assert.equal(seen[0][0].reaction?.label,label);
      assert.equal(seen[0][0].key,'local:c');
      hydrator.cancel();
    }
  });
}
