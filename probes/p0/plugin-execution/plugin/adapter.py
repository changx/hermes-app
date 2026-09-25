"""Local-only, synthetic-traffic platform plugin. Not a production app server."""
from gateway.config import Platform
from gateway.platforms.base import BasePlatformAdapter, SendResult, resolve_channel_prompt
from gateway.platforms.event import MessageEvent


approval_hook_events = []  # process-local observability only; never a decision store


class ProbeAdapter(BasePlatformAdapter):
    def __init__(self, config):
        super().__init__(config, Platform("p0_execution"))
        self.delivered = []

    async def connect(self, *, is_reconnect=False):
        self._mark_connected()
        return True

    async def disconnect(self):
        # No socket: the test client can vanish without disposing server-owned work.
        self._mark_disconnected()

    async def get_chat_info(self, chat_id):
        return {"name": chat_id, "type": "thread"}

    async def send(self, chat_id, content, reply_to=None, metadata=None):
        self.delivered.append({"chat_id": chat_id, "content": content, "metadata": metadata or {}})
        return SendResult(success=True, message_id=str(len(self.delivered)))

    async def receive(self, event: MessageEvent):
        # Normal platform entry; no Agent implementation or gateway core patch.
        event.channel_prompt = resolve_channel_prompt(
            self.config.extra, event.source.thread_id or event.source.chat_id,
            event.source.parent_chat_id or event.source.chat_id)
        await self.handle_message(event)
        return event._gateway_accepted


def register(ctx):
    ctx.register_hook('pre_approval_request', lambda **kw: approval_hook_events.append(
        {'phase': 'pre', 'session_key': kw.get('session_key')}))
    ctx.register_hook('post_approval_response', lambda **kw: approval_hook_events.append(
        {'phase': 'post', 'choice': kw.get('choice')}))
    ctx.register_platform(
        name="p0_execution", label="P0 Execution Fixture",
        adapter_factory=ProbeAdapter, check_fn=lambda: True,
        validate_config=lambda cfg: bool(cfg.enabled),
        cron_deliver_env_var="P0_EXECUTION_HOME_CHANNEL",
    )
