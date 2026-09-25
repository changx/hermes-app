"""Hermes App local foundation transport for the pinned 2f16a1aa baseline.

Only this module crosses the Hermes gateway/session compatibility boundary.
The transport owns no transcript; Hermes Project and SessionDB stay authoritative.
"""
import asyncio
import hmac
import os
import uuid
from pathlib import Path

from aiohttp import web, WSMsgType
from gateway.config import Platform
from gateway.platforms.base import BasePlatformAdapter, SendResult
from gateway.platforms.event import MessageEvent
from hermes_constants import get_hermes_home
from hermes_cli import projects_db

from .storage import Store, HistoryPending, MissingOriginal
from .history_hooks import pre_llm_call, post_llm_call


def _store():
    return Store(get_hermes_home() / 'hermes-app' / 'metadata.sqlite')


def _initial_description(info):
    session_id = str(info.get('session_id') or '')
    return _store().take_initial_description(session_id) if session_id else ''


@web.middleware
async def _authentication(request, handler):
    token = os.environ.get('HERMES_APP_TOKEN', '')
    provided = request.headers.get('Authorization', '')
    if not token or len(token) < 32 or not hmac.compare_digest(provided, 'Bearer ' + token):
        raise web.HTTPUnauthorized()
    if any(k in request.query for k in ('profile', 'profile_name', 'owner', 'user_id', 'hermes_home')):
        raise web.HTTPForbidden(text='profile selection is unavailable')
    return await handler(request)


async def _body(request):
    if request.content_length is not None and request.content_length > 65536:
        raise web.HTTPRequestEntityTooLarge(max_size=65536, actual_size=request.content_length)
    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError):
        raise web.HTTPBadRequest(text='JSON object required')
    if not isinstance(body, dict):
        raise web.HTTPBadRequest(text='JSON object required')
    if any(k in body for k in ('profile', 'profile_name', 'owner', 'user_id', 'hermes_home')):
        raise web.HTTPForbidden(text='profile selection is unavailable')
    return body


class HermesAppAdapter(BasePlatformAdapter):
    def __init__(self, config):
        super().__init__(config, Platform('hermes_app'))
        self._runner = None
        self._site = None
        self._sockets = set()
        self._store = _store()
        self.port = None

    def _source(self, project_id, thread_id):
        return self.build_source(chat_id=project_id, chat_type='thread', user_id='owner',
                                 thread_id=thread_id, parent_chat_id=project_id)

    async def connect(self, *, is_reconnect=False):
        if self._runner is not None:
            return True
        if len(os.environ.get('HERMES_APP_TOKEN', '')) < 32:
            raise RuntimeError('HERMES_APP_TOKEN must contain at least 32 characters')
        if os.environ.get('HERMES_APP_ALLOWED_USERS') != 'owner':
            raise RuntimeError('HERMES_APP_ALLOWED_USERS must be exactly owner')
        host = os.environ.get('HERMES_APP_HOST', '127.0.0.1')
        if host not in ('127.0.0.1', '::1'):
            raise RuntimeError('P1 foundation permits loopback binding only')
        port = int(os.environ.get('HERMES_APP_PORT', '0'))
        app = web.Application(middlewares=[_authentication], client_max_size=65536)
        app['adapter'] = self
        app.router.add_get('/v1/capabilities', self._capabilities)
        app.router.add_get('/v1/channels', self._channels)
        app.router.add_post('/v1/channels', self._channels)
        app.router.add_patch('/v1/channels/{id}', self._channel)
        app.router.add_delete('/v1/channels/{id}', self._channel)
        app.router.add_get('/v1/channels/{id}/threads', self._threads)
        app.router.add_post('/v1/channels/{id}/threads', self._threads)
        app.router.add_get('/v1/threads/{id}', self._thread)
        app.router.add_patch('/v1/threads/{id}', self._thread)
        app.router.add_delete('/v1/threads/{id}', self._thread)
        app.router.add_post('/v1/threads/{id}/messages', self._submit)
        app.router.add_get('/v1/threads/{id}/messages', self._history)
        app.router.add_get('/v1/events', self._ws)
        self._runner = web.AppRunner(app, access_log=None)
        try:
            await self._runner.setup()
            self._site = web.TCPSite(self._runner, host, port)
            await self._site.start()
            self.port = self._site._server.sockets[0].getsockname()[1]
        except BaseException:
            await self._runner.cleanup()
            self._runner = None
            self._site = None
            raise
        self._mark_connected()
        return True

    async def disconnect(self):
        for ws in tuple(self._sockets):
            await ws.close(code=1001, message=b'plugin stopping')
        self._sockets.clear()
        if self._runner is not None:
            await self._runner.cleanup()
            self._runner = None
            self._site = None
        self.port = None
        self._mark_disconnected()

    async def get_chat_info(self, chat_id):
        return {'name': chat_id, 'type': 'thread'}

    async def send(self, chat_id, content, reply_to=None, metadata=None):
        # P1-03 will provide durable fanout. The core persists the assistant row.
        return SendResult(success=True, message_id=uuid.uuid4().hex)

    async def _capabilities(self, request):
        return web.json_response({'protocol': 1, 'baseline': '2f16a1aa5a35feec496949abdef7ad51aea0e7ef',
            'owner': 'single', 'channels': True, 'threads': True,
            'execution_ingress': 'volatile_dispatched', 'durable_accept': False,
            'history': True, 'durable_sync': False, 'attachments': False, 'approvals': False})

    async def _channels(self, request):
        def operation():
            with projects_db.connect_closing() as conn:
                if request.method == 'GET':
                    return [p.to_dict() for p in projects_db.list_projects(conn, include_archived=True)]
                return None
        if request.method == 'GET':
            return web.json_response({'channels': await asyncio.to_thread(operation)})
        body = await _body(request)
        name = body.get('name')
        if not isinstance(name, str) or not name.strip():
            raise web.HTTPBadRequest(text='name required')
        description = body.get('description', '')
        if not isinstance(description, str) or len(description) > 4000:
            raise web.HTTPBadRequest(text='invalid description')
        def create():
            with projects_db.connect_closing() as conn:
                pid = projects_db.create_project(conn, name=name, description=description)
                return projects_db.get_project(conn, pid).to_dict()
        return web.json_response({'channel': await asyncio.to_thread(create)}, status=201)

    async def _channel(self, request):
        cid = request.match_info['id']
        body = await _body(request) if request.method == 'PATCH' else {}
        def operation():
            with projects_db.connect_closing() as conn:
                existing = projects_db.get_project(conn, cid)
                if existing is None or existing.id != cid:
                    return None
                if request.method == 'DELETE':
                    if self._store.list_threads(cid):
                        return 'has_threads'
                    projects_db.delete_project(conn, cid)
                    return {'deleted': True}
                name, description = body.get('name'), body.get('description')
                if name is not None and (not isinstance(name, str) or not name.strip()):
                    raise ValueError('invalid name')
                if description is not None and (not isinstance(description, str) or len(description) > 4000):
                    raise ValueError('invalid description')
                projects_db.update_project(conn, cid, name=name, description=description)
                return {'channel': projects_db.get_project(conn, cid).to_dict()}
        try:
            result = await asyncio.to_thread(operation)
        except ValueError as exc:
            raise web.HTTPBadRequest(text=str(exc)) from exc
        if result is None:
            raise web.HTTPNotFound()
        if result == 'has_threads':
            raise web.HTTPConflict(text='channel has threads')
        return web.json_response(result)

    async def _threads(self, request):
        cid = request.match_info['id']
        def project():
            with projects_db.connect_closing() as conn:
                return projects_db.get_project(conn, cid)
        p = await asyncio.to_thread(project)
        if p is None or p.id != cid:
            raise web.HTTPNotFound()
        if request.method == 'GET':
            return web.json_response({'threads': await asyncio.to_thread(self._store.list_threads, cid)})
        body = await _body(request)
        title = body.get('title', 'New Thread')
        if not isinstance(title, str) or not title.strip() or len(title) > 200:
            raise web.HTTPBadRequest(text='invalid title')
        # SessionStore is the gateway's actual routing authority. This is the
        # only private baseline call; it is checked in the runner integration test.
        thread_id = 'th_' + uuid.uuid4().hex[:24]
        source = self._source(cid, thread_id)
        entry = await asyncio.to_thread(self._session_store.get_or_create_session, source, touch_activity=False)
        actual = self._store.create_thread(cid, title.strip(), entry.session_id, p.description or '',
                                           thread_id=thread_id)
        return web.json_response({'thread': self._store.get_thread(actual)}, status=201)

    async def _thread(self, request):
        tid = request.match_info['id']
        if request.method == 'GET':
            result = self._store.get_thread(tid)
            if result is None:
                raise web.HTTPNotFound()
            return web.json_response({'thread': result})
        body = await _body(request) if request.method == 'PATCH' else {}
        try:
            result = await asyncio.to_thread(self._store.update_thread, tid,
                title=body.get('title'), archived=True if request.method == 'DELETE' else body.get('archived'))
        except ValueError as exc:
            raise web.HTTPBadRequest(text=str(exc)) from exc
        if result is None:
            raise web.HTTPNotFound()
        return web.json_response({'thread': result})

    async def _submit(self, request):
        tid = request.match_info['id']
        thread = self._store.get_thread(tid)
        if thread is None or thread['archived']:
            raise web.HTTPNotFound()
        body = await _body(request)
        content = body.get('text')
        if not isinstance(content, str) or not content.strip() or len(content) > 16000:
            raise web.HTTPBadRequest(text='invalid text')
        source = self._source(thread['project_id'], tid)
        event = MessageEvent(text=content, source=source, message_id=uuid.uuid4().hex)
        ingress_id = 'ingress:' + event.message_id
        try:
            self._store.begin_turn(tid, ingress_id)
        except HistoryPending as exc:
            raise web.HTTPConflict(text=str(exc)) from exc
        try:
            await self.handle_message(event)
        except BaseException:
            self._store.reject_turn(ingress_id)
            raise
        if not event._gateway_accepted:
            self._store.reject_turn(ingress_id)
            raise web.HTTPConflict(text='gateway did not dispatch')
        return web.json_response({'status': 'dispatched_volatile', 'durable': False}, status=202)

    async def _history(self, request):
        tid = request.match_info['id']
        if self._store.get_thread(tid) is None:
            raise web.HTTPNotFound()
        try:
            limit = int(request.query.get('limit', '50'))
            result = await asyncio.to_thread(self._store.history_page, tid,
                get_hermes_home() / 'state.db', limit=limit, after=request.query.get('after'))
        except (ValueError, TypeError) as exc:
            raise web.HTTPBadRequest(text=str(exc)) from exc
        except HistoryPending as exc:
            raise web.HTTPConflict(text=str(exc)) from exc
        except MissingOriginal as exc:
            raise web.HTTPConflict(text=str(exc)) from exc
        return web.json_response(result)

    async def _ws(self, request):
        ws = web.WebSocketResponse(heartbeat=30)
        await ws.prepare(request)
        self._sockets.add(ws)
        try:
            await ws.send_json({'type': 'hello', 'protocol': 1, 'durable_sync': False})
            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    if msg.data == 'ping':
                        await ws.send_str('pong')
                    else:
                        await ws.send_json({'type': 'error', 'code': 'unsupported'})
        finally:
            self._sockets.discard(ws)
        return ws


def register(ctx):
    ctx.register_system_prompt_section('hermes_app.channel', _initial_description, max_chars=4000)
    ctx.register_hook('pre_llm_call', pre_llm_call)
    ctx.register_hook('post_llm_call', post_llm_call)
    ctx.register_platform(name='hermes_app', label='Hermes App local foundation',
        adapter_factory=HermesAppAdapter, check_fn=lambda: True,
        validate_config=lambda cfg: bool(cfg.enabled),
        required_env=['HERMES_APP_TOKEN', 'HERMES_APP_ALLOWED_USERS'],
        allowed_users_env='HERMES_APP_ALLOWED_USERS')
