"""LLM agent loop.

The important property of this module is that it *iterates*. A single request
runs the model, executes whatever tools it asked for, feeds the results back,
and runs the model again — up to MAX_ITERATIONS times — until the model stops
asking for tools. That is what makes "open YouTube, search for lofi, and turn
the volume down" a single instruction instead of three.

Emitted events (each yielded as a JSON string):

    {"type": "token",       "data": str}
    {"type": "tool_start",  "name": str, "args": dict}
    {"type": "tool_result", "name": str, "status": str, "message": str}
    {"type": "confirm",     "id": str, "prompt": str, "name": str}
    {"type": "error",       "data": str}
"""
import json
import logging
from typing import Any, AsyncGenerator, Dict, List, Optional

from openai import (
    APIConnectionError,
    APITimeoutError,
    AsyncOpenAI,
    AuthenticationError,
    BadRequestError,
    RateLimitError,
)

from config import settings
from services import confirm, personality
from services.tools import TOOLS_SCHEMA, handle_tool_call, needs_confirmation

logger = logging.getLogger(__name__)

# How many model->tools->model round trips one user turn may take. High enough
# for real multi-step tasks, low enough that a confused model can't spin.
MAX_ITERATIONS = 8


class LLMEngine:
    _instance: Optional["LLMEngine"] = None

    # Per-session rolling history. Only user and final assistant turns are kept:
    # intermediate tool traffic is scoped to the request that produced it, so a
    # trimmed window can never leave an orphaned tool message referencing an
    # assistant turn that has already rolled off (which providers reject).
    _session_history: Dict[str, List[Dict[str, Any]]] = {}

    def __init__(self, provider: Optional[str] = None):
        active_provider = provider or settings.LLM_PROVIDER

        if active_provider == "groq":
            if not settings.GROQ_API_KEY:
                raise RuntimeError(
                    "LLM_PROVIDER=groq but GROQ_API_KEY is unset. "
                    "Copy Backend/.env.example to Backend/.env and set it."
                )
            self.client = AsyncOpenAI(
                base_url=settings.GROQ_BASE_URL, api_key=settings.GROQ_API_KEY
            )
        elif active_provider == "ollama":
            self.client = AsyncOpenAI(
                base_url=settings.OLLAMA_BASE_URL + "/v1",
                api_key="ollama",  # required by the SDK, ignored by Ollama
            )
        elif active_provider == "gemini":
            self.client = AsyncOpenAI(
                base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
                api_key=settings.GEMINI_API_KEY,
            )
        else:  # openai
            self.client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

        self.provider = active_provider
        self.model = settings.LLM_MODEL
        self.temperature = settings.TEMPERATURE
        self.max_history_turns = 12

    @classmethod
    def _get_instance(cls, provider: Optional[str] = None) -> "LLMEngine":
        if cls._instance is None or (provider and provider != cls._instance.provider):
            cls._instance = cls(provider)
        return cls._instance

    # ------------------------------------------------------------------
    # History
    # ------------------------------------------------------------------
    def _trim(self, history: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Keep the system prompt plus the most recent N turns."""
        if len(history) <= self.max_history_turns:
            return history
        return [history[0]] + history[-(self.max_history_turns - 1):]

    def _build_messages(self, session_id: str, user_message: str) -> List[Dict[str, Any]]:
        history = self._session_history.setdefault(
            session_id, [{"role": "system", "content": ""}]
        )
        # Rebuild the system prompt every turn: the personality dials can change
        # mid-conversation via set_personality, and a stale system message would
        # keep the old settings until restart.
        history[0] = {"role": "system", "content": personality.build_system_prompt()}
        history.append({"role": "user", "content": user_message})
        history = self._trim(history)
        self._session_history[session_id] = history
        # Return a copy: the agent loop appends tool traffic to its working list,
        # and that must not leak into persisted history.
        return list(history)

    def _remember(self, session_id: str, reply: str) -> None:
        if reply.strip():
            self._session_history.setdefault(session_id, []).append(
                {"role": "assistant", "content": reply}
            )

    @classmethod
    def reset_session(cls, session_id: str) -> None:
        cls._session_history.pop(session_id, None)

    # ------------------------------------------------------------------
    # One streamed model call
    # ------------------------------------------------------------------
    async def _stream_once(self, messages: List[Dict[str, Any]]):
        """Run one completion. Yields ("token", str); returns collected tool calls."""
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=self.temperature,
            max_tokens=settings.MAX_TOKENS,
            stream=True,
            tools=TOOLS_SCHEMA,
            tool_choice="auto",
        )

        content = ""
        tool_calls: Dict[int, Dict[str, str]] = {}

        async for chunk in response:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta

            if getattr(delta, "content", None):
                content += delta.content
                yield ("token", delta.content)

            for tc in getattr(delta, "tool_calls", None) or []:
                idx = tc.index
                slot = tool_calls.setdefault(idx, {"id": "", "name": "", "arguments": ""})
                # Each field arrives incrementally and may be absent in any chunk.
                if tc.id:
                    slot["id"] = tc.id
                if tc.function and tc.function.name:
                    slot["name"] = tc.function.name
                if tc.function and tc.function.arguments:
                    slot["arguments"] += tc.function.arguments

        yield ("done", {"content": content, "tool_calls": tool_calls})

    # ------------------------------------------------------------------
    # Agent loop
    # ------------------------------------------------------------------
    @classmethod
    async def stream_response(
        cls, session_id: str, user_message: str, provider: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        self = cls._get_instance(provider)
        messages = self._build_messages(session_id, user_message)
        spoken_reply = ""

        try:
            for iteration in range(MAX_ITERATIONS):
                content = ""
                tool_calls: Dict[int, Dict[str, str]] = {}

                async for kind, payload in self._stream_once(messages):
                    if kind == "token":
                        spoken_reply += payload
                        yield json.dumps({"type": "token", "data": payload})
                    else:
                        content = payload["content"]
                        tool_calls = payload["tool_calls"]

                # No tools requested — the model is done talking.
                if not tool_calls:
                    break

                # Record the assistant's tool-call turn before the results.
                messages.append({
                    "role": "assistant",
                    "content": content or None,
                    "tool_calls": [
                        {
                            "id": tc["id"],
                            "type": "function",
                            "function": {"name": tc["name"], "arguments": tc["arguments"] or "{}"},
                        }
                        for tc in tool_calls.values()
                    ],
                })

                for tc in tool_calls.values():
                    name = tc["name"]
                    try:
                        args = json.loads(tc["arguments"] or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    # Models emit literal `null` for no-argument tools, and some
                    # emit a bare list. Downstream code assumes a dict.
                    if not isinstance(args, dict):
                        args = {}

                    # The tool runner is a generator, not a coroutine, so the
                    # `confirm` event reaches the client *before* it blocks
                    # waiting on the answer. Buffering these would deadlock.
                    holder: Dict[str, Any] = {}
                    async for event in self._run_tool(name, args, holder):
                        yield event

                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "name": name,
                        "content": json.dumps(holder.get("value", {}))[:6000],
                    })
            else:
                # Loop exhausted without the model settling.
                yield json.dumps({
                    "type": "token",
                    "data": " I've hit my step limit on this one — tell me how to narrow it down.",
                })

            self._remember(session_id, spoken_reply)

        except Exception as e:
            logger.error("Agent loop failed: %s", e, exc_info=True)
            yield json.dumps({"type": "error", "data": self._explain(e)})

    async def _run_tool(
        self, name: str, args: Dict[str, Any], out: Dict[str, Any]
    ) -> AsyncGenerator[str, None]:
        """Execute one tool, gating destructive calls behind user confirmation.

        Yields stream events as they occur and stashes the tool's return value in
        `out["value"]` for the caller. It must stay a generator: the `confirm`
        event has to reach the client before we await the user's answer.
        """
        yield json.dumps({"type": "tool_start", "name": name, "args": args})

        prompt = needs_confirmation(name, args)
        if prompt:
            confirm_id = confirm.create(prompt, name)
            yield json.dumps(
                {"type": "confirm", "id": confirm_id, "prompt": prompt, "name": name}
            )
            # Surface the ask in the spoken stream too, so voice-only users hear it.
            yield json.dumps({"type": "token", "data": f" {prompt} "})

            approved = await confirm.wait(confirm_id)
            if approved is None:
                value = {
                    "status": "cancelled",
                    "message": "The user did not respond in time. The action was NOT performed. "
                               "Do not retry it without asking again.",
                }
            elif not approved:
                value = {
                    "status": "denied",
                    "message": "The user declined this action. Do not retry it. "
                               "Acknowledge briefly and move on.",
                }
            else:
                value = await handle_tool_call(name, args)
        else:
            value = await handle_tool_call(name, args)

        out["value"] = value
        yield json.dumps({
            "type": "tool_result",
            "name": name,
            "status": value.get("status", "unknown"),
            "message": str(value.get("message", ""))[:500],
        })

    def _explain(self, e: Exception) -> str:
        """Turn a provider exception into something worth reading."""
        if isinstance(e, (APIConnectionError, APITimeoutError)):
            if self.provider == "ollama":
                return f"Cannot reach Ollama at {settings.OLLAMA_BASE_URL}. Is it running?"
            return f"Cannot reach {self.provider}. Check your network connection."
        if isinstance(e, AuthenticationError):
            return f"{self.provider} rejected the API key. Check Backend/.env."
        if isinstance(e, RateLimitError):
            return f"{self.provider} rate limit hit. Wait a moment and retry."
        if isinstance(e, BadRequestError):
            return (
                f"{self.provider} rejected the request — often an unsupported tool schema "
                f"for model '{self.model}'. Details: {e}"
            )
        return f"{self.provider} error: {e}"


# Backwards-compatible alias used by api/v1/stream.py.
LLMService = LLMEngine
