"""P1-04 metadata quotas and receipt/attachment transaction boundaries."""
import pytest

from hermes_app.storage import Store


def test_unattached_quota_and_scoped_receipt_claim(tmp_path):
    store=Store(tmp_path/'metadata.sqlite')
    first=store.create_thread('project','first','session-first','')
    second=store.create_thread('project','second','session-second','')
    ids=[f'att_{i:032x}' for i in range(66)]
    for item in ids[:64]:
        store.attachment_add(first,item,'note.txt','text/plain',1)
    with pytest.raises(OverflowError,match='quota'):
        store.attachment_add(first,ids[64],'note.txt','text/plain',1)
    store.attachment_add(second,ids[64],'note.txt','text/plain',1)
    with pytest.raises(ValueError,match='attachment unavailable'):
        store.accept(first,'wrong-thread','hello',[ids[64]])
    assert store.attachment_delete_unattached(first,ids[0])
    store.attachment_add(first,ids[65],'note.txt','text/plain',1)
    receipt,created=store.accept(first,'file-send','hello',[ids[65]])
    assert created and store.receipt_attachments(receipt['id'])[0]['id']==ids[65]
    assert not store.attachment_delete_unattached(first,ids[65])
    retry,created=store.accept(first,'file-send','hello',[ids[65]])
    assert not created and retry==receipt
    with pytest.raises(ValueError,match='conflict'):
        store.accept(first,'file-send','hello',[])
    # Empty-attachment digest stays compatible with receipts persisted by P1-03.
    plain,_=store.accept(first,'plain-send','same body')
    assert store.accept(first,'plain-send','same body',[])[0]==plain


def test_snapshot_covers_full_admitted_queue(tmp_path):
    store=Store(tmp_path/'metadata.sqlite')
    thread=store.create_thread('project','full queue','session-queue','')
    expected={store.accept(thread,f'queued-{i}','hello')[0]['id'] for i in range(32)}
    with pytest.raises(OverflowError,match='queue full'):
        store.accept(thread,'overflow','hello')
    snapshot=store.snapshot()
    assert {r['id'] for r in snapshot['threads'][0]['active_receipts']}==expected
    store.claim_next(thread)
    snapshot=store.snapshot()
    active=snapshot['threads'][0]['active_receipts']
    assert {r['id'] for r in active}==expected
    assert sum(r['state']=='running' for r in active)==1
