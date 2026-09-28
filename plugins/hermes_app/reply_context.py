"""Per-input output provenance shared by adapter and formal model hooks."""
from contextvars import ContextVar

# Mutable only within an input's inherited task/executor context. The hook marks
# actual model entry, including /retry's inner event without a platform message ID.
reply_scope: ContextVar[dict | None] = ContextVar('hermes_app_reply_scope', default=None)
