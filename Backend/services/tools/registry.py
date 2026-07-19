"""Tool registry — the single source of truth for what TARS can do.

Every capability registers itself here with three things: an OpenAI-compatible
JSON schema (what the model sees), an async handler (what actually runs), and a
`risk` classifier (what needs the user's blessing first).

The risk classifier is the important one. It is a function of the *arguments*,
not just the tool, because `run_shell("ls")` and `run_shell("rm -rf ~")` are the
same tool. It returns either None (run it) or a short human-readable sentence
describing the action, which the agent loop reads aloud and holds the tool call
on until the user confirms.
"""
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, List, Optional

# A risk classifier maps tool arguments -> confirmation prompt, or None to allow.
RiskFn = Callable[[Dict[str, Any]], Optional[str]]


@dataclass
class Tool:
    name: str
    description: str
    parameters: Dict[str, Any]
    handler: Callable[..., Awaitable[Dict[str, Any]]]
    risk: Optional[RiskFn] = None


_REGISTRY: Dict[str, Tool] = {}


def tool(
    name: str,
    description: str,
    parameters: Dict[str, Any],
    risk: Optional[RiskFn] = None,
):
    """Decorator registering an async function as a TARS tool."""

    def decorator(fn: Callable[..., Awaitable[Dict[str, Any]]]):
        _REGISTRY[name] = Tool(
            name=name,
            description=description,
            parameters=parameters,
            handler=fn,
            risk=risk,
        )
        return fn

    return decorator


def all_tools() -> Dict[str, Tool]:
    return dict(_REGISTRY)


def get(name: str) -> Optional[Tool]:
    return _REGISTRY.get(name)


def build_schema() -> List[Dict[str, Any]]:
    """Render the registry as an OpenAI `tools` array."""
    return [
        {
            "type": "function",
            "function": {
                "name": t.name,
                "description": t.description,
                "parameters": t.parameters,
            },
        }
        for t in _REGISTRY.values()
    ]


def needs_confirmation(name: str, arguments: Dict[str, Any]) -> Optional[str]:
    """Return a confirmation prompt if this call is destructive, else None."""
    t = _REGISTRY.get(name)
    if t is None or t.risk is None:
        return None
    try:
        return t.risk(arguments or {})
    except Exception:
        # A broken classifier must fail closed — ask rather than silently run.
        return f"Run {name}?"


async def execute(name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Invoke a tool by name. Confirmation is the caller's responsibility."""
    t = _REGISTRY.get(name)
    if t is None:
        return {"status": "error", "message": f"Unknown tool: {name}"}
    try:
        return await t.handler(**(arguments or {}))
    except TypeError as e:
        # The model passed arguments that don't match the signature. Tell it
        # exactly that so the next iteration can correct itself.
        return {"status": "error", "message": f"Bad arguments for {name}: {e}"}
    except Exception as e:
        return {"status": "error", "message": f"{name} failed: {e}"}
