"""Pending-confirmation broker for destructive tool calls.

The agent loop, mid-stream, discovers it wants to run something destructive. It
parks the call here, emits a `confirm` event down the SSE stream, and awaits the
future. The frontend shows the prompt and POSTs the user's answer to
/api/v1/confirm, which resolves the future and lets the loop continue.

Confirmations expire so a closed overlay can never leave a request hanging on a
future nobody will resolve.
"""
import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from typing import Dict, Optional

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_SECONDS = 120.0


@dataclass
class Pending:
    prompt: str
    tool_name: str
    future: asyncio.Future = field(repr=False)


_pending: Dict[str, Pending] = {}


def create(prompt: str, tool_name: str) -> str:
    """Register a pending confirmation and return its id."""
    confirm_id = uuid.uuid4().hex[:12]
    loop = asyncio.get_running_loop()
    _pending[confirm_id] = Pending(prompt=prompt, tool_name=tool_name, future=loop.create_future())
    return confirm_id


def resolve(confirm_id: str, approved: bool) -> bool:
    """Answer a pending confirmation. Returns False if the id is unknown/expired."""
    entry = _pending.get(confirm_id)
    if entry is None:
        return False
    if not entry.future.done():
        entry.future.set_result(bool(approved))
    return True


async def wait(confirm_id: str, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> Optional[bool]:
    """Block until answered. Returns True/False, or None if it timed out."""
    entry = _pending.get(confirm_id)
    if entry is None:
        return None
    try:
        return await asyncio.wait_for(asyncio.shield(entry.future), timeout=timeout)
    except asyncio.TimeoutError:
        logger.info("Confirmation %s (%s) timed out.", confirm_id, entry.tool_name)
        return None
    finally:
        _pending.pop(confirm_id, None)


def cancel_all() -> None:
    """Drop every pending confirmation — used when a stream is abandoned."""
    for entry in _pending.values():
        if not entry.future.done():
            entry.future.cancel()
    _pending.clear()
