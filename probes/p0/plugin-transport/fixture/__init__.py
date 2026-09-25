"""Disposable platform plugin; not a chat backend or persistent message store.

The HTTP/WS fixture routes are owned by this adapter. A separate ping route
also demonstrates the API Server native-handler seam; no TUI RPC is added.
Tokens are test inputs supplied by the isolated driver, never defaults.
"""
import hmac
import re
import secrets

from aiohttp import WSMsgType, web
from gateway.config import Platform
from gateway.platforms.base import BasePlatformAdapter, SendResult

MAX_BYTES = 16
MIMES = {"text/plain"}


class TransportProbeAdapter(BasePlatformAdapter):
    def __init__(self, config):
        super().__init__(config, Platform("p0_transport_probe"))
        self._runner = None
        self._site = None
        self._sockets = set()
        self._sequence = 0
        self._events = []  # intentionally bounded in-process only
        self._files = {}
        self.port = None

    def _principal(self, request):
        header = request.headers.get("Authorization", "")
        supplied = header[7:] if header.startswith("Bearer ") else ""
        for principal, expected in self.config.extra["tokens"].items():
            if supplied and hmac.compare_digest(supplied, expected):
                return principal
        raise web.HTTPUnauthorized()

    def _scope(self, request):
        who = self._principal(request)
        # A client-provided profile is never authority to switch profiles.
        if request.headers.get("X-Profile", "owner") != "owner":
            raise web.HTTPForbidden()
        if who != "owner":
            raise web.HTTPForbidden()
        return who

    async def _health(self, request):
        self._scope(request)
        return web.json_response({"plugin": "p0-transport-probe", "scope": "owner"})

    async def _publish(self, request):
        self._scope(request)
        try:
            data = await request.json()
        except (ValueError, UnicodeDecodeError):
            raise web.HTTPBadRequest()
        if not isinstance(data, dict) or not isinstance(data.get("body"), str):
            raise web.HTTPBadRequest()
        self._sequence += 1
        event = {"seq": self._sequence, "body": data["body"]}
        self._events.append(event)
        self._events = self._events[-8:]
        for ws in tuple(self._sockets):
            if not ws.closed:
                await ws.send_json(event)
        return web.json_response(event, status=201)

    async def _ws(self, request):
        self._scope(request)  # before upgrade
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self._sockets.add(ws)
        try:
            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    try:
                        since = int(msg.json()["since"])
                    except (KeyError, TypeError, ValueError):
                        await ws.send_json({"error": "invalid cursor"})
                        continue
                    if since < 0:
                        await ws.send_json({"error": "invalid cursor"})
                        continue
                    await ws.send_json({"events": [e for e in self._events if e["seq"] > since],
                                        "truncated": bool(self._events and since < self._events[0]["seq"] - 1)})
        finally:
            self._sockets.discard(ws)
        return ws

    async def _upload(self, request):
        owner = self._scope(request)
        if request.content_type not in MIMES:
            raise web.HTTPUnsupportedMediaType()
        name = request.headers.get("X-Filename", "")
        if not re.fullmatch(r"[a-zA-Z0-9_.-]{1,32}", name) or name in {".", ".."} or ".." in name:
            raise web.HTTPBadRequest()
        body = await request.content.read(MAX_BYTES + 1)
        if not body or len(body) > MAX_BYTES:
            raise web.HTTPRequestEntityTooLarge(max_size=MAX_BYTES, actual_size=len(body))
        key = secrets.token_hex(12)
        self._files[key] = (owner, name, body)
        return web.json_response({"id": key}, status=201)

    async def _download(self, request):
        owner = self._scope(request)
        key = request.match_info["key"]
        entry = self._files.get(key)
        if not entry or entry[0] != owner:
            raise web.HTTPNotFound()
        return web.Response(body=entry[2], content_type="text/plain",
                            headers={"Content-Disposition": f'attachment; filename="{entry[1]}"'})

    async def connect(self, *, is_reconnect=False):
        if self._runner:
            return True
        app = web.Application(client_max_size=MAX_BYTES + 1024)
        app.router.add_get("/health", self._health)
        app.router.add_post("/events", self._publish)
        app.router.add_get("/ws", self._ws)
        app.router.add_post("/files", self._upload)
        app.router.add_get("/files/{key}", self._download)
        self._runner = web.AppRunner(app)
        await self._runner.setup()
        self._site = web.TCPSite(self._runner, "127.0.0.1", 0)
        await self._site.start()
        self.port = self._site._server.sockets[0].getsockname()[1]
        self._running = True
        return True

    async def disconnect(self):
        for ws in tuple(self._sockets):
            await ws.close()
        if self._runner:
            await self._runner.cleanup()
        self._runner = self._site = None
        self._running = False
        self._files.clear()
        self._events.clear()

    async def send(self, chat_id, content, reply_to=None, metadata=None):
        return SendResult(success=False, error="probe has no Hermes turn bridge")

    async def get_chat_info(self, chat_id):
        return {"name": "probe", "type": "dm"}


def _attach_to_api(native, adapter):
    """Documented platform-handler seam; route is plugin-owned, not core RPC."""
    async def ping(request):
        supplied = request.headers.get("Authorization", "")
        expected = "Bearer " + str(adapter.config.extra.get("key", ""))
        if not adapter.config.extra.get("key") or not hmac.compare_digest(supplied, expected):
            raise web.HTTPUnauthorized()
        return web.json_response({"via": "register_platform_handler", "plugin": "p0-transport-probe"})

    native.router.add_get("/p0/transport", ping)


def register(ctx):
    ctx.register_platform(name="p0_transport_probe", label="P0 transport probe",
                          adapter_factory=TransportProbeAdapter, check_fn=lambda: True)
    ctx.register_platform_handler("api_server", _attach_to_api)
