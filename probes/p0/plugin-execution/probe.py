"""Bounded plugin-only P0 probe. All content/execution is synthetic, no model/tools."""
import asyncio
import contextvars
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent
BASE = Path('/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline')
assert str(BASE) in sys.path, 'Set PYTHONPATH to read-only Hermes baseline'


def event(adapter, text, thread='t1', parent='a', message_id='m'):
    from gateway.platforms.event import MessageEvent
    return MessageEvent(text=text, source=adapter.build_source(
        chat_id=parent, chat_type='thread', user_id='synthetic-user',
        thread_id=thread, parent_chat_id=parent, message_id=message_id), message_id=message_id)


async def adapter_checks(entry):
    from gateway.config import PlatformConfig
    cfg = PlatformConfig(enabled=True, typing_indicator=False, extra={
        'channel_prompts': {'a': 'Channel A description', 'b': 'Channel B description',
                            't2': 'Thread t2 override'}})
    adapter = entry.adapter_factory(cfg)
    assert await adapter.connect()
    observed = []
    gate = asyncio.Event()
    started = asyncio.Event()

    async def synthetic_gateway_handler(ev):
        observed.append((ev.text, ev.channel_prompt, ev.source.thread_id))
        if ev.text == 'slow':
            started.set()
            await gate.wait()
            return 'synthetic-final'
        if ev.text == 'fail':
            raise RuntimeError('synthetic failure')
        return 'synthetic-' + ev.text

    # GatewayRunner._wire_adapter_handlers installs exactly this callback in normal startup.
    # Here the callback is synthetic: this does not run AIAgent or prove real runner recovery.
    adapter.set_message_handler(synthetic_gateway_handler)
    accepted = await adapter.receive(event(adapter, 'slow', message_id='1'))
    assert accepted
    await asyncio.wait_for(started.wait(), 3)
    first_key = adapter._event_session_key(event(adapter, 'x'))
    assert first_key in adapter._session_tasks
    # Client disappeared. Adapter and server-owned turn remain alive.
    assert not adapter._session_tasks[first_key].done()
    queued = await adapter.receive(event(adapter, 'second', message_id='2'))
    assert queued and first_key in adapter._pending_messages
    gate.set()
    await asyncio.wait_for(_until(lambda: len(observed) == 2 and
                           any(d['content'] == 'synthetic-second' for d in adapter.delivered)), 5)
    assert observed[:2] == [('slow', 'Channel A description', 't1'),
                            ('second', 'Channel A description', 't1')]
    assert await adapter.receive(event(adapter, 'isolated', 't2', 'a', '3'))
    assert await adapter.receive(event(adapter, 'other', 't3', 'b', '4'))
    await asyncio.wait_for(_until(lambda: len(observed) == 4), 5)
    assert observed[2:] == [('isolated', 'Thread t2 override', 't2'),
                            ('other', 'Channel B description', 't3')]
    await asyncio.wait_for(_until(lambda: len(adapter.delivered) >= 4), 5)
    assert await adapter.receive(event(adapter, 'fail', 't4', 'b', '5'))
    await asyncio.wait_for(_until(lambda: len(observed) == 5 and
                           not any(not t.done() for t in adapter._background_tasks)), 5)
    # Error notification may be best effort; never claim it is a durable result.
    error_delivery = [d for d in adapter.delivered if 'error' in d['content'].lower()]
    # Explicit stop via supported adapter method, not task leakage.
    stop_gate = asyncio.Event()
    async def waiting(_ev):
        await stop_gate.wait()
    adapter.set_message_handler(waiting)
    assert await adapter.receive(event(adapter, 'stop-test', 'stop', 'a', '6'))
    stop_key = adapter._event_session_key(event(adapter, 'stop-test', 'stop'))
    await asyncio.wait_for(_until(lambda: stop_key in adapter._session_tasks), 3)
    await adapter.cancel_session_processing(stop_key)
    assert not any(not t.done() for t in adapter._background_tasks)
    await adapter.disconnect()
    return {'accepted': accepted, 'observed': observed, 'delivered': adapter.delivered,
            'queued_while_busy': queued, 'stop_reaped': True,
            'synthetic_error_delivery_count': len(error_delivery),
            'offline_owner': 'adapter task still running; no network client was implemented'}


async def _until(pred):
    while not pred():
        await asyncio.sleep(.01)


def prompts():
    from gateway.run_turn_runner import TurnRunner
    results = []
    for channel, desc in [('a', 'Channel A description'), ('a', 'Channel A description'),
                          ('b', 'Channel B description')]:
        ctx = SimpleNamespace(context_prompt='', channel_prompt=desc,
                              source=SimpleNamespace(platform='p0_execution', chat_id=channel,
                                                     thread_id='t1', parent_chat_id=channel))
        runner = SimpleNamespace(_get_system_prompt_for_channel=lambda *args, **kwargs: '')
        results.append(TurnRunner(runner, ctx)._combined_ephemeral_prompt())
    assert results == ['Channel A description', 'Channel A description', 'Channel B description']
    return {'first_second_fresh': results,
            'limitation': 'prompt assembly exercised, not a real model call/compaction or cached-agent invalidation'}


def approvals():
    from tools import approval
    from tools.approval_gateway_wait import _await_gateway_decision
    key = 'p0_execution:synthetic'
    published = threading.Event()
    got = {}
    def notify(data):
        got.update(data)
        published.set()
    outcome = {}
    worker = threading.Thread(target=contextvars.copy_context().run, args=(lambda: outcome.update(
        _await_gateway_decision(key, notify,
                                {'command': 'synthetic-no-exec', 'pattern_keys': ['synthetic']})),))
    worker.start()
    try:
        assert published.wait(3)
        pending = approval.list_gateway_approvals(key)
        assert len(pending) == 1 and pending[0]['request_id'] == got['request_id']
        first = approval.resolve_gateway_approval(key, 'once', request_id=got['request_id'])
        stale = approval.resolve_gateway_approval(key, 'deny', request_id=got['request_id'])
        worker.join(3)
        assert not worker.is_alive() and first == 1 and stale == 0
        assert outcome['choice'] == 'once' and not approval.list_gateway_approvals(key)
        return {'first': first, 'stale': stale, 'outcome': outcome,
                'pending_after': approval.list_gateway_approvals(key),
                'restart_restore': 'not proven: approval queue is process-local'}
    finally:
        approval.unregister_gateway_notify(key)
        if worker.is_alive():
            approval.withdraw_gateway_approval(key, got['request_id'], 'test cleanup')
            worker.join(3)
        assert not worker.is_alive()


def clarify():
    from tools import clarify_gateway as cg
    key = 'p0_execution:clarify'
    entry = cg.register('synthetic-clarify-1', key, 'synthetic?', ['yes', 'no'])
    assert cg.get_pending_for_session(key, include_choice_prompts=True) is entry
    first = cg.attempt_text_response_for_session(key, '1')
    stale = cg.resolve_gateway_clarify(entry.clarify_id, 'no')
    answer = cg.wait_for_response(entry.clarify_id, .05)
    assert first == cg.TEXT_RESOLVED and stale is False and answer == 'yes'
    expired = cg.register('synthetic-clarify-2', key, 'timeout?', ['yes'])
    assert cg.wait_for_response(expired.clarify_id, .01) is None
    assert cg.resolve_gateway_clarify(expired.clarify_id, 'yes') is False
    return {'first': first, 'stale': stale, 'answer': answer, 'expired_late': False,
            'restart_restore': 'not proven: queue is process-local'}


def cron_targets(entry):
    from cron.scheduler_delivery import _resolve_delivery_targets, _is_known_delivery_platform
    assert _is_known_delivery_platform(entry.name)
    job = {'id': 'synthetic-cron', 'deliver': 'origin',
           'origin': {'platform': entry.name, 'chat_id': 'a', 'thread_id': 't1'}}
    targets = _resolve_delivery_targets(job)
    assert len(targets) == 1 and targets[0]['chat_id'] == 'a' and targets[0]['thread_id'] == 't1'
    assert _resolve_delivery_targets({'deliver': 'local', 'origin': job['origin']}) == []
    return {'origin_targets': targets, 'local_targets': [],
            'limitation': 'target resolver only; no cron fire or push provider called'}


async def cron_live_send(entry):
    from cron.scheduler_delivery import _deliver_result
    from gateway.config import Platform, PlatformConfig
    adapter = entry.adapter_factory(PlatformConfig(enabled=True, typing_indicator=False))
    await adapter.connect()
    job = {'id': 'synthetic-cron-send', 'name': 'synthetic-cron-send',
           'deliver': 'origin', 'attach_to_session': False,
           'origin': {'platform': entry.name, 'chat_id': 'a', 'thread_id': 't1'}}
    loop = asyncio.get_running_loop()
    result = await asyncio.wait_for(asyncio.to_thread(
        _deliver_result, job, 'synthetic-cron-output', {Platform(entry.name): adapter}, loop), 8)
    await adapter.disconnect()
    assert result is None, result
    assert len(adapter.delivered) == 1 and adapter.delivered[0]['metadata']['thread_id'] == 't1'
    assert 'synthetic-cron-output' in adapter.delivered[0]['content']
    return {'error': result, 'delivered': adapter.delivered,
            'limitation': 'real cron delivery function to in-memory adapter; no scheduler fire, durable history, APNs/FCM'}


def crash_child(home):
    from hermes_cli.plugins import get_plugin_manager
    from gateway.platform_registry import platform_registry
    from hermes_constants import set_hermes_home_override
    from gateway.config import PlatformConfig
    set_hermes_home_override(home)
    manager = get_plugin_manager()
    manager.discover_and_load()
    adapter = platform_registry.create_adapter('p0_execution', PlatformConfig(enabled=True, typing_indicator=False))
    assert adapter is not None
    async def hanging(_):
        await asyncio.Event().wait()
    adapter.set_message_handler(hanging)
    async def start():
        await adapter.connect()
        assert await adapter.receive(event(adapter, 'synthetic-crash'))
        (home / 'accepted-marker').write_text('volatile adapter accepted, not a durable Hermes receipt', encoding='utf8')
        os._exit(73)  # deterministic crash, before turn/final; child owns no external resources
    asyncio.run(start())


def crash_boundary(home):
    run = subprocess.run([sys.executable, str(ROOT / 'probe.py'), '--crash', str(home)],
                         timeout=20, check=False, capture_output=True, text=True)
    assert run.returncode == 73 and (home / 'accepted-marker').exists(), (run.returncode, run.stderr)
    return {'child_exit': run.returncode, 'accepted_marker': True,
            'limitation': 'crashed synthetic adapter callback before model or tool; marker is probe-owned, '
                          'not durable Hermes turn admission; no automatic retry attempted'}


def main():
    from hermes_cli.plugins import get_plugin_manager
    from gateway.platform_registry import platform_registry
    from hermes_constants import set_hermes_home_override, reset_hermes_home_override
    from gateway.config import PlatformConfig
    with tempfile.TemporaryDirectory(prefix='p0-execution-', dir=os.environ['TMPDIR']) as temp:
        home = Path(temp) / 'hermes'
        plugdir = home / 'plugins' / 'p0-execution-platform'
        shutil.copytree(ROOT / 'plugin', plugdir)
        (home / 'config.yaml').write_text(
            'plugins:\n  enabled:\n    - p0-execution-platform\n'
            'gateway:\n  platforms:\n    p0_execution:\n      enabled: true\n', encoding='utf8')
        token = set_hermes_home_override(home)
        manager = get_plugin_manager()
        try:
            manager.discover_and_load()
            entry = platform_registry.get('p0_execution')
            assert entry and entry.plugin_name == 'p0-execution-platform'
            adapter = platform_registry.create_adapter('p0_execution', PlatformConfig(enabled=True))
            assert type(adapter).__name__ == 'ProbeAdapter'
            assert entry.cron_deliver_env_var == 'P0_EXECUTION_HOME_CHANNEL'
            approval_result = approvals()
            hook_events = sys.modules[entry.adapter_factory.__module__].approval_hook_events
            assert [item['phase'] for item in hook_events] == ['pre', 'post'], hook_events
            assert hook_events[1]['choice'] == 'once'
            approval_result['plugin_observer_hooks'] = list(hook_events)
            data = {'loader': {'name': entry.name, 'source': entry.source,
                               'cron_deliver_env_var': entry.cron_deliver_env_var},
                    'adapter': asyncio.run(adapter_checks(entry)),
                    'prompts': prompts(), 'approvals': approval_result, 'clarify': clarify(),
                    'cron': cron_targets(entry), 'cron_live_send': asyncio.run(cron_live_send(entry)),
                    'crash': crash_boundary(home)}
            manager.unload()
            assert platform_registry.get('p0_execution') is None
            data['loader']['unload_removed'] = True
            (home / 'config.yaml').write_text(
                'plugins:\n  enabled: []\n  disabled: [p0-execution-platform]\n', encoding='utf8')
            manager.discover_and_load(force=True)
            assert platform_registry.get('p0_execution') is None
            data['loader']['disabled_skipped'] = True
        finally:
            manager.unload()
            reset_hermes_home_override(token)
    out = ROOT / 'results.json'
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print('PASS E01 E02 E03 E05 E06-boundary; E04 not proven; results=' + str(out))


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--crash':
        crash_child(Path(sys.argv[2]))
    else:
        main()
