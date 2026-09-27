"""Handoff acknowledgement is independent from execution and history."""
import asyncio
import sqlite3
from types import SimpleNamespace

import pytest
from hermes_app.adapter import HermesAppAdapter
from hermes_app.storage import Store


@pytest.mark.parametrize('fails', [False, True])
def test_handoff_ack_only_after_gateway_return(tmp_path, fails):
    async def scenario():
        store = Store(tmp_path/'metadata.sqlite')
        thread = store.create_thread('project', 'test', 'session', '')
        primary, _ = store.accept(thread, 'owner', 'original')
        store.claim_next(thread)
        receipt, _ = store.accept(thread, 'followup', 'additional')
        adapter = object.__new__(HermesAppAdapter)
        adapter._store = store
        adapter._stopping = False
        adapter._active_receipts = {thread: primary['id']}
        adapter._events_changed = asyncio.Event()
        adapter._followup_tasks = set()
        adapter._gateway_starting = lambda: False
        adapter._source = lambda *args: None
        adapter._gateway_owner = lambda: SimpleNamespace(_effective_busy_input_mode=lambda source: 'steer')
        # Settlement remains held: acknowledgement must not wait for it.
        settle = asyncio.Event()
        adapter._reconcile_followup = lambda *args: settle.wait()
        entered, release = asyncio.Event(), asyncio.Event()
        calls = []
        async def handle(event):
            calls.append((event.message_id, event.text))
            entered.set()
            await release.wait()
            if fails:
                raise RuntimeError('test handoff error')
        adapter.handle_message = handle
        task = asyncio.create_task(adapter._dispatch_busy_text(thread))
        await entered.wait()
        assert 'handed_off' not in store.receipt(receipt['id'])
        release.set()
        await task
        value = store.receipt(receipt['id'])
        assert value.get('handed_off', False) is (not fails)
        assert value['state'] == ('unknown' if fails else 'running')
        assert store.receipt(primary['id'])['state'] == 'running'
        active = store.snapshot()['threads'][0]['active_receipts']
        assert next(r for r in active if r['id'] == primary['id']).get('handed_off') is None
        if not fails:
            assert next(r for r in active if r['id'] == receipt['id'])['handed_off'] is True
        assert store.claim_next(thread) is None
        # Durable acknowledgement survives reopen/retry without second handoff.
        cold = Store(store.path)
        retry, created = cold.accept(thread, 'followup', 'additional')
        assert not created and retry == value
        await adapter._dispatch_busy_text(thread)
        assert calls == [(receipt['id'], 'additional')]
        if not fails:
            before = cold.sync_page()['events']
            cold.mark_handed_off(receipt['id'])
            assert cold.sync_page()['events'] == before
        settle.set()
        await asyncio.gather(*adapter._followup_tasks)
    asyncio.run(asyncio.wait_for(scenario(), 5))


def test_old_receipt_schema_migrates_without_claiming_handoff(tmp_path):
    path = tmp_path/'metadata.sqlite'
    store = Store(path)
    thread = store.create_thread('project', 'test', 'session', '')
    receipt, _ = store.accept(thread, 'existing', 'original')
    with sqlite3.connect(path) as db:
        db.execute('ALTER TABLE receipts DROP COLUMN handed_off')
    cold = Store(path)
    assert cold.receipt(receipt['id']) == receipt
    assert 'handed_off' not in cold.receipt(receipt['id'])
