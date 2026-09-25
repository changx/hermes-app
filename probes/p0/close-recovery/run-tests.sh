#!/bin/sh
# Run only the selected upstream tests with a disposable synthetic HOME.
set -eu
BASE=/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline
SCRATCH=/home/hermes/.hermes/profiles/jamie/cache/scratch
OUT=/opt/projects/jamie/_worktrees/hermes-app/p0-close-recovery/probes/p0/close-recovery/upstream-tests.log
sandbox=$(mktemp -d "$SCRATCH/p0-close-tests-XXXXXX")
trap 'rm -rf "$sandbox"' EXIT INT TERM
cd "$BASE"
env -i PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR="$SCRATCH" \
 HOME="$sandbox" HERMES_HOME="$sandbox/hermes" HERMES_TEST_ISOLATION=1 \
 PYTHONPATH="$BASE" PYTHONDONTWRITEBYTECODE=1 TIRITH_ENABLED=false \
 "$BASE/.venv/bin/python" -m pytest -q -p no:cacheprovider \
 tests/tui_gateway/test_groups_methods.py::test_rpc_retry_is_idempotent_and_conflict_is_visible \
 tests/tui_gateway/test_hosted_room_service.py::test_restart_republishes_terminal_task_before_admitting_more \
 tests/tui_gateway/test_hosted_room_driver_runtime.py::test_expired_local_attempt_defers_without_hydrating_or_resubmitting \
 tests/tui_gateway/test_hosted_room_driver_runtime.py::test_pending_local_approval_is_reported_with_safe_choices \
 tests/tools/test_approval_gateway_wait_late_choice.py \
 tests/cron/test_delivery_queue.py::test_dead_delivery_owner_becomes_unknown_and_is_not_retried \
 tests/cron/test_delivery_queue.py::test_wait_timeout_leaves_unclaimed_delivery_queued_for_next_gateway \
 tests/cron/test_cron_live_delivery_confirmation.py::TestConfirmAdapterDelivery > "$OUT" 2>&1
