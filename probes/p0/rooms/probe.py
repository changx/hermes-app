#!/usr/bin/env python3
"""P0: exercise existing Hermes durable room storage, not an App implementation.

Uses synthetic messages and an explicit temporary DB. No Agent/model/network calls.
A fresh worker process proves reopen/idempotency do not rely on process memory.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--hermes-root', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--worker-db', type=Path)
    args = parser.parse_args()
    root = args.hermes_root.resolve()
    scratch = Path(os.environ['TMPDIR']).resolve()
    safe_env = {key: os.environ[key] for key in ('PATH', 'TMPDIR', 'LANG', 'TZ') if key in os.environ}
    os.environ.clear()
    os.environ.update(safe_env)
    with tempfile.TemporaryDirectory(prefix='hermes-app-p0-rooms-', dir=scratch) as temporary:
        os.environ['HOME'] = temporary
        os.environ['HERMES_HOME'] = str(Path(temporary) / 'home')
        os.environ['HERMES_TEST_ISOLATION'] = '1'
        os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
        sys.path.insert(0, str(root))
        rooms = importlib.import_module('gateway.hosted_rooms')

        room_id = 'p0-synthetic-thread'
        user = {'kind': 'user', 'id': 'synthetic-user'}

        def append(db: Path, event_id: str, text: str):
            return rooms.append_event(
                db, room_id=room_id, event_id=event_id, kind='message.user',
                actor=user, payload={'text': text}, authority_gateway_id='p0-owner',
                authority_epoch=1,
            )

        if args.worker_db:
            # Parent supplies a task-owned synthetic DB, never a live Hermes store.
            if not args.worker_db.resolve().is_relative_to(scratch):
                raise ValueError('worker DB must be under TMPDIR')
            before = rooms.read_events(args.worker_db, room_id=room_id, limit=500)
            replay = append(args.worker_db, 'send-1', 'synthetic first message')
            print(json.dumps({'pid': os.getpid(), 'page': before, 'replay': replay}))
            return

        db = Path(temporary) / 'synthetic-state.db'
        checks = []

        def check(name: str, condition: bool, **observed):
            checks.append({'name': name, 'passed': bool(condition), 'observed': observed})
            if not condition:
                raise AssertionError(name)

        created = rooms.create_room(
            db, room_id=room_id, name='P0 synthetic room',
            members=[{'profile': 'synthetic', 'handle': 'assistant'}],
            authority_gateway_id='p0-owner',
        )
        created_again = rooms.create_room(
            db, room_id=room_id, name='P0 synthetic room',
            members=[{'profile': 'synthetic', 'handle': 'assistant'}],
            authority_gateway_id='p0-owner',
        )
        check('room_creation_idempotent', created_again['idempotent'] is True)
        first = append(db, 'send-1', 'synthetic first message')
        repeated = append(db, 'send-1', 'synthetic first message')
        check('same_send_id_same_event', repeated['seq'] == first['seq'] and repeated['idempotent'], seq=first['seq'])
        conflict = False
        try:
            append(db, 'send-1', 'different content')
        except rooms.EventConflictError:
            conflict = True
        check('same_send_id_different_content_rejected', conflict)
        second = append(db, 'send-2', 'synthetic first message')
        check('new_send_same_text_remains_new', second['seq'] > first['seq'])
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: append(db, 'send-race', 'synthetic concurrent retry'), range(2)))
        check('concurrent_retry_one_event', len({r['seq'] for r in results}) == 1,
              returned_sequences=[r['seq'] for r in results])
        renamed = rooms.rename_room(db, room_id=room_id, event_id='rename-1', name='Renamed synthetic room')
        check('rename_and_replay_event_agree', renamed['name'] == renamed['event']['payload']['name'])
        expected = rooms.read_events(db, room_id=room_id, limit=500)
        pages, cursor = [], 0
        for _ in range(100):
            page = rooms.read_events(db, room_id=room_id, since_seq=cursor, limit=2)
            pages.extend(page['events'])
            cursor = page['cursor']
            if not page['has_more']:
                break
        else:
            raise AssertionError('pagination failed to terminate')
        ids = [event['event_id'] for event in pages]
        check('cursor_pagination_complete_and_unique', pages == expected['events'] and len(ids) == len(set(ids)),
              events=len(pages), cursor=cursor)
        child = subprocess.run(
            [sys.executable, str(Path(__file__).resolve()), '--hermes-root', str(root), '--worker-db', str(db)],
            env=dict(os.environ), text=True, capture_output=True, timeout=30, check=True,
        )
        reopened = json.loads(child.stdout)
        check('new_process_replay_and_send_dedupe', reopened['pid'] != os.getpid()
              and reopened['page'] == expected and reopened['replay']['seq'] == first['seq']
              and reopened['replay']['idempotent'], child_pid=reopened['pid'])
        ahead = False
        try:
            rooms.read_events(db, room_id=room_id, since_seq=cursor + 1)
        except rooms.HostedRoomError:
            ahead = True
        check('future_cursor_rejected', ahead)
        state = rooms.room_state(db, room_id=room_id)
        check('stable_room_identity', state['room_id'] == created['room_id'] and state['name'] == 'Renamed synthetic room')
        revision = subprocess.run(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True, capture_output=True, check=True).stdout.strip()
        report = {
            'probe': 'existing_hosted_rooms_storage', 'hermes_revision': revision,
            'execution': 'actual Hermes storage functions + real temporary SQLite + fresh Python process',
            'model_calls': 0, 'synthetic_data': True, 'checks': checks,
            'passed': sum(x['passed'] for x in checks), 'total': len(checks),
            'limits': [
                'No Agent execution, no full groups RPC or notification transport exercised by this probe.',
                'Room events are not a complete Channel/Thread product model.',
                'Read receipts, attachments, Description injection, indefinite history retention unverified.',
                'Storage event dedupe does not alone prove exactly-once external tool side effects.',
            ],
        }
    report['temporary_database_removed'] = not Path(temporary).exists()
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
