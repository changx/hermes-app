import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient, ProtocolError } from '../dist/index.js';

const clientFor = message => new HermesClient({ token: () => 'synthetic',
  socket: { async connect() { throw new Error('unused'); } },
  http: { async request() { return { status: 200, body: { messages: [message], next_cursor: null,
    older_cursor: null, incomplete_turns: [], turn_outcomes: [] } }; } }
});

test('system notices retain their strict role and display identity', async () => {
  const sdk = clientFor({ id: 'notice_one', ref_seq: 4, role: 'system',
    text: '💾 Self-improvement review: Memory updated', created_at: 123, display_kind: 'system_notice' });
  sdk.supportsLatest = true;
  const page = await sdk.historyWindow('thread');
  assert.deepEqual(page.messages[0], { id: 'notice_one', ref_seq: 4, role: 'system',
    text: '💾 Self-improvement review: Memory updated', created_at: 123,
    display_kind: 'system_notice', attachments: [] });
  assert.equal(sdk.messages.get('thread')[0].display_kind, 'system_notice');
});

test('system notice role and display kind cannot be forged independently', async () => {
  for (const message of [
    { id: 'missing-kind', ref_seq: 1, role: 'system', text: 'notice' },
    { id: 'wrong-role', ref_seq: 1, role: 'assistant', text: 'notice', display_kind: 'system_notice' },
  ]) {
    const sdk = clientFor(message); sdk.supportsLatest = true;
    await assert.rejects(sdk.historyWindow('thread'), ProtocolError);
    assert.equal(sdk.messages.has('thread'), false);
  }
});

test('a delayed history page cannot overwrite a newer notice edit', async () => {
  const started = { id:'notice_one', ref_seq:4, role:'system', text:'Compressing…',
    created_at:123, display_kind:'system_notice' };
  const completed = { ...started, text:'Compression complete.' };
  let releaseOld;
  const oldResponse = new Promise(resolve => { releaseOld = resolve });
  const sdk = new HermesClient({ token:()=>'synthetic',
    socket:{ async connect(){ throw new Error('unused') } },
    http:{ async request(method,path) {
      if (path.includes('latest=true')) return oldResponse;
      if (path.startsWith('/v1/sync')) return {status:200,body:{events:[{
        event_id:2,cursor:'c2',kind:'message',thread_id:'thread',ref:'4',version:2
      }],waterline:'c2',next_cursor:'c2',has_more:false}};
      if (path.includes('after_ref_seq=4')) return {status:200,body:{messages:[],next_cursor:null,
        incomplete_turns:[],turn_outcomes:[]}};
      if (/[?&]ref_seq=4(?:&|$)/.test(path)) return {status:200,body:{messages:[completed],next_cursor:null,
        incomplete_turns:[],turn_outcomes:[]}};
      if (path.startsWith('/v1/snapshot')) return {status:200,body:{threads:[],next_after:null}};
      throw new Error('unexpected request: '+method+' '+path);
    }}
  });
  sdk.supportsLatest = true; sdk.cursor='c1'; sdk.lastEventId=1;
  sdk.messages.set('thread',[started]);
  const stale = sdk.historyWindow('thread');
  await new Promise(resolve => setImmediate(resolve));
  await sdk.catchUp();
  assert.equal(sdk.messages.get('thread')[0].text,'Compression complete.');
  releaseOld({status:200,body:{messages:[started],older_cursor:null}});
  await stale;
  assert.equal(sdk.messages.get('thread')[0].text,'Compression complete.');
});
