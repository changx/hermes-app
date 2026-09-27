"""Small durable ingress and cursor invariants; real gateway tests are separate."""
import concurrent.futures
import asyncio
import sqlite3
from types import SimpleNamespace

import pytest

from hermes_app.storage import Store
from hermes_app.adapter import HermesAppAdapter


def _store(tmp_path):
    store=Store(tmp_path/'metadata.sqlite')
    thread=store.create_thread('project','one','session','')
    return store,thread


def test_atomic_accept_retry_conflict_and_fifo(tmp_path):
    store,thread=_store(tmp_path)
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results=list(pool.map(lambda _:store.accept(thread,'device-1','same body'),range(16)))
    assert len({r[0]['id'] for r in results})==1
    assert sum(created for _,created in results)==1
    first=results[0][0]
    assert first['state']=='queued' and first['durable']
    with pytest.raises(ValueError,match='conflict'):
        store.accept(thread,'device-1','different body')
    second,_=store.accept(thread,'device-2','same body')
    assert second['id']!=first['id']
    claim=store.claim_next(thread)
    assert claim==(first['id'],'same body')
    assert store.claim_next(thread) is None
    store.finish_receipt(first['id'],'unknown')
    assert store.claim_next(thread)==(second['id'],'same body')
    with sqlite3.connect(store.path) as db:
        assert db.execute('SELECT COUNT(*) FROM receipts').fetchone()[0]==2
        assert db.execute('SELECT COUNT(*) FROM sync_events WHERE kind="receipt"').fetchone()[0]>=4


def test_busy_followups_claim_fifo_no_media_and_cold_unknown(tmp_path):
    store,thread=_store(tmp_path)
    primary,_=store.accept(thread,'first','held')
    assert store.claim_next(thread)==(primary['id'],'held')
    a,_=store.accept(thread,'a','alpha')
    b,_=store.accept(thread,'b','beta')
    assert store.claim_busy_text(thread)==(a['id'],'alpha')
    assert store.claim_busy_text(thread)==(b['id'],'beta')
    assert store.claim_busy_text(thread) is None
    assert store.receipt(a['id'])['admission']=='followup'
    assert len(store.snapshot()['threads'][0]['active_receipts'])==3
    same,created=store.accept(thread,'a','alpha')
    assert not created and same['id']==a['id'] and same['admission']=='followup'
    store.attachment_add(thread,'att_'+'a'*32,'file.txt','text/plain',2)
    media,_=store.accept(thread,'media','media',['att_'+'a'*32])
    later,_=store.accept(thread,'later','later')
    assert store.claim_busy_text(thread) is None  # no bypass of older media
    assert store.recover_receipts()==[thread]
    assert store.receipt(a['id'])['state']=='unknown'
    assert store.receipt(a['id'])['admission']=='followup'
    assert store.receipt(b['id'])['state']=='unknown'
    assert store.claim_next(thread)==(media['id'],'media')
    assert store.receipt(later['id'])['state']=='queued'


def test_normal_fallback_exact_core_anchor_clears_followup_marker(tmp_path):
    store,thread=_store(tmp_path)
    first,_=store.accept(thread,'first','held')
    store.claim_next(thread)
    receipt,_=store.accept(thread,'boundary','normal')
    store.claim_busy_text(thread)
    store.mark_ingress_unknown(thread,'ingress:'+first['id'])
    store.finish_receipt(first['id'],'unknown')
    core=tmp_path/'state.db'
    with sqlite3.connect(core) as db:
        db.execute('CREATE TABLE messages (id INTEGER PRIMARY KEY,session_id TEXT,role TEXT,'
                   'platform_message_id TEXT,finish_reason TEXT,tool_calls TEXT,content TEXT,display_kind TEXT)')
        db.execute('INSERT INTO messages VALUES (1,?,?,?,?,?,?,?)',
                   ('session','user',receipt['id'],None,None,'normal',None))
    assert store.followup_core_outcome(receipt['id'],core)=='anchored'
    store.begin_turn(thread,'normal-turn')
    store.append_hook_refs(thread,'normal-turn',[('session',1,'user')])
    assert store.followup_core_outcome(receipt['id'],core)=='anchored'
    assert 'admission' not in store.receipt(receipt['id'])
    with sqlite3.connect(core) as db:
        db.execute('INSERT INTO messages VALUES (2,?,?,?,?,?,?,?)',
                   ('session','assistant',None,'stop',None,'response',None))
    store.append_hook_refs(thread,'normal-turn',[('session',2,'assistant')],complete=True)
    assert store.followup_core_outcome(receipt['id'],core)=='completed'


@pytest.mark.parametrize('state',['failed','interrupted','unknown'])
def test_normal_fallback_failure_is_not_received(tmp_path,state):
    store,thread=_store(tmp_path)
    first,_=store.accept(thread,'first','held')
    store.claim_next(thread)
    item,_=store.accept(thread,'boundary','normal')
    store.claim_busy_text(thread)
    store.mark_ingress_unknown(thread,'ingress:'+first['id'])
    store.finish_receipt(first['id'],'unknown')
    core=tmp_path/'state.db'
    with sqlite3.connect(core) as db:
        db.execute('CREATE TABLE messages (id INTEGER PRIMARY KEY,session_id TEXT,role TEXT,'
                   'platform_message_id TEXT,finish_reason TEXT,tool_calls TEXT,content TEXT,display_kind TEXT)')
        db.execute('INSERT INTO messages VALUES (1,?,?,?,?,?,?,?)',
                   ('session','user',item['id'],None,None,'normal',None))
    assert store.followup_core_outcome(item['id'],core)=='anchored'
    store.begin_turn(thread,'normal-turn')
    store.append_hook_refs(thread,'normal-turn',[('session',1,'user')])
    store.finish_turn(thread,'normal-turn',state)
    assert store.followup_core_outcome(item['id'],core)==state
    assert 'admission' not in store.receipt(item['id'])
    store.finish_receipt(item['id'],state)
    assert store.receipt(item['id'])['state']==state


def test_received_followup_is_terminal_not_restart_unknown(tmp_path):
    store,thread=_store(tmp_path)
    first,_=store.accept(thread,'first','held')
    store.claim_next(thread)
    item,_=store.accept(thread,'second','followup')
    store.claim_busy_text(thread)
    store.finish_receipt(item['id'],'received')
    with store._connect() as db:
        assert db.execute('SELECT pending_text FROM receipts WHERE id=?',(item['id'],)).fetchone()[0]=='followup'
    store.recover_receipts()
    assert store.receipt(item['id'])['state']=='received'
    assert store.receipt(item['id'])['admission']=='followup'
    retry,created=store.accept(thread,'second','followup')
    assert not created and retry==store.receipt(item['id'])

def test_individual_input_pages_search_read_and_reopen_without_core_row(tmp_path):
    store,thread=_store(tmp_path)
    owner,_=store.accept(thread,'owner','held')
    store.claim_next(thread)
    first,_=store.accept(thread,'client-A','same 原文')
    second,_=store.accept(thread,'client-B','same 原文')
    store.claim_busy_text(thread)
    store.claim_busy_text(thread)
    store.finish_receipt(first['id'],'received')
    store.finish_receipt(second['id'],'unknown')
    store.finish_receipt(owner['id'],'interrupted')
    core=tmp_path/'empty-core.db'
    with sqlite3.connect(core) as db:
        db.execute('CREATE TABLE messages (id INTEGER PRIMARY KEY)')
    reopened=Store(store.path)
    reopened.recover_receipts(core)
    messages=reopened.history_page(thread,core)['messages']
    assert [(m['id'],m['client_message_id'],m['text']) for m in messages]==[
        ('receipt:'+owner['id'],'owner','held'),
        ('receipt:'+first['id'],'client-A','same 原文'),
        ('receipt:'+second['id'],'client-B','same 原文')]
    assert [m['ref_seq'] for m in messages]==sorted(m['ref_seq'] for m in messages)
    assert reopened.history_page(thread,core,latest=True,limit=1)['messages']==[messages[-1]]
    assert reopened.history_page(thread,core,before=reopened._older_cursor(thread,messages[-1]['ref_seq']))['messages']==messages[:2]
    forward=reopened.history_page(thread,core,limit=1)
    assert forward['messages']==[messages[0]]
    assert reopened.history_page(thread,core,after=forward['next_cursor'])['messages']==messages[1:]
    search=reopened.search_page(thread,core,'原文',limit=1)
    assert search['messages']==[messages[1]]
    assert reopened.search_page(thread,core,'原文',after=search['next_cursor'])['messages']==[messages[2]]
    assert reopened.snapshot()['threads'][0]['unread_count']==3
    assert reopened.read_thread(thread,messages[0]['ref_seq'])['unread_count']==2
    assert reopened.read_thread(thread,messages[2]['ref_seq'])['unread_count']==0
    assert reopened.accept(thread,'client-A','same 原文')[1] is False
    assert len(reopened.history_page(thread,core)['messages'])==3

def test_exact_fallback_promotes_input_in_place_and_keeps_original_id(tmp_path):
    store,thread=_store(tmp_path)
    owner,_=store.accept(thread,'owner','held')
    store.claim_next(thread)
    item,_=store.accept(thread,'boundary','normal fallback')
    store.claim_busy_text(thread)
    core=tmp_path/'core.db'
    with sqlite3.connect(core) as db:
        db.execute('CREATE TABLE messages (id INTEGER PRIMARY KEY,session_id TEXT,role TEXT,'
                   'platform_message_id TEXT,content TEXT,display_kind TEXT,tool_calls TEXT)')
        db.execute('INSERT INTO messages VALUES (1,?,?,?,?,?,?)',
                   ('session','user',item['id'],'normal fallback',None,None))
    before=store.history_page(thread,core)['messages'][1]
    assert store.link_user_from_core(item['id'],core)
    store.bind_turn('formal','session')
    store.append_hook_refs(thread,'formal',[('session',1,'user')])
    after=Store(store.path).history_page(thread,core)['messages'][1]
    assert (before['id'],before['ref_seq'],before['text'])==(after['id'],after['ref_seq'],after['text'])
    with store._connect() as db:
        assert db.execute('SELECT COUNT(*) FROM message_refs').fetchone()[0]==2
        assert db.execute('SELECT pending_text FROM receipts WHERE id=?',(item['id'],)).fetchone()[0] is None

def test_unreadable_exact_anchor_cannot_discard_input_original(tmp_path):
    store,thread=_store(tmp_path)
    owner,_=store.accept(thread,'owner','held')
    store.claim_next(thread)
    item,_=store.accept(thread,'boundary','keep this')
    store.claim_busy_text(thread)
    core=tmp_path/'core.db'
    with sqlite3.connect(core) as db:
        db.execute('CREATE TABLE messages (id INTEGER PRIMARY KEY,session_id TEXT,role TEXT,'
                   'platform_message_id TEXT,content TEXT,display_kind TEXT,tool_calls TEXT)')
        db.execute('INSERT INTO messages VALUES (1,?,?,?,?,?,?)',
                   ('session','user',item['id'],'internal','hidden',None))
    assert not store.link_user_from_core(item['id'],core)
    with store._connect() as db:
        assert db.execute('SELECT pending_text FROM receipts WHERE id=?',(item['id'],)).fetchone()[0]=='keep this'
    assert store.history_page(thread,core)['messages'][1]['text']=='keep this'

@pytest.mark.parametrize('partial',[False,True])
def test_old_ref_schema_migration_preserves_issued_cursors_and_read_marker(tmp_path,partial):
    store,thread=_store(tmp_path)
    store.begin_turn(thread,'old-turn')
    store.record_turn(thread,'old-turn',[('session',11,'user'),('session',12,'assistant')])
    store.read_thread(thread,1)
    prior=store.sync_page()['events']
    with sqlite3.connect(store.path) as db:
        db.execute('DROP TRIGGER published_ref')
        db.execute('DROP INDEX refs_page')
        db.execute('ALTER TABLE message_refs RENAME TO retired_refs')
        db.execute('CREATE TABLE message_refs (seq INTEGER PRIMARY KEY AUTOINCREMENT, '
                   'thread_id TEXT NOT NULL REFERENCES threads(id), '
                   'turn_id TEXT NOT NULL REFERENCES turns(turn_id), session_id TEXT NOT NULL, '
                   'row_id INTEGER UNIQUE'+(
                       ', input_receipt_id TEXT UNIQUE REFERENCES receipts(id), role TEXT NOT NULL, '
                       'CHECK ((row_id IS NULL) != (input_receipt_id IS NULL))' if partial else
                       ' NOT NULL, role TEXT NOT NULL')+')')
        db.execute('INSERT INTO message_refs(seq,thread_id,turn_id,session_id,row_id,role) '
                   'SELECT seq,thread_id,turn_id,session_id,row_id,role FROM retired_refs')
        db.execute('DROP TABLE retired_refs')
        db.execute('CREATE INDEX refs_page ON message_refs(thread_id,seq)')
        db.execute("CREATE TRIGGER published_ref AFTER INSERT ON message_refs BEGIN "
                   "INSERT INTO sync_events(kind,thread_id,ref,version) "
                   "VALUES ('message',NEW.thread_id,CAST(NEW.seq AS TEXT),1); END")
    reopened=Store(store.path)
    assert reopened.sync_page()['events']==prior
    assert reopened.snapshot()['threads'][0]['read_ref']==1
    assert reopened.read_thread(thread,1)['unread_count']==1
    with reopened._connect() as db:
        assert [(r['seq'],r['row_id']) for r in db.execute(
            'SELECT seq,row_id FROM message_refs ORDER BY seq')]==[(1,11),(2,12)]
    reopened.begin_turn(thread,'new-turn')
    reopened.record_turn(thread,'new-turn',[('session',13,'user')])
    assert reopened.snapshot()['threads'][0]['last_ref']==3


def test_queue_limit_sync_pagination_and_foreign_cursor(tmp_path):
    store,thread=_store(tmp_path)
    for index in range(32):
        store.accept(thread,f'client-{index}','body')
    with pytest.raises(OverflowError):
        store.accept(thread,'client-over','body')
    seen=[]
    cursor=None
    while True:
        page=store.sync_page(cursor=cursor,limit=7)
        seen.extend(e['event_id'] for e in page['events'])
        cursor=page['next_cursor']
        if not page['has_more']:
            break
    assert seen==list(range(1,len(seen)+1))
    assert len(seen)==65  # channel/thread event plus receipt and display event per accept
    with pytest.raises(ValueError,match='cursor'):
        store.sync_page(cursor=store._sync_cursor(1000))
    other=Store(tmp_path/'other.sqlite')
    with pytest.raises(ValueError,match='cursor'):
        other.sync_page(cursor=cursor)


def test_read_position_requires_visible_ref_and_never_rewinds(tmp_path):
    store,thread=_store(tmp_path)
    store.begin_turn(thread,'turn')
    store.record_turn(thread,'turn',[('session',1,'user'),('session',2,'assistant')])
    with sqlite3.connect(store.path) as db:
        refs=[r[0] for r in db.execute('SELECT seq FROM message_refs ORDER BY seq')]
    assert store.read_thread(thread,0)['unread_count']==2
    assert store.read_thread(thread,refs[0])['unread_count']==1
    assert store.read_thread(thread,0)=={'ref_seq':refs[0],'unread_count':1}
    assert store.read_thread(thread,refs[1])['unread_count']==0
    with pytest.raises(ValueError,match='unknown visible'):
        store.read_thread(thread,refs[1]+1)


def test_formal_completed_turn_survives_copied_compaction_anchor(tmp_path):
    store,thread=_store(tmp_path)
    receipt,_=store.accept(thread,'copy-case','original user')
    ingress='ingress:'+receipt['id']
    store.claim_next(thread)
    store.bind_turn('turn','session')
    source=tmp_path/'state.db'
    with sqlite3.connect(source) as db:
        db.execute('CREATE TABLE messages (id INTEGER PRIMARY KEY,session_id TEXT,role TEXT,'
                   'content TEXT,display_kind TEXT,tool_calls TEXT,finish_reason TEXT,'
                   'platform_message_id TEXT)')
        db.executemany('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)',[
            (1,'session','user','original user',None,None,None,receipt['id']),
            (2,'session','user','original user',None,None,None,receipt['id']),
            (3,'session','assistant','final',None,None,'stop',None)])
    assert store.link_user_from_core(receipt['id'],source)
    store.record_turn(thread,'turn',[('session',1,'user'),('session',3,'assistant')])
    before=store.turn_refs('turn')
    store.settle_ingress(thread,ingress,receipt['id'],source,owner_finished=True)
    assert store.turn_state(ingress)=='complete'
    assert store.turn_refs('turn')==before
    with sqlite3.connect(store.path) as db:
        assert db.execute("SELECT COUNT(*) FROM message_refs WHERE thread_id=?",(thread,)).fetchone()[0]==2


def test_recover_final_after_copied_anchor_keeps_published_refs(tmp_path):
    store,thread=_store(tmp_path)
    receipt,_=store.accept(thread,'compressed-crash','ask')
    store.claim_next(thread)
    store.bind_turn('real-turn','session')
    source=tmp_path/'state.db'
    with sqlite3.connect(source) as db:
        db.execute('CREATE TABLE messages (id INTEGER PRIMARY KEY,session_id TEXT,role TEXT,'
                   'content TEXT,display_kind TEXT,tool_calls TEXT,finish_reason TEXT,'
                   'platform_message_id TEXT)')
        db.executemany('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)',[
            (1,'session','user','ask',None,None,None,receipt['id']),
            (2,'session','assistant','interim',None,'[{"id":"tool"}]','tool_calls',None),
            (3,'session','user','ask',None,None,None,receipt['id']),
            (4,'session','assistant','final',None,None,'stop',None),
            (5,'unowned','assistant','foreign',None,None,'stop',None)])
    assert store.link_user_from_core(receipt['id'],source)
    store.append_hook_refs(thread,'real-turn',[('session',1,'user'),('session',2,'assistant')])
    before=store.history_page(thread,source)['messages']
    store.recover_receipts(source)
    after=store.history_page(thread,source)['messages']
    assert [m['id'] for m in after]==['receipt:'+receipt['id'],'2','4']
    assert after[:2] == before
    assert (after[0]['receipt_id'], after[0]['client_message_id']) == (receipt['id'], 'compressed-crash')
    assert 'receipt_id' not in after[1]
    assert store.receipt(receipt['id'])['state']=='unknown'
    assert store.sync_page()['events'][-1]['kind']=='receipt'
    store.recover_receipts(source)
    assert [m['id'] for m in store.history_page(thread,source)['messages']]==['receipt:'+receipt['id'],'2','4']


def test_accept_retry_after_archive_and_atomic_new_rejection(tmp_path):
    store,thread=_store(tmp_path)
    original,_=store.accept(thread,'existing','body')
    store.update_thread(thread,archived=True)
    retry,created=store.accept(thread,'existing','body')
    assert not created and retry['id']==original['id']
    with pytest.raises(ValueError,match='archived'):
        store.accept(thread,'new','body')
    with pytest.raises(ValueError,match='conflict'):
        store.accept(thread,'existing','changed')


def test_empty_claim_accept_wakeup_and_owner_callback_identity(tmp_path,monkeypatch):
    async def scenario():
        store,thread=_store(tmp_path)
        entered,release=asyncio.Event(),asyncio.Event()
        first=True
        async def held_to_thread(fn,*args,**kwargs):
            nonlocal first
            if fn==store.claim_next and first:
                first=False
                result=fn(*args,**kwargs)
                assert result is None
                entered.set()
                await release.wait()
                return result
            return fn(*args,**kwargs)
        monkeypatch.setattr(asyncio,'to_thread',held_to_thread)
        adapter=object.__new__(HermesAppAdapter)
        adapter._store=store
        adapter._stopping=False
        adapter._queue_tasks={}
        adapter._queue_wakes={}
        adapter._events_changed=asyncio.Event()
        adapter._gateway_starting=lambda:False
        adapter._source=lambda *args:None
        adapter._gateway_owner=lambda:SimpleNamespace(_effective_busy_input_mode=lambda source:'interrupt')
        adapter._session_tasks={}
        adapter._event_session_key=lambda event:'owner'
        seen=[]
        async def handle(event):
            seen.append(event.message_id)
            event._gateway_accepted=True
            adapter._session_tasks['owner']=asyncio.create_task(asyncio.sleep(0))
        adapter.handle_message=handle
        adapter._settle_ingress=lambda *args,**kwargs:asyncio.sleep(0)
        store.link_user_from_core=lambda *args:True
        adapter._wake_thread(thread)
        old=adapter._queue_tasks[thread]
        await asyncio.wait_for(entered.wait(),2)
        receipt,_=store.accept(thread,'arrives-at-idle','hello')
        adapter._wake_thread(thread)
        release.set()
        await asyncio.wait_for(old,5)
        assert seen==[receipt['id']]
        assert store.receipt(receipt['id'])['state']!='queued'
        # A completed owner callback must not remove the replacement owner.
        adapter._queue_loop=lambda _:asyncio.sleep(0)
        adapter._wake_thread(thread)
        old=adapter._queue_tasks[thread]
        old_callback=old._callbacks[0][0]
        await old
        hold=asyncio.Event()
        adapter._queue_loop=lambda _:hold.wait()
        adapter._wake_thread(thread)
        newer=adapter._queue_tasks[thread]
        assert newer is not old
        old_callback(old)
        await asyncio.sleep(0)
        assert adapter._queue_tasks[thread] is newer
        hold.set()
        await newer
    asyncio.run(asyncio.wait_for(scenario(), 8))


def test_queued_before_primary_active_drains_native_fifo(tmp_path):
    async def scenario():
        store,thread=_store(tmp_path)
        first,_=store.accept(thread,'first','first')
        second,_=store.accept(thread,'second','second')
        third,_=store.accept(thread,'third','third')
        adapter=object.__new__(HermesAppAdapter)
        adapter._store=store
        adapter._stopping=False
        adapter._queue_wakes={}
        adapter._queue_tasks={}
        adapter._events_changed=asyncio.Event()
        adapter._gateway_starting=lambda:False
        adapter._gateway_owner=lambda:SimpleNamespace(_effective_busy_input_mode=lambda source:'steer')
        adapter._source=lambda *args:None
        adapter._session_tasks={}
        adapter._event_session_key=lambda event:'owner'
        adapter._active_receipts={}
        adapter._session_threads={}
        adapter._stop_receipts=set()
        adapter._generation='test'
        adapter._followup_tasks=set()
        adapter._reconcile_followup=lambda *args:asyncio.sleep(0)
        adapter._settle_ingress=lambda *args,**kwargs:asyncio.sleep(0)
        store.link_user_from_core=lambda *args:True
        seen=[]
        async def handle(event):
            seen.append(event.message_id)
            if event.message_id==first['id']:
                event._gateway_accepted=True
                adapter._session_tasks['owner']=asyncio.create_task(asyncio.sleep(.03))
        adapter.handle_message=handle
        assert adapter._active_receipts=={}
        await adapter._dispatch_busy_text(thread)
        assert seen==[]
        await asyncio.wait_for(adapter._queue_loop(thread),5)
        await asyncio.gather(*adapter._followup_tasks)
        assert seen==[first['id'],second['id'],third['id']]
        assert [store.receipt(r['id'])['admission'] for r in (second,third)]==['followup','followup']
        assert [store.receipt(r['id'])['state'] for r in (second,third)]==['running','running']
    asyncio.run(scenario())


def test_channel_reconcile_versions_and_restart_gap(tmp_path):
    store,_=_store(tmp_path)
    channel={'id':'p','name':'one','description':'initial'}
    assert store.reconcile_channels([channel])
    assert not store.reconcile_channels([channel])
    cursor=store.sync_page()['waterline']
    channel['name']='two'
    assert store.reconcile_channels([channel])
    channel['description']='edited'
    assert Store(store.path).reconcile_channels([channel])
    assert store.reconcile_channels([])
    events=store.sync_page(cursor=cursor)['events']
    assert [(e['kind'],e['ref'],e['version']) for e in events]==[
        ('channel','p',2),('channel','p',3),('channel','p',4)]
    assert not store.reconcile_channels([])


def test_durable_versions_converge_after_duplicate_out_of_order_replay(tmp_path):
    store,thread=_store(tmp_path)
    receipt,_=store.accept(thread,'same-id','body')
    store.claim_next(thread)
    store.finish_receipt(receipt['id'],'unknown')
    for i in range(530):
        store.update_thread(thread,title=f'T{i}')
    all_events=[]
    cursor=None
    while True:
        page=store.sync_page(cursor=cursor,limit=97)
        all_events.extend(page['events'])
        cursor=page['next_cursor']
        if not page['has_more']:
            break
    assert len(all_events)>512
    def reduce(events):
        current={}
        for event in events:
            key=(event['kind'],event['thread_id'],event['ref'])
            if key not in current or (event['version'],event['event_id'])>(
                    current[key]['version'],current[key]['event_id']):
                current[key]=event
        return current
    scrambled=all_events[::-1]+all_events[::3]+all_events
    assert reduce(scrambled)==reduce(all_events)
    assert reduce(scrambled)[('receipt',thread,receipt['id'])]['version']==3
    assert reduce(scrambled)[('thread',thread,thread)]['version']==531
