"""Hermes maintenance notices are durable Thread UI, never Agent transcript rows."""
import asyncio
import sqlite3
import threading
from types import SimpleNamespace

import pytest

from gateway.run import _send_or_update_status_coro
from gateway.run_turn_runner import TurnRunner
from agent.conversation_compression import COMPACTION_DONE_STATUS, ROUTINE_COMPRESSION_STATUS_SAMPLES
from hermes_app.adapter import HermesAppAdapter
from hermes_app.storage import Store


REVIEW = "💾 Self-improvement review: Memory updated"
START = "🗜️ Compacting context — summarizing earlier conversation so I can continue..."
HEARTBEAT = "🗜️ Compacting context — still summarizing earlier conversation so I can continue..."
DONE = "✓ Context compaction complete — continuing turn..."


def test_pinned_core_compression_envelopes_stay_recognized():
    assert DONE == COMPACTION_DONE_STATUS
    progress = [text for text in ROUTINE_COMPRESSION_STATUS_SAMPLES if text != DONE]
    assert progress and all(HermesAppAdapter._compression_progress(text) for text in progress)


def setup(tmp_path):
    store = Store(tmp_path / "metadata.sqlite")
    thread = store.create_thread("project", "one", "session-one", "")
    other = store.create_thread("other-project", "two", "session-two", "")
    app = object.__new__(HermesAppAdapter)
    app._store = store
    app._events_changed = asyncio.Event()
    app._status_locks = {}
    return app, store, thread, other, tmp_path / "missing-state.db"


def test_store_notice_history_search_sync_edit_attempts_and_cold_reload(tmp_path):
    _, store, thread, other, source = setup(tmp_path)
    cursor = store.sync_page()["next_cursor"]
    review = store.create_system_notice(thread, "review", REVIEW)
    started, changed = store.upsert_compression_notice(thread, START, phase='active')
    assert changed and started != review
    assert store.upsert_compression_notice(thread, HEARTBEAT) == (started, True)
    before_repeat = store.sync_page()["next_cursor"]
    assert store.upsert_compression_notice(thread, HEARTBEAT) == (started, False)
    assert store.sync_page(cursor=before_repeat)["events"] == []
    assert store.upsert_compression_notice(thread, DONE, phase='complete') == (started, True)
    next_attempt, changed = store.upsert_compression_notice(thread, START, phase='active')
    assert changed and next_attempt not in (review, started)

    messages = Store(store.path).history_page(thread, source)["messages"]
    assert [m["id"] for m in messages] == [review, started, next_attempt]
    assert [m["role"] for m in messages] == ["system"] * 3
    assert [m["display_kind"] for m in messages] == ["system_notice"] * 3
    assert [m["text"] for m in messages] == [REVIEW, DONE, START]
    assert all(m["attachments"] == [] and "created_at" in m for m in messages)
    assert Store(store.path).history_page(thread, source, ref_seq=messages[1]["ref_seq"])["messages"] == [messages[1]]
    assert Store(store.path).search_page(thread, source, "compaction complete")["messages"] == [messages[1]]
    assert Store(store.path).search_page(other, source, "self-improvement")["messages"] == []
    summary = next(t for t in Store(store.path).snapshot()["threads"] if t["id"] == thread)
    assert summary["last_ref"] == messages[-1]["ref_seq"] and summary["unread_count"] == 3

    events = store.sync_page(cursor=cursor)["events"]
    refs = [str(m["ref_seq"]) for m in messages]
    assert [(e["ref"], e["version"]) for e in events] == [
        (refs[0], 1), (refs[1], 1), (refs[1], 2), (refs[1], 3), (refs[2], 1)]
    assert not source.exists()
    with sqlite3.connect(store.path) as db:
        assert db.execute("SELECT COUNT(*) FROM message_refs WHERE system_notice_id IS NOT NULL").fetchone()[0] == 3
        assert db.execute("SELECT COUNT(*) FROM message_refs WHERE row_id IS NOT NULL OR direct_message_id IS NOT NULL").fetchone()[0] == 0
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("INSERT INTO message_refs(thread_id,turn_id,session_id,role) VALUES (?,?,?,'system')",
                       (thread, "notice:" + review, "session-one"))


@pytest.mark.parametrize("kind,text", [("other", "valid"), ("review", ""), ("review", "x" * 12001)])
def test_store_rejects_invalid_notice(kind, text, tmp_path):
    _, store, thread, _, _ = setup(tmp_path)
    with pytest.raises(ValueError):
        store.create_system_notice(thread, kind, text)


def test_adapter_admits_only_owned_review_and_compression_envelopes(tmp_path):
    app, store, thread, other, source = setup(tmp_path)

    async def run():
        marked = {"thread_id": thread, "_interim_send": True}
        review = await app.send("project", REVIEW, metadata=marked)
        assert review.success and review.message_id.startswith("notice_")
        for result in (
            await app.send("project", REVIEW, metadata={"thread_id": thread}),
            await app.send("project", "💾 Other status", metadata=marked),
            await app.send("project", REVIEW, reply_to="rc_fake", metadata=marked),
            await app.send("project", REVIEW, metadata={"thread_id": other, "_interim_send": True}),
            await app.send("other-project", REVIEW, metadata={"thread_id": thread, "_interim_send": True}),
            await app.send("project", "x" * 12001, metadata=marked),
        ):
            assert not result.success

        started = await _send_or_update_status_coro(app, "project", "lifecycle", START, {"thread_id": thread})
        same = await _send_or_update_status_coro(app, "project", "lifecycle", HEARTBEAT, {"thread_id": thread})
        finished = await _send_or_update_status_coro(app, "project", "compacted", DONE, {"thread_id": thread})
        assert started.success and same.success and finished.success
        assert started.message_id == same.message_id == finished.message_id
        for result in (
            await app.send_or_update_status("project", "warn", START, metadata={"thread_id": thread}),
            await app.send_or_update_status("project", "lifecycle", "Working", metadata={"thread_id": thread}),
            await app.send_or_update_status("project", "lifecycle",
                "⚠ Context is over the compression threshold but compression is currently blocked",
                metadata={"thread_id": thread}),
            await app.send_or_update_status("project", "compacted", "not complete", metadata={"thread_id": thread}),
            await app.send_or_update_status("project", "lifecycle", START, metadata={"thread_id": other}),
            await app.send_or_update_status("other-project", "lifecycle", START, metadata={"thread_id": thread}),
            await app.send_or_update_status("project", "lifecycle", "", metadata={"thread_id": thread}),
        ):
            assert not result.success

    asyncio.run(run())
    messages = store.history_page(thread, source)["messages"]
    assert [(m["role"], m["display_kind"], m["text"]) for m in messages] == [
        ("system", "system_notice", REVIEW), ("system", "system_notice", DONE)]
    assert store.history_page(other, source)["messages"] == []


def test_gateway_delayed_review_release_reaches_owned_app_thread(tmp_path):
    app, store, thread, _, source = setup(tmp_path)
    delivered = []
    ctx = SimpleNamespace(
        session_key="app-session", source=SimpleNamespace(platform=SimpleNamespace(value="hermes_app")),
        _status_thread_metadata={"thread_id": thread})

    def send_status(message, metadata, error):
        result = asyncio.run(app.send("project", message, metadata=metadata))
        assert result.success, error
        delivered.append((message, metadata, result.message_id))

    holder = SimpleNamespace(_ctx=ctx, _status_live=lambda: True, _send_status_text=send_status)
    send, release = TurnRunner._make_bg_review_callbacks(holder)
    send(REVIEW)
    assert delivered == [] and store.history_page(thread, source)["messages"] == []
    release()
    assert delivered[0][1] == {"thread_id": thread, "_interim_send": True}
    assert store.history_page(thread, source)["messages"][0]["text"] == REVIEW


def test_status_handoff_serializes_start_before_completion(tmp_path):
    app, store, thread, _, source = setup(tmp_path)
    original = store.upsert_compression_notice
    entered = threading.Event()
    release = threading.Event()

    def delayed(thread_id, text, *, phase='pending'):
        if phase == 'active':
            entered.set()
            assert release.wait(2)
        return original(thread_id, text, phase=phase)

    app._store.upsert_compression_notice = delayed

    async def run():
        start = asyncio.create_task(app.send_or_update_status(
            'project','lifecycle',START,metadata={'thread_id':thread}))
        assert await asyncio.to_thread(entered.wait,2)
        done = asyncio.create_task(app.send_or_update_status(
            'project','compacted',DONE,metadata={'thread_id':thread}))
        await asyncio.sleep(0)
        release.set()
        first, last = await asyncio.gather(start,done)
        assert first.message_id == last.message_id

    asyncio.run(run())
    messages = store.history_page(thread,source)['messages']
    assert len(messages) == 1 and messages[0]['text'] == DONE


def test_failed_compression_retry_gets_new_identity_across_restart(tmp_path):
    _, store, thread, _, source = setup(tmp_path)
    preflight = '📦 Preflight compression: ~120,000 tokens >= 100,000 threshold. This may take a moment.'
    first, _ = store.upsert_compression_notice(thread,preflight)
    pending_cursor = store.sync_page()['next_cursor']
    assert store.upsert_compression_notice(thread,preflight) == (first,False)
    assert store.sync_page(cursor=pending_cursor)['events'] == []
    assert store.upsert_compression_notice(thread,START,phase='active') == (first,True)
    assert store.upsert_compression_notice(thread,HEARTBEAT) == (first,True)
    second, changed = store.upsert_compression_notice(thread,START,phase='active')
    assert changed and second != first
    cold = Store(store.path)
    assert cold.upsert_compression_notice(thread,HEARTBEAT) == (second,True)
    assert cold.upsert_compression_notice(thread,DONE,phase='complete') == (second,True)
    assert [(m['id'],m['text']) for m in cold.history_page(thread,source)['messages']] == [
        (first,HEARTBEAT),(second,DONE)]


def test_immediate_prior_ref_schema_preserves_direct_state_on_upgrade(tmp_path):
    _, store, thread, _, source = setup(tmp_path)
    receipt, _ = store.accept(thread,'input','hello')
    direct = store.create_direct_message(thread,receipt['id'],'native reply')
    prior_events = store.sync_page()['events']
    cursor = prior_events[0]['cursor']
    store.read_thread(thread,1)
    prior_events = store.sync_page()['events']
    with sqlite3.connect(store.path) as db:
        db.execute('DROP TRIGGER published_ref')
        db.execute('DROP INDEX refs_page')
        db.execute('ALTER TABLE message_refs RENAME TO retired_refs')
        db.execute('CREATE TABLE message_refs (seq INTEGER PRIMARY KEY AUTOINCREMENT, '
                   'thread_id TEXT NOT NULL REFERENCES threads(id), '
                   'turn_id TEXT NOT NULL REFERENCES turns(turn_id), session_id TEXT NOT NULL, '
                   'row_id INTEGER UNIQUE, input_receipt_id TEXT UNIQUE REFERENCES receipts(id), '
                   'direct_message_id TEXT UNIQUE REFERENCES direct_messages(id), role TEXT NOT NULL, '
                   'CHECK ((direct_message_id IS NULL AND (row_id IS NOT NULL OR input_receipt_id IS NOT NULL)) '
                   "OR (direct_message_id IS NOT NULL AND row_id IS NULL AND input_receipt_id IS NULL AND role='assistant')))" )
        db.execute('INSERT INTO message_refs SELECT seq,thread_id,turn_id,session_id,row_id,'
                   'input_receipt_id,direct_message_id,role FROM retired_refs')
        db.execute('DROP TABLE retired_refs')
        db.execute('CREATE INDEX refs_page ON message_refs(thread_id,seq)')
        db.execute("CREATE TRIGGER published_ref AFTER INSERT ON message_refs BEGIN "
                   "INSERT INTO sync_events(kind,thread_id,ref,version) "
                   "VALUES ('message',NEW.thread_id,CAST(NEW.seq AS TEXT),1); END")
    cold = Store(store.path)
    assert cold.sync_page()['events'] == prior_events
    assert cold.sync_page(cursor=cursor)['events'] == prior_events[1:]
    assert cold.history_page(thread,source,latest=True,limit=1)['messages'][0]['id'] == direct
    summary = next(t for t in cold.snapshot()['threads'] if t['id'] == thread)
    assert summary['read_ref'] == 1
    with cold._connect() as db:
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
        ref = db.execute('SELECT direct_message_id,system_notice_id FROM message_refs WHERE seq=2').fetchone()
        assert (ref['direct_message_id'],ref['system_notice_id']) == (direct,None)
