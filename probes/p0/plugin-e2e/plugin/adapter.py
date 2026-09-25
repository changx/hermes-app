"""Disposable loopback platform: real GatewayRunner wires its handler at startup.

Not a production transport: fixed synthetic identity, no authentication, no authorization
for arbitrary users, no network exposure beyond 127.0.0.1. Never bind publicly.
"""
import asyncio
import json
import os
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from gateway.config import Platform
from gateway.platforms.base import BasePlatformAdapter, SendResult, resolve_channel_prompt
from gateway.platforms.event import MessageEvent
from hermes_constants import get_hermes_home
from hermes_state import SessionDB


class ProbeAdapter(BasePlatformAdapter):
    def __init__(self, config):
        super().__init__(config, Platform('p0_e2e'))
        self.server = None
        self.delivered = []  # observation only; never authoritative history
        self.received_prompts = []  # diagnostic event snapshots, never authority

    async def connect(self, *, is_reconnect=False):
        self.server = await asyncio.start_server(self._http, '127.0.0.1', 0)
        self._mark_connected()
        return True

    @property
    def port(self):
        return self.server.sockets[0].getsockname()[1]

    async def disconnect(self):
        if self.server:
            self.server.close()
            await self.server.wait_closed()
            self.server = None
        self._mark_disconnected()

    async def get_chat_info(self, chat_id):
        return {'name': chat_id, 'type': 'thread'}

    async def send(self, chat_id, content, reply_to=None, metadata=None):
        self.delivered.append({'chat_id': chat_id, 'content': content})
        return SendResult(success=True, message_id=str(len(self.delivered)))

    def _source(self, thread):
        if thread not in ('one', 'two'):
            raise ValueError('unknown synthetic thread')
        parent = 'channel-A' if thread == 'one' else 'channel-B'
        return self.build_source(chat_id=parent, chat_type='thread', user_id='probe-user',
                                 thread_id=thread, parent_chat_id=parent)

    async def _http(self, reader, writer):
        try:
            line = await asyncio.wait_for(reader.readline(), 3)
            method, target, _ = line.decode('ascii').strip().split(' ', 2)
            headers = {}
            while True:
                line = await asyncio.wait_for(reader.readline(), 3)
                if line in (b'\r\n', b'\n'):
                    break
                k, v = line.decode('ascii').split(':', 1)
                headers[k.lower()] = v.strip()
            size = int(headers.get('content-length', '0'))
            if size > 4096 or size < 0:
                raise ValueError('invalid body size')
            payload = json.loads(await asyncio.wait_for(reader.readexactly(size), 3)) if size else {}
            if method == 'POST' and target == '/submit':
                thread = payload['thread']
                source = self._source(thread)
                text = payload['text']
                if not isinstance(text, str) or not text or len(text) > 1024:
                    raise ValueError('invalid text')
                event = MessageEvent(text=text, source=source, message_id=payload['id'])
                if os.environ.get('P0_E2E_MODE') == 'header':
                    # Probe-only metadata bridge: normal SessionStore routing, no core schema edits.
                    entry = self._session_store.get_or_create_session(source, touch_activity=False)
                    path = get_hermes_home() / 'p0-header-snapshots.json'
                    snapshots = json.loads(path.read_text()) if path.exists() else {}
                    if entry.session_id not in snapshots:
                        snapshots[entry.session_id] = resolve_channel_prompt(
                            self.config.extra, source.thread_id, source.parent_chat_id)
                        path.write_text(json.dumps(snapshots))
                    # Do NOT attach a per-message ephemeral prompt.
                else:
                    event.channel_prompt = resolve_channel_prompt(
                        self.config.extra, source.thread_id, source.parent_chat_id)
                self.received_prompts.append((text, event.channel_prompt))
                await self.handle_message(event)  # real BasePlatformAdapter -> runner callback
                body = {'accepted': event._gateway_accepted}
            elif method == 'GET' and urlsplit(target).path == '/history':
                thread = parse_qs(urlsplit(target).query)['thread'][0]
                source = self._source(thread)
                # SessionStore routing + SessionDB are Hermes-owned, not delivered[] cache.
                entry = await asyncio.to_thread(
                    self._session_store.get_or_create_session, source, touch_activity=False)
                def read():
                    db = SessionDB(db_path=get_hermes_home() / 'state.db', read_only=True)
                    try:
                        return db.get_messages(entry.session_id, include_compacted=True)
                    finally:
                        db.close()
                rows = await asyncio.to_thread(read)
                body = {'session_id': entry.session_id,
                        'messages': [{'role': r['role'], 'content': r['content']} for r in rows]}
            else:
                raise ValueError('unsupported route')
            data = json.dumps(body).encode()
            writer.write(b'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: '
                         + str(len(data)).encode() + b'\r\n\r\n' + data)
        except (ValueError, KeyError, TypeError, asyncio.TimeoutError, asyncio.IncompleteReadError) as exc:
            data = json.dumps({'error': str(exc)}).encode()
            writer.write(b'HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: '
                         + str(len(data)).encode() + b'\r\n\r\n' + data)
        finally:
            try:
                await asyncio.wait_for(writer.drain(), 2)
            finally:
                writer.close()
                await writer.wait_closed()


def render_header(info):
    home = get_hermes_home()
    snapshots = json.loads((home / 'p0-header-snapshots.json').read_text())
    session_id = info['session_id']
    with (home / 'p0-header-calls.jsonl').open('a') as stream:
        stream.write(json.dumps({'session_id': session_id}) + '\n')
    return snapshots.get(session_id, '')


def register(ctx):
    if os.environ.get('P0_E2E_MODE') == 'header':
        ctx.register_system_prompt_section('p0.channel', render_header, max_chars=1000)
    ctx.register_platform(name='p0_e2e', label='P0 Runner E2E Fixture',
                          adapter_factory=ProbeAdapter, check_fn=lambda: True,
                          allowed_users_env='P0_E2E_ALLOWED_USERS',
                          validate_config=lambda cfg: bool(cfg.enabled))
