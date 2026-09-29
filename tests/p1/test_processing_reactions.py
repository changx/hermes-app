"""Reaction provenance is the native platform callback, never a history guess."""
import asyncio
import sqlite3
from types import SimpleNamespace

import pytest
from gateway.platforms.base import ProcessingOutcome
from hermes_app.adapter import HermesAppAdapter
from hermes_app.storage import Store


def setup(tmp_path):
    store = Store(tmp_path/'metadata.sqlite')
    thread = store.create_thread('p', 'test', 's', '')
    receipt, _ = store.accept(thread, 'one', 'hello')
    app = object.__new__(HermesAppAdapter)
    app._store = store
    app._events_changed = asyncio.Event()
    event = SimpleNamespace(message_id=receipt['id'], source=SimpleNamespace(thread_id=thread))
    return store, thread, receipt, app, event


@pytest.mark.parametrize('outcome,expected', [
    (ProcessingOutcome.SUCCESS, 'completed'),
    (ProcessingOutcome.FAILURE, 'failed'),
    (ProcessingOutcome.CANCELLED, 'interrupted'),
])
def test_only_callbacks_define_reaction_and_survive_settlement(tmp_path, outcome, expected):
    store, thread, receipt, app, event = setup(tmp_path)
    store.claim_next(thread)
    assert store.receipt(receipt['id'])['processing'] is None
    asyncio.run(app.on_processing_start(event))
    assert store.receipt(receipt['id'])['processing'] == 'running'
    assert app._events_changed.is_set()
    app._events_changed.clear()
    asyncio.run(app.on_processing_complete(event, outcome))
    assert app._events_changed.is_set()
    # History provenance can remain uncertain without revoking a real callback.
    store.finish_receipt(receipt['id'], 'unknown')
    cold = Store(store.path)
    saved = cold.receipt(receipt['id'])
    assert saved['state'] == 'unknown' and saved['processing'] == expected
    with cold._connect() as db:
        versions = [row['version'] for row in db.execute(
            "SELECT version FROM sync_events WHERE kind='receipt' AND ref=? ORDER BY seq",
            (receipt['id'],)).fetchall()]
    assert versions == [1, 2, 3, 4, 5]
    before = cold.sync_page()['events']
    asyncio.run(app.on_processing_start(event))  # duplicate late start
    asyncio.run(app.on_processing_complete(event, outcome))
    assert cold.sync_page()['events'] == before
    assert cold.accept(thread, 'one', 'hello') == (saved, False)
    cold.recover_receipts()
    assert cold.receipt(receipt['id']) == saved


def test_handoff_and_inferred_completion_do_not_make_reactions(tmp_path):
    store, thread, owner, app, event = setup(tmp_path)
    store.claim_next(thread)
    follow, _ = store.accept(thread, 'two', 'more')
    store.claim_busy_text(thread)
    store.mark_handed_off(follow['id'])
    assert store.receipt(follow['id'])['processing'] is None
    store.finish_receipt(follow['id'], 'received')
    store.finish_receipt(owner['id'], 'completed')
    assert store.receipt(owner['id'])['processing'] is None
    assert store.receipt(follow['id'])['processing'] is None
    # An exact independent start callback, if one occurs, is authoritative.
    event.message_id = follow['id']
    asyncio.run(app.on_processing_start(event))
    asyncio.run(app.on_processing_complete(event, ProcessingOutcome.SUCCESS))
    assert store.receipt(follow['id'])['processing'] == 'completed'


def test_recovery_clears_only_unfinished_callback_and_never_reexecutes(tmp_path):
    store, thread, owner, app, event = setup(tmp_path)
    store.claim_next(thread)
    asyncio.run(app.on_processing_start(event))
    follow, _ = store.accept(thread, 'two', 'more')
    store.claim_busy_text(thread)
    store.mark_handed_off(follow['id'])
    cold = Store(store.path)
    assert cold.recover_receipts() == []
    assert cold.receipt(owner['id'])['processing'] == 'unknown'
    assert cold.receipt(follow['id'])['processing'] is None
    assert cold.claim_next(thread) is None
    assert cold.receipt(owner['id'])['state'] == cold.receipt(follow['id'])['state'] == 'unknown'


def test_migration_does_not_invent_past_callbacks_and_checks_exact_identity(tmp_path):
    store, thread, owner, app, event = setup(tmp_path)
    store.claim_next(thread)
    store.finish_receipt(owner['id'], 'completed')
    with sqlite3.connect(store.path) as db:
        db.execute('ALTER TABLE receipts DROP COLUMN processing')
    cold = Store(store.path)
    assert cold.receipt(owner['id'])['processing'] is None
    cold.record_processing(owner['id'], 'other-thread', 'completed')
    cold.record_processing('not-a-receipt', thread, 'completed')
    assert cold.receipt(owner['id'])['processing'] is None
    with pytest.raises(ValueError):
        cold.record_processing(owner['id'], thread, 'guessed')


def test_version_migration_republishes_current_receipt_once(tmp_path):
    store, thread, receipt, app, event = setup(tmp_path)
    store.claim_next(thread)
    asyncio.run(app.on_processing_start(event))
    asyncio.run(app.on_processing_complete(event, ProcessingOutcome.SUCCESS))
    store.finish_receipt(receipt['id'], 'completed')
    with sqlite3.connect(store.path) as db:
        prior = db.execute("SELECT MAX(version) FROM sync_events WHERE kind='receipt' AND ref=?",
                           (receipt['id'],)).fetchone()[0]
        db.execute('ALTER TABLE receipts DROP COLUMN event_version')
    migrated = Store(store.path)
    with migrated._connect() as db:
        versions = [row['version'] for row in db.execute(
            "SELECT version FROM sync_events WHERE kind='receipt' AND ref=? ORDER BY seq",
            (receipt['id'],)).fetchall()]
    assert versions[-1] == prior + 1
    assert Store(store.path).sync_page()['events'][-1]['version'] == prior + 1
