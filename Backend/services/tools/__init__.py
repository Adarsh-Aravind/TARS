"""TARS tool surface.

Importing this package registers every capability. Callers use:

    from services.tools import TOOLS_SCHEMA, handle_tool_call, needs_confirmation

`TOOLS_SCHEMA` is built at import time from the registry, so adding a tool is
just adding an `@tool(...)` function in one of the modules below.
"""
from typing import Any, Dict, Optional

from .registry import build_schema, execute, needs_confirmation, tool

# Importing for side effects: each module registers its tools on import.
from . import apps      # noqa: F401  launch_app, open_website
from . import system    # noqa: F401  volume, media, clipboard, notify, shell, power
from . import files     # noqa: F401  find/read/write/move/delete
from . import web       # noqa: F401  web_search, fetch_page
from . import browser   # noqa: F401  Playwright control


# --------------------------------------------------------------------------
# Personality — lives here rather than in its own module because it's a single
# tool that just forwards into services.personality.
# --------------------------------------------------------------------------
@tool(
    name="set_personality",
    description=(
        "Adjust one of TARS's own personality dials. Call this ONLY when the user "
        "explicitly asks to change how you behave — e.g. 'TARS, humor sixty percent', "
        "'be more concise', 'stop sugarcoating it'. Never call it in response to an "
        "ordinary question or remark."
    ),
    parameters={
        "type": "object",
        "properties": {
            "setting": {
                "type": "string",
                "enum": ["humor", "honesty", "verbosity"],
                "description": "Which dial to adjust.",
            },
            "level": {
                # Union type on purpose: models emit "60" as often as 60, and Groq
                # validates tool args server-side and hard-rejects a mismatch.
                "type": ["integer", "string"],
                "description": "New level from 0 to 100.",
            },
        },
        "required": ["setting", "level"],
    },
)
async def set_personality(setting: str, level: Any) -> Dict[str, Any]:
    from services import personality

    return personality.set_setting(setting, level)


TOOLS_SCHEMA = build_schema()


async def handle_tool_call(tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Execute a tool. Confirmation gating happens in the agent loop, not here."""
    return await execute(tool_name, arguments)


async def shutdown() -> None:
    """Release tool-owned resources (currently just the Playwright browser)."""
    await browser.shutdown()


__all__ = [
    "TOOLS_SCHEMA",
    "handle_tool_call",
    "needs_confirmation",
    "shutdown",
]
