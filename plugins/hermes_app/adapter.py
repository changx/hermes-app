"""Hermes App local foundation transport for the pinned 2f16a1aa baseline.

Only this module crosses the Hermes gateway/session compatibility boundary.
The transport owns no transcript; Hermes Project and SessionDB stay authoritative.
"""
import asyncio
import hmac
import logging
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
from .history_hooks import pre_llm_call, post_tool_call, pre_auxiliary_call, post_llm_call, on_session_end

log = logging.getLogger(__name__)


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
        self._settlement_tasks = set()
        self._queue_tasks = {}
        self._queue_wakes = {}
        self._channel_refresh_lock = asyncio.Lock()
        self._events_changed = asyncio.Event()
        self._stopping = False
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
        self._gateway_starting()  # Fail explicitly if pinned startup ownership API changed.
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
        app.router.add_get('/v1/receipts/{id}', self._receipt)
        app.router.add_get('/v1/threads/{id}/messages', self._history)
        app.router.add_post('/v1/threads/{id}/read', self._read)
        app.router.add_get('/v1/sync', self._sync)
        app.router.add_get('/v1/snapshot', self._snapshot)
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
        self._stopping = False
        await self._refresh_channels()
        for thread_id in await asyncio.to_thread(self._store.recover_receipts,get_hermes_home()/'state.db'):
            self._wake_thread(thread_id)
        return True

    async def cancel_background_tasks(self):
        self._stopping = True
        for task in tuple(getattr(self, '_queue_tasks', {}).values()):
            task.cancel()
        if getattr(self, '_queue_tasks', None):
            await asyncio.gather(*tuple(self._queue_tasks.values()), return_exceptions=True)
            self._queue_tasks.clear()
        await super().cancel_background_tasks()
        # Core cancellation completes owner tasks, which in turn schedules their
        # reconciliation callbacks. Let those callbacks run before draining.
        await asyncio.sleep(0)
        await self._drain_settlements()

    async def _drain_settlements(self):
        while self._settlement_tasks:
            await asyncio.gather(*tuple(self._settlement_tasks), return_exceptions=True)

    async def disconnect(self):
        self._stopping = True
        if self._site is not None:
            await self._site.stop()
        # Direct disconnect also has to stop owners; GatewayRunner normally
        # invokes cancel_background_tasks before this method.
        await self.cancel_background_tasks()
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

    async def handle_message(self, event):
        # GatewayRunner's own startup resume calls this adapter with an empty
        # internal event. Plugin receipts own recovery for this platform only.
        if event.internal and not event.text and event.message_id is None:
            return
        return await super().handle_message(event)

    def _gateway_starting(self):
        # Pinned baseline boundary: run_adapters._standalone_scoped wraps a
        # bound GatewayRunner method. Its startup gate remains closed while
        # run_startup drains synthetic resume events. Dispatching before that
        # gate opens creates a short adapter task without a real model owner.
        for cell in getattr(self._message_handler,'__closure__',()) or ():
            target=getattr(cell.cell_contents,'__self__',None)
            if target is not None and hasattr(target,'_startup_restore_in_progress'):
                return bool(target._startup_restore_in_progress)
        raise RuntimeError('pinned GatewayRunner startup gate unavailable')

    async def _capabilities(self, request):
        return web.json_response({'protocol': 1, 'baseline': '2f16a1aa5a35feec496949abdef7ad51aea0e7ef',
            'owner': 'single', 'channels': True, 'threads': True,
            'execution_ingress': 'durable_fifo', 'durable_accept': True,
            'history': True, 'durable_sync': True, 'attachments': False, 'approvals': False})

    async def _channels(self, request):
        def operation():
            with projects_db.connect_closing() as conn:
                if request.method == 'GET':
                    return [p.to_dict() for p in projects_db.list_projects(conn, include_archived=True)]
                return None
        if request.method == 'GET':
            await self._refresh_channels()
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
        channel = await asyncio.to_thread(create)
        await self._refresh_channels()
        return web.json_response({'channel': channel}, status=201)

    async def _channel(self, request):
        cid = request.match_info['id']
        body = await _body(request) if request.method == 'PATCH' else {}
        def operation():
            with projects_db.connect_closing() as conn:
                existing = projects_db.get_project(conn, cid)
                if existing is None or existing.id != cid:
                    return None
                if request.method == 'DELETE':
                    if self._store.has_threads(cid):
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
        await self._refresh_channels()
        return web.json_response(result)

    async def _refresh_channels(self):
        # ProjectDB is authoritative. Reconciliation also repairs a crash in the
        # gap between its write and the plugin's change event.
        async with self._channel_refresh_lock:
            def refresh():
                with projects_db.connect_closing() as conn:
                    channels = [p.to_dict() for p in projects_db.list_projects(conn, include_archived=True)]
                return self._store.reconcile_channels(channels)
            if await asyncio.to_thread(refresh):
                self._events_changed.set()

    async def _threads(self, request):
        cid = request.match_info['id']
        def project():
            with projects_db.connect_closing() as conn:
                return projects_db.get_project(conn, cid)
        p = await asyncio.to_thread(project)
        if p is None or p.id != cid:
            raise web.HTTPNotFound()
        if request.method == 'GET':
            try:
                limit = int(request.query.get('limit', '50'))
                result = await asyncio.to_thread(self._store.list_threads, cid, limit=limit,
                                                 after=request.query.get('after'))
            except (ValueError, TypeError) as exc:
                raise web.HTTPBadRequest(text=str(exc)) from exc
            return web.json_response(result)
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
        if self._stopping:
            raise web.HTTPServiceUnavailable(text='adapter stopping')
        tid = request.match_info['id']
        body = await _body(request)
        content = body.get('text')
        client_id = body.get('client_message_id')
        if self._stopping:
            raise web.HTTPServiceUnavailable(text='adapter stopping')
        try:
            receipt, created = await asyncio.to_thread(self._store.accept, tid, client_id, content)
        except OverflowError as exc:
            raise web.HTTPTooManyRequests(text=str(exc)) from exc
        except ValueError as exc:
            if 'conflict' in str(exc):
                raise web.HTTPConflict(text=str(exc)) from exc
            if 'archived' in str(exc):
                raise web.HTTPConflict(text=str(exc)) from exc
            if 'unknown thread' in str(exc):
                raise web.HTTPNotFound() from exc
            raise web.HTTPBadRequest(text=str(exc)) from exc
        if created:
            self._events_changed.set()
            self._wake_thread(tid)
        return web.json_response({'receipt':receipt}, status=202)

    def _wake_thread(self, thread_id):
        self._queue_wakes[thread_id] = self._queue_wakes.get(thread_id, 0) + 1
        task = self._queue_tasks.get(thread_id)
        if task is None or task.done():
            task = asyncio.create_task(self._queue_loop(thread_id))
            self._queue_tasks[thread_id] = task
            def finished(done):
                if self._queue_tasks.get(thread_id) is done:
                    self._queue_tasks.pop(thread_id, None)
                    self._queue_wakes.pop(thread_id, None)
                if not done.cancelled() and done.exception() is not None:
                    log.error('Hermes App queue owner failed for %s', thread_id,
                              exc_info=done.exception())
            task.add_done_callback(finished)

    async def _queue_loop(self, thread_id):
        while not self._stopping:
            while self._gateway_starting():
                await asyncio.sleep(.05)
            generation = self._queue_wakes.get(thread_id, 0)
            claim = await asyncio.to_thread(self._store.claim_next, thread_id)
            if claim is None:
                if generation != self._queue_wakes.get(thread_id, 0):
                    continue
                return
            receipt_id, content = claim
            self._events_changed.set()
            thread = self._store.get_thread(thread_id)
            event = MessageEvent(text=content, source=self._source(thread['project_id'],thread_id),
                                 message_id=receipt_id)
            try:
                await self.handle_message(event)
                owner = self._session_tasks.get(self._event_session_key(event)) if event._gateway_accepted else None
                # Gateway startup restore may accept the event into its bounded
                # startup queue before the adapter owner task exists. Keep the
                # plugin receipt running until that exact owner appears.
                if event._gateway_accepted and owner is None:
                    for _ in range(3000):
                        if self._stopping:
                            raise asyncio.CancelledError()
                        await asyncio.sleep(.01)
                        owner=self._session_tasks.get(self._event_session_key(event))
                        if owner is not None:
                            break
                if owner is None:
                    raise RuntimeError('gateway did not start owner')
                while True:
                    linked=await asyncio.to_thread(self._store.link_user_from_core,receipt_id,
                                                   get_hermes_home()/'state.db')
                    if linked:
                        await asyncio.shield(owner)
                        break
                    try:
                        await asyncio.wait_for(asyncio.shield(owner),.1)
                        break
                    except asyncio.TimeoutError:
                        continue
                await self._settle_ingress(thread_id, 'ingress:'+receipt_id, receipt_id,
                                           owner_finished=True)
                state = self._store.turn_state('ingress:'+receipt_id)
                await asyncio.to_thread(self._store.finish_receipt, receipt_id,
                                         {'complete':'completed','failed':'failed',
                                          'interrupted':'interrupted'}.get(state,'unknown'))
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception('Hermes App queued execution failed: %s',receipt_id)
                await asyncio.to_thread(self._store.mark_ingress_unknown,thread_id,'ingress:'+receipt_id)
                await asyncio.to_thread(self._store.finish_receipt,receipt_id,'unknown')
            finally:
                self._events_changed.set()

    async def _receipt(self, request):
        receipt = await asyncio.to_thread(self._store.receipt, request.match_info['id'])
        if receipt is None:
            raise web.HTTPNotFound()
        return web.json_response({'receipt':receipt})

    async def _sync(self, request):
        try:
            await self._refresh_channels()
            limit = int(request.query.get('limit','100'))
            page = await asyncio.to_thread(self._store.sync_page,cursor=request.query.get('cursor'),limit=limit)
        except (ValueError,TypeError) as exc:
            raise web.HTTPBadRequest(text=str(exc)) from exc
        return web.json_response(page)

    async def _snapshot(self,request):
        try:
            await self._refresh_channels()
            limit=int(request.query.get('limit','50'))
            page=await asyncio.to_thread(self._store.snapshot,after=request.query.get('after'),limit=limit)
        except (ValueError,TypeError) as exc:
            raise web.HTTPBadRequest(text=str(exc)) from exc
        return web.json_response(page)

    async def _read(self, request):
        thread_id=request.match_info['id']
        if self._store.get_thread(thread_id) is None:
            raise web.HTTPNotFound()
        body=await _body(request)
        try:
            result=await asyncio.to_thread(self._store.read_thread,thread_id,body.get('ref_seq'))
        except ValueError as exc:
            raise web.HTTPBadRequest(text=str(exc)) from exc
        self._events_changed.set()
        return web.json_response(result)

    def _schedule_settlement(self, thread_id, ingress_id, platform_message_id):
        task = asyncio.create_task(self._settle_ingress(thread_id, ingress_id, platform_message_id))
        self._settlement_tasks.add(task)
        task.add_done_callback(self._settlement_tasks.discard)

    async def _settle_ingress(self, thread_id, ingress_id, platform_message_id, *, owner_finished=False):
        try:
            writer=asyncio.create_task(asyncio.to_thread(
                self._store.settle_ingress,thread_id,ingress_id,platform_message_id,
                get_hermes_home()/'state.db',owner_finished=owner_finished))
            try:
                await asyncio.shield(writer)
            except asyncio.CancelledError:
                await writer  # A plugin-owned DB writer must finish before shutdown.
                raise
        except Exception:
            log.exception('Hermes App ingress reconciliation failed: %s', ingress_id)
            await asyncio.to_thread(self._store.mark_ingress_unknown,thread_id,ingress_id)

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
        try:
            cursor=request.query.get('cursor')
            await asyncio.to_thread(self._store.sync_page,cursor=cursor,limit=1)
        except ValueError as exc:
            raise web.HTTPBadRequest(text=str(exc)) from exc
        ws = web.WebSocketResponse(heartbeat=30, max_msg_size=1024)
        await ws.prepare(request)
        self._sockets.add(ws)
        token=request.headers.get('Authorization','')
        try:
            await ws.send_json({'type':'hello','protocol':1,'durable_sync':True})
            while not ws.closed and not self._stopping:
                if not hmac.compare_digest(token,'Bearer '+os.environ.get('HERMES_APP_TOKEN','')):
                    await ws.close(code=1008,message=b'credential revoked')
                    break
                page=await asyncio.to_thread(self._store.sync_page,cursor=cursor,limit=100)
                if page['events']:
                    for event in page['events']:
                        transport=request.transport
                        if transport is None or transport.get_write_buffer_size()>1048576:
                            await ws.close(code=1013,message=b'replay via HTTP')
                            break
                        await asyncio.wait_for(ws.send_json({'type':'event',**event}),5)
                    if ws.closed:
                        break
                    cursor=page['next_cursor']
                    continue
                self._events_changed.clear()
                try:
                    msg=await asyncio.wait_for(ws.receive(),.25)
                    if msg.type==WSMsgType.TEXT and msg.data=='ping':
                        await ws.send_str('pong')
                    elif msg.type in (WSMsgType.CLOSE,WSMsgType.CLOSED,WSMsgType.ERROR):
                        break
                except asyncio.TimeoutError:
                    try:
                        await asyncio.wait_for(self._events_changed.wait(),5)
                    except asyncio.TimeoutError:
                        pass
        finally:
            self._sockets.discard(ws)
        return ws


def register(ctx):
    ctx.register_system_prompt_section('hermes_app.channel', _initial_description, max_chars=4000)
    ctx.register_hook('pre_llm_call', pre_llm_call)
    ctx.register_hook('post_tool_call', post_tool_call)
    ctx.register_hook('pre_auxiliary_call', pre_auxiliary_call)
    ctx.register_hook('post_llm_call', post_llm_call)
    ctx.register_hook('on_session_end', on_session_end)
    ctx.register_platform(name='hermes_app', label='Hermes App local foundation',
        adapter_factory=HermesAppAdapter, check_fn=lambda: True,
        validate_config=lambda cfg: bool(cfg.enabled),
        required_env=['HERMES_APP_TOKEN', 'HERMES_APP_ALLOWED_USERS'],
        allowed_users_env='HERMES_APP_ALLOWED_USERS')
