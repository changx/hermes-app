#!/usr/bin/env python3
"""Run the disposable API through Hermes' real dashboard plugin importer + TestClient.

No network listener, live profile, paid calls, core patching or persistent state.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SOURCE = Path('/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline')
OUTPUT = Path(__file__).with_name('evidence.json')
PLUGIN = Path(__file__).with_name('plugin_api.py')
NAME = 'p0-history-probe'


def setup_env(root: Path) -> None:
    os.environ['HOME'] = str(root)
    os.environ['HERMES_HOME'] = str(root / 'hermes-home')
    os.environ['HERMES_TEST_ISOLATION'] = '1'
    os.environ['P0_STATE_DB'] = str(root / 'state.db')
    os.environ['P0_PROJECT_DB'] = str(root / 'projects.db')
    os.environ['P0_ROOM_DB'] = str(root / 'rooms.db')
    os.environ['P0_META_DB'] = str(root / 'reads.db')
    os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
    sys.path.insert(0, str(SOURCE))


def client():
    from fastapi.testclient import TestClient
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    assert any(r.path == f'/api/plugins/{NAME}/channels' for r in app.routes), 'plugin not mounted'
    return TestClient(app, raise_server_exceptions=False, base_url='http://127.0.0.1',
                      headers={_SESSION_HEADER_NAME: _SESSION_TOKEN})


def good(response):
    assert response.status_code == 200, (response.status_code, response.text[:500])
    return response.json()


def run(root: Path, worker: bool = False) -> dict:
    setup_env(root)
    if worker:
        with client() as c:
            page = good(c.get(f'/api/plugins/{NAME}/events/thread-A', params={'since_seq': 0, 'limit': 20}))
            read = good(c.get(f'/api/plugins/{NAME}/read/thread-A/synthetic-user'))
            return {'new_process_events': [e['event_id'] for e in page['events']],
                    'new_process_read_cursor': read['cursor']}

    from agent.context_compressor import SUMMARY_PREFIX
    from hermes_state import SessionDB
    from gateway import hosted_rooms, hosted_room_driver
    from hermes_cli import projects_db
    from tui_gateway.server import _history_to_messages

    home = Path(os.environ['HERMES_HOME'])
    manifest = home / 'plugins' / NAME / 'dashboard'
    manifest.mkdir(parents=True)
    shutil.copyfile(PLUGIN, manifest / 'plugin_api.py')
    (manifest / 'manifest.json').write_text(json.dumps({'name': NAME, 'api': 'plugin_api.py'}))
    (home / 'config.yaml').write_text(f'plugins:\n  enabled: [{NAME}]\n')

    state = Path(os.environ['P0_STATE_DB'])
    db = SessionDB(db_path=state)
    db.create_session('root-A', source='desktop')
    db.append_message('root-A', 'user', 'synthetic-original-A')
    db.append_message('root-A', 'assistant', 'synthetic-answer-A')
    db.append_message('root-A', 'user', 'private-model-note', display_kind='hidden')
    db.end_session('root-A', 'compression')
    db.create_session('child-A', source='desktop', parent_session_id='root-A')
    db.append_message('child-A', 'user', SUMMARY_PREFIX + '\nsynthetic summary', _compressed_summary=True)
    db.append_message('child-A', 'assistant', 'synthetic-later-A')
    db.create_session('branch-A', source='desktop', parent_session_id='root-A',
                      model_config={'_branched_from': 'root-A'})
    db.append_message('branch-A', 'user', 'synthetic-branch-only')
    db.close()

    rooms = Path(os.environ['P0_ROOM_DB'])
    hosted_rooms.create_room(rooms, room_id='thread-A', name='synthetic-thread-A',
                             members=[], authority_gateway_id='synthetic-owner')
    checks = []

    def check(name, condition, **observed):
        checks.append({'name': name, 'passed': bool(condition), 'observed': observed})
        assert condition, (name, observed)

    with client() as c:
        base = f'/api/plugins/{NAME}'
        denied = c.get(base + '/channels', headers={'X-Hermes-Session-Token': 'wrong'})
        check('host_auth_rejects_wrong_token', denied.status_code == 401, status=denied.status_code)
        channel = good(c.post(base + '/channels', json={'name': 'Channel A', 'description': 'synthetic context'}))
        edited = good(c.patch(base + '/channels/' + channel['id'], json={
            'name': 'Channel renamed', 'description': 'synthetic updated context'}))
        listed = good(c.get(base + '/channels'))
        check('mounted_plugin_project_crud', len(listed) == 1 and edited['id'] == channel['id']
              and listed[0]['description'] == 'synthetic updated context')
        archived = good(c.post(base + '/channels/' + channel['id'] + '/archive'))
        hidden = good(c.get(base + '/channels'))
        all_channels = good(c.get(base + '/channels', params={'include_archived': 'true'}))
        check('project_archive_list', archived['archived'] and not hidden
              and all_channels[0]['archived'] is True)
        history = good(c.get(base + '/history/root-A'))
        texts = [x['text'] for x in history['visible']]
        check('mounted_plugin_history_projection', history['tip'] == 'child-A'
              and texts == ['synthetic-original-A', 'synthetic-answer-A', 'synthetic-later-A'],
              visible=texts)
        check('no_branch_summary_or_scaffolding', not any('summary' in t or 'branch' in t or 'private' in t for t in texts))
        first = good(c.post(base + '/send/thread-A', json={'send_id': 'send-1', 'text': 'same text'}))
        repeated = good(c.post(base + '/send/thread-A', json={'send_id': 'send-1', 'text': 'same text'}))
        conflict = c.post(base + '/send/thread-A', json={'send_id': 'send-1', 'text': 'changed text'})
        second = good(c.post(base + '/send/thread-A', json={'send_id': 'send-2', 'text': 'same text'}))
        check('mounted_plugin_receipt_retry_and_new_send', repeated['idempotent'] and first['seq'] == repeated['seq']
              and second['seq'] > first['seq'] and conflict.status_code == 409,
              first_seq=first['seq'], second_seq=second['seq'], conflict_status=conflict.status_code)
        page1 = good(c.get(base + '/events/thread-A', params={'since_seq': 0, 'limit': 1}))
        page2 = good(c.get(base + '/events/thread-A', params={'since_seq': page1['cursor'], 'limit': 1}))
        check('mounted_plugin_cursor_pages', page1['has_more'] and not page2['has_more']
              and [e['seq'] for e in page1['events'] + page2['events']] == [1, 2])
        snapshot = good(c.get(base + '/events/thread-A', params={'since_seq': 0, 'limit': 20}))
        third = good(c.post(base + '/send/thread-A', json={'send_id': 'send-3', 'text': 'after snapshot'}))
        delta = good(c.get(base + '/events/thread-A', params={'since_seq': snapshot['cursor'], 'limit': 20}))
        check('snapshot_then_delta_has_no_gap', snapshot['cursor'] == 2 and third['seq'] == 3
              and [e['seq'] for e in delta['events']] == [3], snapshot_cursor=snapshot['cursor'])
        future = c.get(base + '/events/thread-A', params={'since_seq': 999})
        check('future_cursor_rejected', future.status_code == 400, status=future.status_code)
        marked = good(c.post(base + '/read/thread-A/synthetic-user', json={'cursor': 2}))
        backwards = good(c.post(base + '/read/thread-A/synthetic-user', json={'cursor': 1}))
        good(c.post(base + '/read/root-A/synthetic-user', json={'cursor': 2}))
        check('plugin_metadata_monotonic_read', marked['cursor'] == backwards['cursor'] == 2)
        # Same dashboard admin token can name any user; no client-principal ACL exists in this spike.
        other = good(c.get(base + '/read/thread-A/synthetic-user'))
        check('no_per_user_auth_in_demo', other['cursor'] == 2)
        (home / 'config.yaml').write_text(f'plugins:\n  enabled: [{NAME}]\n  disabled: [{NAME}]\n')
        blocked = c.get(base + '/channels')
        check('runtime_disable_gates_plugin', blocked.status_code == 404, status=blocked.status_code)
        (home / 'config.yaml').write_text(f'plugins:\n  enabled: [{NAME}]\n')

    # A committed room event with NO admission has no driver task: cannot acknowledge execution atomically.
    initial_tasks = hosted_room_driver.list_tasks(rooms, room_id='thread-A')
    check('event_admission_gap_reproduced', initial_tasks == [], admitted_tasks=len(initial_tasks))
    identity = hosted_room_driver.TaskIdentity('thread-A', 'send-1', 'thread-A', 'turn-1')
    task = hosted_room_driver.admit_task(rooms, identity, payload={
        'target_profile': 'synthetic', 'prompt': 'same text', 'source_event_seq': first['seq']}, clock=lambda: 100.0)
    retry = hosted_room_driver.admit_task(rooms, identity, payload={
        'target_profile': 'synthetic', 'prompt': 'same text', 'source_event_seq': first['seq']}, clock=lambda: 101.0)
    check('raw_driver_admission_is_idempotent_not_atomic_with_event', task['status'] == 'queued'
          and retry['idempotent'] and len(hosted_room_driver.list_tasks(rooms, room_id='thread-A')) == 1)
    worker_process = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), '--worker', str(root)],
        capture_output=True, text=True, check=True, timeout=80, env=dict(os.environ))
    worker_result = json.loads((root / 'worker-result.json').read_text())
    check('cold_process_plugin_event_and_receipt_read', len(worker_result['new_process_events']) == 3
          and worker_result['new_process_read_cursor'] == 2, **worker_result)
    # Existing indexed search is broad/session-oriented, not a Thread-ACL/visible-only API.
    with SessionDB(db_path=state, read_only=True) as search_db:
        search_hits = search_db.search_messages('synthetic-original-A', role_filter=['user'], limit=10)
    check('core_search_primitive_reachable_not_thread_scoped',
          any(hit.get('session_id') == 'root-A' for hit in search_hits), hits=len(search_hits))
    # Core deletion is not hooked to plugin metadata: prove stale cursor remains after deleting source session.
    with SessionDB(db_path=state) as reopened:
        check('core_root_deleted', reopened.delete_session('root-A') and reopened.get_session('root-A') is None)
    with client() as c:
        surviving = good(c.get(f'/api/plugins/{NAME}/read/root-A/synthetic-user'))
    check('deletion_does_not_cascade_plugin_metadata', surviving['cursor'] == 2)
    with projects_db.connect_closing(Path(os.environ['P0_PROJECT_DB'])) as conn:
        check('project_description_persists_separately',
              projects_db.get_project(conn, channel['id']).description == 'synthetic updated context')
    return {'hermes_revision': subprocess.check_output(['git','-C',str(SOURCE),'rev-parse','HEAD'], text=True).strip(),
            'probe': 'dashboard_loaded_history_domain_sync', 'synthetic_data': True,
            'network_listener': False, 'model_calls': 0, 'checks': checks,
            'passed': sum(c['passed'] for c in checks), 'total': len(checks),
            'limitations': ['dashboard plugin route is not a gateway platform/hosted-room RPC',
                            'room and driver imports are internal APIs, not documented extension contracts',
                            'history route fully materializes lineage; no bounded cross-lineage paging or stable logical IDs',
                            'event and execution admission are separate commits, not atomic',
                            'read metadata prototype has no user ACL, project link, deletion hook or production schema']}


if __name__ == '__main__':
    assert SOURCE.is_dir() and Path(os.environ['TMPDIR']).is_dir()
    assert subprocess.check_output(['git', '-C', str(SOURCE), 'rev-parse', 'HEAD'], text=True).strip() == '2f16a1aa5a35feec496949abdef7ad51aea0e7ef'
    if len(sys.argv) == 3 and sys.argv[1] == '--worker':
        root = Path(sys.argv[2])
        (root / 'worker-result.json').write_text(json.dumps(run(root, worker=True)))
    else:
        with tempfile.TemporaryDirectory(prefix='p0-plugin-history-', dir=os.environ['TMPDIR']) as temporary:
            result = run(Path(temporary))
        result['temporary_directory_removed'] = not Path(temporary).exists()
        OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        print(f"PASS {result['passed']}/{result['total']} plugin-history checks; evidence={OUTPUT}")
