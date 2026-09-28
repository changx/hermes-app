"""Historical outcomes stay unchanged; current command callbacks still settle."""
import asyncio

import pytest
from gateway.platforms.base import ProcessingOutcome
from hermes_app.storage import Store
from test_direct_adapter import setup as adapter_setup, event_for


def legacy(store, thread, name, *, processing='completed', output=True,
           model_link=False, anchor=False, followup=False, ingress_state='unknown'):
    receipt, _ = store.accept(thread, name, '/' + name)
    if followup:
        assert store.claim_busy_text(thread) == (receipt['id'], '/' + name)
    else:
        assert store.claim_next(thread) == (receipt['id'], '/' + name)
    if output:
        store.create_direct_message(thread, receipt['id'], 'native result')
    if processing:
        store.record_processing(receipt['id'], thread, processing)
    if model_link:
        store.bind_turn('model:' + name, store.get_thread(thread)['session_id'])
    if anchor:
        store.link_user_receipt(receipt['id'], 900)
    if not followup and ingress_state == 'unknown':
        store.mark_ingress_unknown(thread, 'ingress:' + receipt['id'])
    elif not followup and ingress_state == 'failed':
        with store._connect() as db:
            db.execute("UPDATE turns SET state='failed' WHERE turn_id=?", ('ingress:' + receipt['id'],))
    store.finish_receipt(receipt['id'], 'unknown')
    return receipt['id']


def test_legacy_direct_outcome_is_not_rewritten_by_startup(tmp_path):
    store = Store(tmp_path / 'metadata.sqlite')
    thread = store.create_thread('p', 'commands', 'session', '')
    receipt_id = legacy(store, thread, 'usage')
    assert store.turn_state('ingress:' + receipt_id) == 'unknown'
    before = store.history_page(thread, tmp_path/'absent.db')['messages']
    events = store.sync_page()['events']
    cold = Store(store.path)
    assert cold.recover_receipts() == []
    assert cold.receipt(receipt_id)['state'] == 'unknown'
    assert cold.receipt(receipt_id)['processing'] == 'completed'
    assert cold.turn_state('ingress:' + receipt_id) == 'unknown'
    assert cold.history_page(thread, tmp_path/'absent.db')['messages'] == before
    assert cold.sync_page()['events'] == events
    assert cold.accept(thread, 'usage', '/usage') == (cold.receipt(receipt_id), False)
    recovered_events = cold.sync_page()['events']
    assert cold.recover_receipts() == []
    assert cold.sync_page()['events'] == recovered_events
    assert cold.claim_next(thread) is None


@pytest.mark.parametrize('kwargs', [
    {'processing': None}, {'processing': 'failed'}, {'processing': 'interrupted'},
    {'output': False}, {'model_link': True}, {'anchor': True},
    {'followup': True}, {'ingress_state': 'pending'}, {'ingress_state': 'failed'},
])
def test_unproven_or_modeled_outcome_remains_unknown(tmp_path, kwargs):
    store = Store(tmp_path/'metadata.sqlite')
    thread = store.create_thread('p', 'commands', 'session', '')
    if kwargs.get('followup'):
        store.accept(thread, 'owner', 'busy')
        store.claim_next(thread)
    receipt_id = legacy(store, thread, 'maybe', **kwargs)
    before = store.sync_page()['events']
    cold = Store(store.path)
    cold.recover_receipts()
    assert cold.receipt(receipt_id)['state'] == 'unknown'
    assert all(e['ref'] != receipt_id for e in cold.sync_page()['events'][len(before):])
    assert cold.claim_next(thread) is None


@pytest.mark.parametrize('outcome,state', [
    (ProcessingOutcome.SUCCESS, 'completed'),
    (ProcessingOutcome.FAILURE, 'failed'),
    (ProcessingOutcome.CANCELLED, 'interrupted'),
])
def test_current_direct_callback_settles_before_generic_owner_path(tmp_path, monkeypatch, outcome, state):
    app, store, thread = adapter_setup(tmp_path, monkeypatch)
    receipt, event = event_for(store, thread, 'status')
    store.create_direct_message(thread, receipt['id'], 'direct result')
    asyncio.run(app.on_processing_complete(event, outcome))
    assert store.receipt(receipt['id'])['state'] == state
    assert store.receipt(receipt['id'])['processing'] == state
    assert store.turn_state('ingress:' + receipt['id']) == ('complete' if state == 'completed' else state)
    assert Store(store.path).recover_receipts() == []
    assert store.receipt(receipt['id'])['state'] == state
