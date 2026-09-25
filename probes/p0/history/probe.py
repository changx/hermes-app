#!/usr/bin/env python3
"""P0 synthetic, no-model probe against the pinned Hermes source and a disposable SQLite DB.

Run with run.sh. No production database, real conversations or external model calls.
"""
from __future__ import annotations

import asyncio
import json
import os
import tempfile
from pathlib import Path
from types import SimpleNamespace

from agent.context_compressor import SUMMARY_PREFIX
from agent.turn_context import _should_idle_compact
from gateway.platforms.base import resolve_channel_prompt
from gateway.run_turn_runner import TurnRunner
from hermes_cli import projects_db
from hermes_state import SessionDB
from hermes_cli.web_routers import sessions as session_routes
from tui_gateway.server import _history_to_messages


def visible(rows):
    return [(m["role"], m["text"]) for m in _history_to_messages(rows) if m["role"] in ("user", "assistant")]


def run(root: Path) -> dict:
    db = SessionDB(db_path=root / "state.db")
    sid = "synthetic-root"
    db.create_session(sid, source="desktop")
    turns = [("user", "original question A"), ("assistant", "original answer A"),
             ("user", "original question B"), ("assistant", "original answer B")]
    ids = [db.append_message(sid, role, content) for role, content in turns[:2]]
    db.append_message(sid, "user", "private model instruction", display_kind="hidden")
    db.append_message(sid, "user", "[System: maintenance notice]")
    ids += [db.append_message(sid, role, content) for role, content in turns[2:]]
    pre = db.get_messages_as_conversation(sid, include_compacted=True, include_row_ids=True)
    assert visible(pre) == turns
    assert [m["row_id"] for m in _history_to_messages(pre) if m["role"] in ("user", "assistant")] == ids

    # A deterministic synthetic compression result is handed to the REAL SessionDB compaction writer;
    # this does not pretend to exercise a paid summarizer or autonomous checkpoint scheduler.
    watermark = db.get_active_message_watermark(sid)
    assert _should_idle_compact(enabled=True, idle_after_seconds=60, idle_gap_seconds=600,
                                tokens=5000, floor_tokens=1000, cooldown_active=False)
    assert not _should_idle_compact(enabled=True, idle_after_seconds=60, idle_gap_seconds=600,
                                    tokens=5000, floor_tokens=1000, cooldown_active=False,
                                    last_compaction_tokens=4500)
    original_rows = {m["id"]: m for m in db.get_messages(sid)}
    db.archive_and_compact(sid, [
        {"role": "assistant", "content": SUMMARY_PREFIX + "\nSynthetic summary of A/B", "_compressed_summary": True},
        *[{"role": role, "content": content, "timestamp": original_rows[ids[n]]["timestamp"]}
          for n, (role, content) in enumerate(turns[-2:], start=2)],
    ], tail_count=2, watermark=watermark)
    model, display = db.get_resume_conversations(sid)
    warm = db.get_messages_as_conversation(sid, include_ancestors=True, include_compacted=True,
                                           include_row_ids=True)
    paged = [m for offset in range(0, 20, 2)
             for m in db.get_messages(sid, include_compacted=True, limit=2, offset=offset)]
    assert visible(display) == turns == visible(warm) == visible(paged)
    assert len(paged) == len(db.get_messages(sid, include_compacted=True))
    assert turns[0][1] not in [m["content"] for m in model]
    assert any(SUMMARY_PREFIX in str(m.get("content")) for m in model)
    assert ids[:2] == [m["_row_id"] for m in display if m.get("content") in (turns[0][1], turns[1][1])]
    tail_ids = [m["_row_id"] for m in display if m.get("content") in (turns[2][1], turns[3][1])]
    assert tail_ids != ids[-2:]  # archived carry-forward rows get replacement ids
    # Model-facing but not display-facing scaffolding is visible only on raw model reads.
    assert not any(SUMMARY_PREFIX in text or "private model instruction" in text or "maintenance notice" in text
                   for _, text in visible(display))
    assert db.get_messages(sid, include_compacted=True, limit=2, offset=0)[0]["id"] == ids[0]
    db.close()
    db = SessionDB(db_path=root / "state.db")  # real close/reopen (same isolated file)
    reopened_model, reopened_display = db.get_resume_conversations(sid)
    assert visible(reopened_display) == turns == visible(db.get_messages(sid, include_compacted=True))
    assert [m["_row_id"] for m in reopened_display if m.get("content") in (turns[0][1], turns[1][1])] == ids[:2]
    assert len(reopened_model) == len(model)

    # A gateway-style compression continuation and an explicit sibling branch: only the
    # continuation joins the foreground display spine. This segment has no new user turn.
    db.end_session(sid, "compression")
    child, branch = "synthetic-continuation", "synthetic-branch"
    db.create_session(child, source="desktop", parent_session_id=sid)
    db.append_message(child, "user", SUMMARY_PREFIX + "\nSynthetic resumed context", _compressed_summary=True)
    post_id = db.append_message(child, "assistant", "post-split answer without new user")
    db.create_session(branch, source="desktop", parent_session_id=sid,
                      model_config={"_branched_from": sid})
    db.append_message(branch, "user", "branch-only input")
    assert db.get_compression_tip(sid) == child
    assert db.get_compression_chain(sid) == [sid, child]
    assert db.resolve_resume_session_id(sid) == child
    child_model, child_display = db.get_resume_conversations(child)
    expected = turns + [("assistant", "post-split answer without new user")]
    assert visible(child_display) == expected
    assert visible(db.get_messages_as_conversation(child, include_ancestors=True,
                                                    include_compacted=True)) == expected
    assert any(m.get("_row_id") == post_id for m in child_model), [
        (m.get("role"), m.get("_row_id")) for m in child_model]
    assert visible(db.get_resume_conversations(branch)[1]) == [("user", "branch-only input")]
    assert len(db.get_messages(child, include_compacted=True)) < len(child_display)
    db.close()
    db = SessionDB(db_path=root / "state.db")
    assert visible(db.get_resume_conversations(child)[1]) == expected
    assert db.get_compression_tip(sid) == child
    segments = len(db.get_compression_chain(sid))
    db.close()

    # Actual REST handler with its own read-only DB handle: the route follows the
    # resolved tip but its paginated SELECT is child-only, not lineage-merged.
    original_open = session_routes._open_session_db_for_profile
    original_profile = session_routes._cron_default_profile
    try:
        session_routes._open_session_db_for_profile = lambda profile, read_only=False: SessionDB(
            db_path=root / "state.db", read_only=read_only)
        session_routes._cron_default_profile = lambda: "isolated"
        response = asyncio.run(session_routes.get_session_messages(
            sid, limit=500, offset=0, order="oldest", include_compacted=True))
    finally:
        session_routes._open_session_db_for_profile = original_open
        session_routes._cron_default_profile = original_profile
    assert response["session_id"] == child
    assert response["pagination"]["returned"] == len(response["messages"])
    assert "original question A" not in [m["content"] for m in response["messages"]]
    assert "post-split answer without new user" in [m["content"] for m in response["messages"]]

    # Actual projects.db stores description; the gateway's actual resolver reads a
    # *different* channel_prompts map. Prove both the working config path and missing link.
    with projects_db.connect_closing(root / "projects.db") as conn:
        project_id = projects_db.create_project(conn, name="Synthetic project", description="Project context P")
        description = projects_db.get_project(conn, project_id).description
    with projects_db.connect_closing(root / "projects.db") as conn:
        assert projects_db.get_project(conn, project_id).description == description
    extra = {"channel_prompts": {"channel-P": description, "thread-override": "thread-specific"}}
    assert resolve_channel_prompt(extra, "thread-1", "channel-P") == description
    assert resolve_channel_prompt(extra, "thread-override", "channel-P") == "thread-specific"
    assert resolve_channel_prompt(extra, "thread-1", "channel-Q") is None
    assert resolve_channel_prompt({}, "thread-1", project_id) is None
    context = SimpleNamespace(channel_prompt=resolve_channel_prompt(extra, "thread-1", "channel-P"),
                              context_prompt="platform context", source=SimpleNamespace(
                                  platform="discord", chat_id="thread-1", thread_id="thread-1",
                                  parent_chat_id="channel-P", user_id="synthetic-user",
                                  user_id_alt=None, user_name=None, chat_name=None, chat_type=None),
                              AIAgent=lambda **kwargs: kwargs, user_config={}, enabled_toolsets=[],
                              disabled_toolsets=[], session_id="synthetic-session", session_key="synthetic-key")
    runner = SimpleNamespace(_get_system_prompt_for_channel=lambda *args, **kwargs: "policy context",
                             _prefill_messages=None, _service_tier=None, _session_db=None,
                             _refresh_fallback_model=lambda: None)
    combined = TurnRunner(runner, context)._combined_ephemeral_prompt()
    assert combined == "platform context\n\nProject context P\n\npolicy context"
    # Stub only the paid-model agent constructor. Exercise the real gateway's
    # constructor-argument assembly: the resolved prompt reaches the model context slot.
    captured = TurnRunner(runner, context)._build_fresh_agent(
        {"model": "synthetic-model", "runtime": {}}, "discord", combined, 1, None, {}, True)
    assert captured["ephemeral_system_prompt"] == combined
    absent_context = SimpleNamespace(**{**vars(context), "channel_prompt": resolve_channel_prompt({}, "thread-1", project_id)})
    assert description not in TurnRunner(runner, absent_context)._combined_ephemeral_prompt()
    return {
        "classification": "synthetic data; synthetic compression output; no paid model; real Hermes SessionDB, projections, idle predicate, gateway resolver/context combiner",
        "checks": {
            "original_visible_turns": len(turns), "cold_reopen_count": len(visible(reopened_display)),
            "after_rotation_visible_count": len(visible(child_display)),
            "display_page_count": len(paged), "in_place_model_rows": len(model),
            "in_place_display_rows": len(display), "lineage_segments": segments, "rest_tip_only_rows": response["pagination"]["returned"],
            "hidden_scaffolding_filtered": True, "idle_predicate_fires_and_growth_guard_blocks": True,
            "branch_excluded": True, "continuation_without_new_user_kept": True,
            "rest_ancestor_not_paged": True,
            "original_head_ids_preserved": True, "carried_tail_ids_changed": tail_ids != ids[-2:],
            "channel_config_parent_inheritance": True, "channel_override_precedence": True,
            "ephemeral_context_reaches_agent_constructor": True,
            "project_description_auto_inheritance": False,
        },
        "gaps": [
            "Compaction carry-forward tail gets new messages.id; a raw row_id is not a stable product message identity.",
            "REST /api/sessions/{id}/messages resolves to the tip then pages that segment; a compression ancestor's history is not in its page (unlike session.resume display).",
            "Project description persists in projects.db but is not an input to resolve_channel_prompt; no automatic Project Description -> model-context inheritance was demonstrated.",
            "No paid-model summarization, native Responses compaction, autonomous idle scheduler, live stream or multi-device sync tested.",
        ],
    }


if __name__ == "__main__":
    lane = Path(os.environ["P0_HISTORY_LANE"])
    with tempfile.TemporaryDirectory(prefix="history-probe-", dir=lane) as temp:
        result = run(Path(temp))
    path = Path(__file__).with_name("evidence.json")
    path.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("PASS P0 history probe " + json.dumps(result["checks"], sort_keys=True))
    print("Evidence: " + str(path))
