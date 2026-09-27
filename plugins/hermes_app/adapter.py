"""Hermes App local foundation transport for the pinned 2f16a1aa baseline.

Only this module crosses the Hermes gateway/session compatibility boundary.
The transport owns no transcript; Hermes Project and SessionDB stay authoritative.
"""
import asyncio
import hmac
import logging
import os
import mimetypes
import re
import stat
import uuid
from pathlib import Path
from urllib.parse import quote, unquote

from aiohttp import web, WSMsgType
from gateway.config import Platform
from gateway.platforms.base import BasePlatformAdapter, SendResult
from gateway.platforms.event import MessageEvent
from hermes_constants import get_hermes_home
from hermes_cli import projects_db

from .storage import Store, HistoryPending, MissingOriginal
from . import device_pairing
from .history_hooks import pre_llm_call, pre_tool_call, post_tool_call, pre_auxiliary_call, post_llm_call, on_session_end

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
    admin = bool(token and len(token) >= 32 and hmac.compare_digest(provided, 'Bearer ' + token))
    exchange = request.method == 'POST' and request.path == '/v1/pairing/exchange'
    if exchange:
        # The only public route accepts a bounded JSON body, never URL credentials.
        if provided or request.query:
            raise web.HTTPBadRequest(text='pairing code belongs in JSON body')
    elif request.path.startswith('/v1/pairing/'):
        if not admin:
            raise web.HTTPForbidden() if provided else web.HTTPUnauthorized()
    elif not admin:
        credential = provided[7:] if provided.startswith('Bearer ') else ''
        pairing = request.app.get('pairing')
        if not pairing or not await asyncio.to_thread(pairing.authenticated_device, credential):
            raise web.HTTPUnauthorized()
    request['auth_kind'] = 'public' if exchange else 'admin' if admin else 'device'
    if any(k in request.query for k in ('profile', 'profile_name', 'owner', 'user_id', 'hermes_home')):
        raise web.HTTPForbidden(text='profile selection is unavailable')
    return await handler(request)


async def _body(request):
    if request.content_length is not None and request.content_length > 65536:
        raise web.HTTPRequestEntityTooLarge(max_size=65536, actual_size=request.content_length)
    try:
        raw=await request.read()
        if len(raw)>65536:
            raise web.HTTPRequestEntityTooLarge(max_size=65536,actual_size=len(raw))
        import json
        body = json.loads(raw)
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
        self._pairing = device_pairing.PairingStore(self._store.path)
        self._settlement_tasks = set()
        self._queue_tasks = {}
        self._queue_wakes = {}
        self._followup_tasks = set()
        self._admission_tasks = set()
        self._ingress_locks = {}
        self._channel_refresh_lock = asyncio.Lock()
        self._events_changed = asyncio.Event()
        self._stopping = False
        self._generation = uuid.uuid4().hex
        self._active_receipts = {}
        self._session_threads = {}
        self._stop_receipts = set()
        self._delivery_lock = asyncio.Lock()
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
        self._cleanup_failed_uploads()
        port = int(os.environ.get('HERMES_APP_PORT', '0'))
        app = web.Application(middlewares=[_authentication], client_max_size=12 * 1024 * 1024)
        app['adapter'] = self
        app['pairing'] = self._pairing
        app.router.add_post('/v1/pairing/grants', device_pairing.issue)
        app.router.add_post('/v1/pairing/exchange', device_pairing.exchange)
        app.router.add_get('/v1/pairing/devices', device_pairing.devices)
        app.router.add_delete('/v1/pairing/devices/{id}', device_pairing.revoke)
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
        app.router.add_get('/v1/threads/{id}/search', self._search)
        app.router.add_post('/v1/threads/{id}/stop', self._stop)
        app.router.add_post('/v1/threads/{id}/receipts/{receipt_id}/cancel', self._cancel_queued)
        app.router.add_get('/v1/threads/{id}/interactions/{request_id}', self._interaction)
        app.router.add_post('/v1/threads/{id}/interactions/{request_id}/answer', self._answer)
        app.router.add_post('/v1/threads/{id}/attachments', self._upload)
        app.router.add_get('/v1/threads/{id}/attachments/{attachment_id}', self._attachment)
        app.router.add_get('/v1/threads/{id}/attachments/{attachment_id}/metadata', self._attachment_metadata)
        app.router.add_delete('/v1/threads/{id}/attachments/{attachment_id}', self._attachment)
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
        if await asyncio.to_thread(self._store.expire_interactions,self._generation):
            self._events_changed.set()
        if await asyncio.to_thread(self._store.recover_deliveries,get_hermes_home()/'state.db'):
            self._events_changed.set()
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
        followups=getattr(self,'_followup_tasks',set())
        for task in tuple(followups):
            task.cancel()
        if followups:
            await asyncio.gather(*tuple(followups), return_exceptions=True)
        admissions=getattr(self,'_admission_tasks',set())
        if admissions:
            await asyncio.gather(*tuple(admissions),return_exceptions=True)
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
        # Normal agent finals are already authoritative SessionDB rows. Cron is
        # delivered through this same adapter, but has no inbound turn to mirror.
        if metadata and metadata.get('job_id'):
            await self._deliver_background(chat_id, content, metadata)
        return SendResult(success=True, message_id=uuid.uuid4().hex)

    async def _send_exec_approval_prompt(self, prompt):
        from tools.approval import list_gateway_approvals
        thread_id = self._session_threads.get(prompt.session_key)
        receipt_id = self._active_receipts.get(thread_id)
        if not thread_id or not receipt_id:
            return SendResult(success=False,error='no active Hermes App receipt')
        candidates=list_gateway_approvals(prompt.session_key)
        # The core may publish parallel approvals; bind only a unique unexposed
        # waiter. Ambiguous prompts fail closed instead of picking the oldest.
        unmatched=[item for item in candidates if item.get('command')==prompt.command
                   and item.get('description')==prompt.description
                   and not self._store.interaction(thread_id,item['request_id'])]
        if len(unmatched)!=1:
            return SendResult(success=False,error='approval request correlation ambiguous')
        request_id=unmatched[0]['request_id']
        self._store.interaction_add('approval',request_id,thread_id,receipt_id,self._generation,
                                    prompt.text,prompt.choices)
        self._events_changed.set()
        return SendResult(success=True,message_id=request_id)

    async def send_clarify(self, chat_id, question, choices, clarify_id, session_key=None, metadata=None):
        thread_id=self._session_threads.get(session_key)
        receipt_id=self._active_receipts.get(thread_id)
        if not thread_id or not receipt_id:
            return SendResult(success=False,error='no active Hermes App receipt')
        self._store.interaction_add('clarify',clarify_id,thread_id,receipt_id,self._generation,
                                    question,choices or [])
        self._events_changed.set()
        return SendResult(success=True,message_id=clarify_id)

    async def retire_clarify_card(self, clarify_id, notice):
        for thread_id in tuple(self._active_receipts):
            if self._store.interaction_settle(thread_id,clarify_id,self._generation,'expired'):
                self._events_changed.set()
                break

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
            'execution_ingress': 'durable_fifo_native_steer', 'durable_accept': True,
            'history': True, 'history_latest': True, 'tool_call_timeline': True,
            'message_send_identity': True,
            'durable_sync': True, 'attachments': True, 'approvals': True,
            'stop': True, 'search': True, 'background_delivery': True})

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
            receipt, created = await asyncio.to_thread(self._store.accept, tid, client_id, content,
                                                       body.get('attachments',[]))
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
            admission=asyncio.create_task(self._dispatch_busy_text(tid))
            self._admission_tasks.add(admission)
            def done(task):
                self._admission_tasks.discard(task)
                if not self._stopping:
                    self._wake_thread(tid)
            admission.add_done_callback(done)
            await asyncio.shield(admission)  # client disconnect cannot revoke durable handoff
            receipt=await asyncio.to_thread(self._store.receipt,receipt['id'])
        return web.json_response({'receipt':receipt}, status=202)

    def _ingress_lock(self, thread_id):
        return self.__dict__.setdefault('_ingress_locks',{}).setdefault(thread_id, asyncio.Lock())

    async def _dispatch_busy_text(self, thread_id):
        # The running receipt is the primary owner. A follow-up is claimed in
        # durable FIFO order before crossing the Gateway boundary, exactly once.
        async with self._ingress_lock(thread_id):
            if (self._stopping or self._gateway_starting() or
                    thread_id not in self._active_receipts):
                return
            thread = self._store.get_thread(thread_id)
            source = self._source(thread['project_id'],thread_id)
            if self._gateway_owner()._effective_busy_input_mode(source) != 'steer':
                return  # Default interrupt mode must keep the old safe FIFO.
            while not self._stopping:
                claim = await asyncio.to_thread(self._store.claim_busy_text,thread_id)
                if claim is None:
                    return
                receipt_id, text = claim
                self._events_changed.set()
                event = MessageEvent(text=text,source=source,message_id=receipt_id)
                try:
                    await self.handle_message(event)
                except asyncio.CancelledError:
                    await asyncio.shield(asyncio.to_thread(self._store.finish_receipt,receipt_id,'unknown'))
                    raise
                except Exception:
                    # After claim even an exception is ambiguous; never requeue.
                    log.exception('Hermes App busy admission ambiguous: %s',receipt_id)
                    await asyncio.to_thread(self._store.finish_receipt,receipt_id,'unknown')
                    self._events_changed.set()
                    return
                # Busy success normally leaves _gateway_accepted False. Gateway may
                # instead take a normal owner or enqueue a native FIFO fallback.
                task=asyncio.create_task(self._reconcile_followup(thread_id,receipt_id,event))
                self._followup_tasks.add(task)
                task.add_done_callback(self._followup_tasks.discard)

    async def _reconcile_followup(self, thread_id, receipt_id, event):
        key=self._event_session_key(event)
        try:
            while not self._stopping:
                outcome=await asyncio.to_thread(self._store.followup_core_outcome,
                                                 receipt_id,get_hermes_home()/'state.db')
                current=self._session_tasks.get(key)
                pending=self._pending_messages.get(key)
                primary=self._active_receipts.get(thread_id)
                if event._gateway_accepted and primary is None and current and not current.done():
                    self._active_receipts[thread_id]=receipt_id
                    self._session_threads[key]=thread_id
                    primary=receipt_id
                if outcome in ('completed','failed','interrupted','unknown') and (not current or current.done()) and not pending:
                    await asyncio.to_thread(self._store.finish_receipt,receipt_id,outcome)
                    break
                if (primary not in (None,receipt_id) or (current and not current.done()) or pending):
                    await asyncio.sleep(.05)
                    continue
                # Native Gateway admitted the follow-up, but there is no
                # per-ID model-consumption/completion proof. Do not inherit the
                # primary owner's completion. A crash before here stays unknown.
                await asyncio.sleep(.05)  # allow the in-band drain handoff
                if not self._session_tasks.get(key) and not self._pending_messages.get(key):
                    # An exact normal user anchor without formal completion is
                    # ambiguous; it is not a successfully admitted steer.
                    await asyncio.to_thread(self._store.finish_receipt,receipt_id,
                                            'unknown' if outcome == 'anchored' else 'received')
                    break
            else:
                return  # cold recovery converts running to unknown
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception('Hermes App follow-up reconciliation failed: %s',receipt_id)
            await asyncio.to_thread(self._store.finish_receipt,receipt_id,'unknown')
        finally:
            if self._active_receipts.get(thread_id)==receipt_id:
                self._active_receipts.pop(thread_id,None)
                self._session_threads.pop(key,None)
            self._stop_receipts.discard(receipt_id)
            if self._store.expire_receipt_interactions(receipt_id,self._generation):
                self._events_changed.set()
            self._events_changed.set()
            if not self._stopping:
                self._wake_thread(thread_id)

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
        # Existing isolated queue probes construct this adapter without __init__.
        self.__dict__.setdefault('_stop_receipts',set())
        self.__dict__.setdefault('_active_receipts',{})
        self.__dict__.setdefault('_session_threads',{})
        self.__dict__.setdefault('_generation','isolated-probe')
        while not self._stopping:
            while self._gateway_starting():
                await asyncio.sleep(.05)
            generation = self._queue_wakes.get(thread_id, 0)
            async with self._ingress_lock(thread_id):
                claim = await asyncio.to_thread(self._store.claim_next, thread_id)
            if claim is None:
                if generation != self._queue_wakes.get(thread_id, 0):
                    continue
                return
            receipt_id, content = claim
            if receipt_id in self._stop_receipts:
                await asyncio.to_thread(self._store.finish_receipt,receipt_id,'interrupted')
                self._stop_receipts.discard(receipt_id)
                continue
            self._events_changed.set()
            thread = self._store.get_thread(thread_id)
            attachments=self._store.receipt_attachments(receipt_id)
            try:
                paths=[self._validated_ingress_path(a) for a in attachments]
            except (OSError,ValueError):
                await asyncio.to_thread(self._store.finish_receipt,receipt_id,'failed')
                self._events_changed.set()
                continue
            event = MessageEvent(text=content, source=self._source(thread['project_id'],thread_id),
                                 message_id=receipt_id,
                                 media_urls=paths,
                                 media_types=[a['mime'] for a in attachments],
                                 media_text_inlined=[False for _ in attachments])
            session_key=self._event_session_key(event)
            self._session_threads[session_key]=thread_id
            self._active_receipts[thread_id]=receipt_id
            try:
                if receipt_id in self._stop_receipts:
                    await asyncio.to_thread(self._store.finish_receipt,receipt_id,'interrupted')
                    continue
                await self.handle_message(event)
                # Messages durably accepted before _active_receipts was installed
                # missed the HTTP-side busy dispatch. The Gateway guard now exists:
                # drain that FIFO prefix into the same native busy handler.
                if event._gateway_accepted:
                    await self._dispatch_busy_text(thread_id)
                if receipt_id in self._stop_receipts:
                    from gateway.run import _INTERRUPT_REASON_STOP
                    await self._gateway_owner()._interrupt_and_clear_session(
                        session_key,event.source,interrupt_reason=_INTERRUPT_REASON_STOP,
                        invalidation_reason='hermes_app_stop')
                owner = self._session_tasks.get(self._event_session_key(event)) if event._gateway_accepted else None
                if receipt_id in self._stop_receipts and owner is None:
                    await asyncio.to_thread(self._store.finish_receipt,receipt_id,'interrupted')
                    continue
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
                if self._store.expire_receipt_interactions(receipt_id,self._generation):
                    self._events_changed.set()
                if self._active_receipts.get(thread_id)==receipt_id:
                    self._active_receipts.pop(thread_id,None)
                    self._session_threads.pop(session_key,None)
                self._stop_receipts.discard(receipt_id)
                self._events_changed.set()

    async def _receipt(self, request):
        receipt = await asyncio.to_thread(self._store.receipt, request.match_info['id'])
        if receipt is None:
            raise web.HTTPNotFound()
        return web.json_response({'receipt':receipt})

    async def _sync(self, request):
        try:
            self._reconcile_interactions()
            await self._refresh_channels()
            limit = int(request.query.get('limit','100'))
            page = await asyncio.to_thread(self._store.sync_page,cursor=request.query.get('cursor'),limit=limit)
        except (ValueError,TypeError) as exc:
            raise web.HTTPBadRequest(text=str(exc)) from exc
        return web.json_response(page)

    async def _snapshot(self,request):
        try:
            self._reconcile_interactions()
            await self._refresh_channels()
            limit=int(request.query.get('limit','50'))
            page=await asyncio.to_thread(self._store.snapshot,after=request.query.get('after'),limit=limit)
        except (ValueError,TypeError) as exc:
            raise web.HTTPBadRequest(text=str(exc)) from exc
        except OverflowError as exc:
            raise web.HTTPConflict(text=str(exc)) from exc
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
            after_ref = request.query.get('after_ref_seq')
            latest = request.query.get('latest')
            if latest is not None and latest != 'true':
                raise ValueError('latest must be true')
            result = await asyncio.to_thread(self._store.history_page, tid,
                get_hermes_home() / 'state.db', limit=limit, after=request.query.get('after'),
                after_ref_seq=int(after_ref) if after_ref is not None else None,
                latest=latest == 'true', before=request.query.get('before'))
        except (ValueError, TypeError) as exc:
            raise web.HTTPBadRequest(text=str(exc)) from exc
        except HistoryPending as exc:
            raise web.HTTPConflict(text=str(exc)) from exc
        except MissingOriginal as exc:
            raise web.HTTPConflict(text=str(exc)) from exc
        return web.json_response(result)

    async def _search(self, request):
        tid=request.match_info['id']
        if not self._store.get_thread(tid):
            raise web.HTTPNotFound()
        try:
            result=await asyncio.to_thread(self._store.search_page,tid,get_hermes_home()/'state.db',
                request.query.get('q'),limit=int(request.query.get('limit','20')),
                after=request.query.get('after'))
        except (ValueError,TypeError) as exc:
            raise web.HTTPBadRequest(text=str(exc)) from exc
        except MissingOriginal as exc:
            raise web.HTTPConflict(text=str(exc)) from exc
        return web.json_response(result)

    async def _interaction(self, request):
        self._reconcile_interactions()
        item=self._store.interaction(request.match_info['id'],request.match_info['request_id'])
        if item is None:
            raise web.HTTPNotFound()
        return web.json_response({'interaction':{k:item[k] for k in
            ('id','kind','thread_id','receipt_id','generation','prompt','choices','state')}})

    def _reconcile_interactions(self):
        from tools.approval import list_gateway_approvals
        from tools.clarify_gateway import get_pending_for_session
        for session_key,tid in tuple(self._session_threads.items()):
            approval_ids={item['request_id'] for item in list_gateway_approvals(session_key)}
            clarify=get_pending_for_session(session_key,include_choice_prompts=True)
            clarify_id=clarify.clarify_id if clarify else None
            for item in self._store.pending_interactions(tid,self._generation):
                live=item['id'] in approval_ids if item['kind']=='approval' else item['id']==clarify_id
                if not live and self._store.interaction_settle(tid,item['id'],self._generation,'expired'):
                    self._events_changed.set()

    async def _answer(self, request):
        tid=request.match_info['id']
        item=self._store.interaction(tid,request.match_info['request_id'])
        if item is None:
            raise web.HTTPNotFound()
        body=await _body(request)
        if body.get('receipt_id')!=item['receipt_id'] or body.get('generation')!=item['generation']:
            raise web.HTTPConflict(text='request receipt or generation mismatch')
        if item['generation']!=self._generation or item['state']!='pending' or (
                self._active_receipts.get(tid)!=item['receipt_id']):
            raise web.HTTPConflict(text='request expired or settled')
        choice=body.get('choice')
        if not isinstance(choice,str) or not choice or len(choice)>4000:
            raise web.HTTPBadRequest(text='invalid choice')
        session_key=next((key for key,value in self._session_threads.items() if value==tid),None)
        if not session_key:
            raise web.HTTPConflict(text='run unavailable')
        if item['kind']=='approval':
            if choice not in item['choices']:
                raise web.HTTPBadRequest(text='choice unavailable')
            from tools.approval import resolve_gateway_approval
            won=resolve_gateway_approval(session_key,choice,request_id=item['id'])==1
        else:
            from tools.clarify_gateway import resolve_gateway_clarify
            if item['choices'] and choice not in item['choices']:
                raise web.HTTPBadRequest(text='choice unavailable')
            won=resolve_gateway_clarify(item['id'],choice)
        if not won:
            self._store.interaction_settle(tid,item['id'],self._generation,'expired')
            self._events_changed.set()
            raise web.HTTPConflict(text='request expired or settled')
        self._store.interaction_settle(tid,item['id'],self._generation,'settled')
        self._events_changed.set()
        return web.json_response({'request_id':item['id'],'state':'settled'})

    def _gateway_owner(self):
        for cell in getattr(self._message_handler,'__closure__',()) or ():
            target=getattr(cell.cell_contents,'__self__',None)
            if target is not None and hasattr(target,'_interrupt_and_clear_session'):
                return target
        raise RuntimeError('pinned GatewayRunner stop path unavailable')

    async def _stop(self, request):
        tid=request.match_info['id']
        thread=self._store.get_thread(tid)
        if thread is None:
            raise web.HTTPNotFound()
        receipt_id=self._active_receipts.get(tid)
        if receipt_id is None:
            return web.json_response({'stopped':False,'state':'idle'})
        session_key=next((key for key,value in self._session_threads.items() if value==tid),None)
        if session_key is None:
            raise web.HTTPConflict(text='run owner unavailable')
        self._stop_receipts.add(receipt_id)
        from gateway.run import _INTERRUPT_REASON_STOP
        await self._gateway_owner()._interrupt_and_clear_session(
            session_key,self._source(thread['project_id'],tid),
            interrupt_reason=_INTERRUPT_REASON_STOP,invalidation_reason='hermes_app_stop')
        # The hard interrupt stops the agent/tool. The gateway's clarify waiter
        # blocks on its own threading.Event, so release that exact session too.
        from tools.clarify_gateway import clear_session as clear_clarify_session
        from tools.approval import withdraw_gateway_approval
        clear_clarify_session(session_key)
        for item in self._store.pending_interactions(tid,self._generation):
            if item['kind']=='approval':
                withdraw_gateway_approval(session_key,item['id'],'Hermes App Thread stopped')
        if self._store.expire_receipt_interactions(receipt_id,self._generation):
            self._events_changed.set()
        return web.json_response({'stopped':True,'receipt_id':receipt_id})

    async def _cancel_queued(self, request):
        tid=request.match_info['id']
        if self._store.get_thread(tid) is None:
            raise web.HTTPNotFound()
        receipt_id=request.match_info['receipt_id']
        if not self._store.cancel_queued(tid,receipt_id):
            raise web.HTTPConflict(text='receipt is not queued in this thread')
        self._events_changed.set()
        return web.json_response({'receipt':self._store.receipt(receipt_id)})

    def _attachment_root(self):
        root=self._store.path.parent/'attachments'
        if root.is_symlink():
            raise RuntimeError('attachment directory is a symlink')
        root.mkdir(mode=0o700,parents=True,exist_ok=True)
        return root

    def _attachment_path(self, attachment_id):
        if not isinstance(attachment_id,str) or not re.fullmatch(r'att_[0-9a-f]{32}',attachment_id):
            raise ValueError('invalid attachment id')
        return self._attachment_root()/attachment_id

    def _validated_ingress_path(self, item):
        path=self._attachment_path(item['id'])
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
        try:
            info=os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_size!=item['size']:
                raise ValueError('attachment unavailable')
        finally:
            os.close(fd)
        return str(path)

    async def _attachment_metadata(self, request):
        tid=request.match_info['id']
        if self._store.get_thread(tid) is None:
            raise web.HTTPNotFound()
        item=self._store.attachment(tid,request.match_info['attachment_id'])
        if item is None:
            return web.json_response({'attachment':{'id':request.match_info['attachment_id'],
                                                     'thread_id':tid,'state':'deleted'}})
        return web.json_response({'attachment':self._store.attachment_view(item)})

    def _cleanup_failed_uploads(self):
        """At boot only, remove this plugin's abandoned temp or unindexed files."""
        root=self._attachment_root()
        entries=list(root.iterdir())
        if len(entries)>10000:
            raise RuntimeError('attachment cleanup bound exceeded')
        for path in entries:
            name=path.name
            if re.fullmatch(r'\.partial-[0-9a-f]{32}',name):
                path.unlink(missing_ok=True)
            elif re.fullmatch(r'att_[0-9a-f]{32}',name):
                with self._store._connect() as db:
                    exists=db.execute('SELECT 1 FROM attachments WHERE id=?',(name,)).fetchone()
                if not exists:
                    path.unlink(missing_ok=True)

    async def _upload(self, request):
        tid=request.match_info['id']
        thread=self._store.get_thread(tid)
        if thread is None:
            raise web.HTTPNotFound()
        if thread['archived']:
            raise web.HTTPConflict(text='thread archived')
        raw_name=request.headers.get('X-File-Name','attachment')
        encoding=request.headers.get('X-File-Name-Encoding')
        if encoding:
            if encoding != 'percent-utf8' or re.search(r'%(?![0-9A-Fa-f]{2})',raw_name):
                raise web.HTTPBadRequest(text='invalid filename encoding')
            try:
                raw_name=unquote(raw_name,encoding='utf-8',errors='strict')
            except UnicodeError as exc:
                raise web.HTTPBadRequest(text='invalid filename encoding') from exc
        if not isinstance(raw_name,str) or not 1<=len(raw_name)<=180 or any(
                c in raw_name for c in ('/','\\','\x00','\r','\n')) or raw_name in ('.','..'):
            raise web.HTTPBadRequest(text='invalid filename')
        mime=mimetypes.guess_type(raw_name)[0] or 'application/octet-stream'
        if mime in ('text/html','image/svg+xml','application/javascript'):
            mime='application/octet-stream'
        attachment_id='att_'+uuid.uuid4().hex
        final=self._attachment_path(attachment_id)
        temporary=self._attachment_root()/('.partial-'+uuid.uuid4().hex)
        fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        size=0
        try:
            with os.fdopen(fd,'wb') as stream:
                async for chunk in request.content.iter_chunked(65536):
                    size+=len(chunk)
                    if size>10*1024*1024:
                        raise web.HTTPRequestEntityTooLarge(max_size=10*1024*1024,actual_size=size)
                    stream.write(chunk)
                stream.flush()
                os.fsync(stream.fileno())
            if size==0:
                raise web.HTTPBadRequest(text='empty attachment')
            os.replace(temporary,final)
            self._store.attachment_add(tid,attachment_id,raw_name,mime,size)
        except OverflowError as exc:
            temporary.unlink(missing_ok=True)
            final.unlink(missing_ok=True)
            raise web.HTTPTooManyRequests(text=str(exc)) from exc
        except ValueError as exc:
            temporary.unlink(missing_ok=True)
            final.unlink(missing_ok=True)
            if str(exc)=='thread archived':
                raise web.HTTPConflict(text=str(exc)) from exc
            raise web.HTTPNotFound() from exc
        except BaseException:
            temporary.unlink(missing_ok=True)
            final.unlink(missing_ok=True)
            raise
        self._events_changed.set()
        return web.json_response({'attachment':{'id':attachment_id,'thread_id':tid,
            'name':raw_name,'mime':mime,'size':size}},status=201)

    async def _attachment(self, request):
        tid=request.match_info['id']
        attachment_id=request.match_info['attachment_id']
        item=self._store.attachment(tid,attachment_id)
        if item is None:
            raise web.HTTPNotFound()
        try:
            path=self._attachment_path(attachment_id)
        except ValueError as exc:
            raise web.HTTPNotFound() from exc
        if request.method=='DELETE':
            if not self._store.attachment_delete_unattached(tid,attachment_id):
                raise web.HTTPConflict(text='attachment belongs to a receipt')
            path.unlink(missing_ok=True)
            self._events_changed.set()
            return web.json_response({'deleted':True})
        try:
            fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
            if not stat.S_ISREG(os.fstat(fd).st_mode) or os.fstat(fd).st_size!=item['size']:
                os.close(fd)
                raise web.HTTPConflict(text='attachment unavailable')
        except OSError as exc:
            raise web.HTTPConflict(text='attachment unavailable') from exc
        response=web.StreamResponse(headers={'Content-Type':item['mime'],
            'Content-Length':str(item['size']),
            'Content-Disposition':"attachment; filename*=UTF-8''"+quote(item['name'],safe=''),
            'X-Content-Type-Options':'nosniff'})
        with os.fdopen(fd,'rb') as stream:
            await response.prepare(request)
            while chunk:=stream.read(65536):
                await response.write(chunk)
        await response.write_eof()
        return response

    async def _deliver_background(self, chat_id, content, metadata):
        async with self._delivery_lock:
            return await self._deliver_background_serial(chat_id,content,metadata)

    async def _deliver_background_serial(self, chat_id, content, metadata):
        tid=metadata.get('thread_id')
        thread=self._store.get_thread(tid) if isinstance(tid,str) else None
        if not thread or thread['project_id']!=str(chat_id):
            raise ValueError('cron target is not an owned Thread')
        from cron.executions import latest_execution
        execution=await asyncio.to_thread(latest_execution,str(metadata['job_id']))
        if not execution:
            raise ValueError('cron execution identity unavailable')
        execution_id=execution['id']
        if self._store.delivery_ref(execution_id):
            return
        from cron.jobs import get_job
        job=await asyncio.to_thread(get_job,str(metadata['job_id']))
        if not job or job.get('attach_to_session') is not False:
            raise ValueError('Hermes App cron requires attach_to_session=false')
        if execution['status'] not in ('claimed','running'):
            raise ValueError('cron execution is no longer deliverable')
        from hermes_state import SessionDB
        import sqlite3
        with self._store._connect() as db:
            row=db.execute('SELECT session_id FROM session_links WHERE thread_id=? ORDER BY rowid DESC LIMIT 1',
                           (tid,)).fetchone()
        if not row:
            raise ValueError('cron Thread session unavailable')
        session_id=row['session_id']
        state_path=get_hermes_home()/'state.db'
        with sqlite3.connect(state_path) as db:
            existing=db.execute("SELECT id FROM messages WHERE session_id=? AND role='assistant' "
                                "AND platform_message_id=? ORDER BY id LIMIT 1",
                                (session_id,'cron:'+execution_id)).fetchone()
        if existing:
            row_id=existing[0]
        else:
            core=SessionDB(state_path)
            try:
                row_id=await asyncio.to_thread(core.append_message,session_id,'assistant',content,
                    platform_message_id='cron:'+execution_id,finish_reason='stop',
                    display_kind='cron_delivery',display_metadata={'job_id':str(metadata['job_id']),
                                                                    'execution_id':execution_id})
            finally:
                core.close()
        self._store.publish_delivery(execution_id,tid,session_id,row_id)
        self._events_changed.set()

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
        auth_kind=request['auth_kind']
        device_id=token[14:38] if auth_kind == 'device' else None
        try:
            await ws.send_json({'type':'hello','protocol':1,'durable_sync':True})
            while not ws.closed and not self._stopping:
                self._reconcile_interactions()
                valid = (hmac.compare_digest(token,'Bearer '+os.environ.get('HERMES_APP_TOKEN',''))
                         if auth_kind == 'admin' else
                         await asyncio.to_thread(self._pairing.authenticated_device, token[7:]) == device_id)
                if not valid:
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
    ctx.register_hook('pre_tool_call', pre_tool_call)
    ctx.register_hook('post_tool_call', post_tool_call)
    ctx.register_hook('pre_auxiliary_call', pre_auxiliary_call)
    ctx.register_hook('post_llm_call', post_llm_call)
    ctx.register_hook('on_session_end', on_session_end)
    ctx.register_platform(name='hermes_app', label='Hermes App local foundation',
        adapter_factory=HermesAppAdapter, check_fn=lambda: True,
        validate_config=lambda cfg: bool(cfg.enabled),
        required_env=['HERMES_APP_TOKEN', 'HERMES_APP_ALLOWED_USERS'],
        allowed_users_env='HERMES_APP_ALLOWED_USERS',
        cron_deliver_env_var='HERMES_APP_CRON_HOME_CHANNEL')
