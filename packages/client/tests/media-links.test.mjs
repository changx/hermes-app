import test from 'node:test';
import assert from 'node:assert/strict';
import {HermesClient} from '../dist/index.js';
const id='att_'+'a'.repeat(32);
const attachment={id,thread_id:'thread',name:'screenshot.png',mime:'image/png',size:123,receipt_id:'receipt',state:'available'};
function client(url){
 return new HermesClient({token:()=> 'synthetic',socket:{async connect(){throw new Error('unused');}},http:{async request(){return {status:200,body:{messages:[{id:'dm_image',ref_seq:2,role:'assistant',text:'Screenshot',display_kind:'direct',attachments:[{...attachment,public_url:url}]}],next_cursor:null,older_cursor:null,incomplete_turns:[],turn_outcomes:[]}};}}});
}
test('outbound permanent URL survives cold history and same-identity refresh',async()=>{
 const url=`https://agent.tuly.space/media/${id}/screenshot.png`;
 const sdk=client(url);sdk.supportsLatest=true;
 await sdk.historyWindow('thread');await sdk.historyWindow('thread');
 assert.equal(sdk.messages.get('thread').length,1);
 assert.equal(sdk.messages.get('thread')[0].attachments[0].public_url,url);
 assert.equal(sdk.attachments.get(id).public_url,url);
 sdk.close();
});
test('unsafe optional URLs are dropped without losing the durable image',async()=>{
 for(const url of ['file:///etc/passwd','javascript:alert(1)',`https://user:secret@example.com/media/${id}/a.png`,`https://example.com/media/${id}/a.png?token=secret`,'https://example.com/media/foreign/a.png']){
  const sdk=client(url);sdk.supportsLatest=true;await sdk.historyWindow('thread');
  assert.equal(sdk.messages.get('thread')[0].attachments[0].public_url,undefined);
  assert.equal(sdk.attachments.get(id).state,'available');sdk.close();
 }
});
