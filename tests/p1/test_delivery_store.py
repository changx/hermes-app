"""Small durable ingress and cursor invariants; real gateway tests are separate."""
import concurrent.futures
import sqlite3

import pytest

from hermes_app.storage import Store


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
    assert len(seen)==33
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
    store.record_turn(thread,'turn',[('session',1,'user'),('session',3,'assistant')])
    before=store.turn_refs('turn')
    store.settle_ingress(thread,ingress,receipt['id'],source,owner_finished=True)
    assert store.turn_state(ingress)=='complete'
    assert store.turn_refs('turn')==before
    with sqlite3.connect(store.path) as db:
        assert db.execute("SELECT COUNT(*) FROM message_refs WHERE thread_id=?",(thread,)).fetchone()[0]==2


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
