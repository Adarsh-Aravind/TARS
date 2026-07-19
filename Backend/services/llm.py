import json
import logging
from typing import List, Dict, Any, Optional, AsyncGenerator
from openai import (
    AsyncOpenAI,
    APIConnectionError,
    APITimeoutError,
    AuthenticationError,
    RateLimitError,
)

from config import settings
from services.tools import handle_tool_call, TOOLS_SCHEMA
from services import personality

logger = logging.getLogger(__name__)


class LLMEngine:
    """
    LLM abstraction used by api/chat.py and api/v1/stream.py.

    Renamed from LLMService -> LLMEngine (that was the naming mismatch
    noted in project_summary.md). The interface below matches how both
    callers already invoke it:

        async for chunk_str in LLMEngine.stream_response(session_id, user_message, provider):
            chunk = json.loads(chunk_str)   # {"type": "token", "data": ...}
                                             # {"type": "tool_call", "name": ..., "args": ...}
                                             # {"type": "error", "data": ...}
    """

    _instance: Optional["LLMEngine"] = None

    # Per-session rolling history, kept in memory so the rolling window
    # actually has something to roll over. Swap this for a call into
    # db.database (e.g. get_session_messages(session_id)) once that
    # helper is exposed, so history survives a backend restart.
    _session_history: Dict[str, List[Dict[str, str]]] = {}

    def __init__(self, provider: Optional[str] = None):
        active_provider = provider or settings.LLM_PROVIDER

        if active_provider == "groq":
            # Groq serves an OpenAI-compatible API, so the SDK works unchanged —
            # only the base URL and key differ.
            if not settings.GROQ_API_KEY:
                raise RuntimeError(
                    "LLM_PROVIDER=groq but GROQ_API_KEY is unset. "
                    "Copy Backend/.env.example to Backend/.env and set it."
                )
            self.client = AsyncOpenAI(
                base_url=settings.GROQ_BASE_URL,
                api_key=settings.GROQ_API_KEY,
            )
        elif active_provider == "ollama":
            self.client = AsyncOpenAI(
                base_url=settings.OLLAMA_BASE_URL + "/v1",
                api_key="ollama",  # required by the SDK, ignored by Ollama
            )
        elif active_provider == "gemini":
            # Gemini exposes an OpenAI-compatible endpoint; point the SDK at it
            # explicitly, otherwise it would hit OpenAI's default base URL.
            self.client = AsyncOpenAI(
                base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
                api_key=settings.GEMINI_API_KEY,
            )
        else:  # openai
            self.client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

        self.provider = active_provider
        self.model = settings.LLM_MODEL
        self.temperature = settings.TEMPERATURE
        self.max_history_turns = 10  # rolling context window (5-10 turns)

    @classmethod
    def _get_instance(cls, provider: Optional[str] = None) -> "LLMEngine":
        # Rebuild the client if a call explicitly asks for a different provider.
        if cls._instance is None or (provider and provider != cls._instance.provider):
            cls._instance = cls(provider)
        return cls._instance

    def _apply_rolling_window(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if len(messages) <= self.max_history_turns:
            return messages
        has_system = messages[0].get("role") == "system"
        if has_system:
            return [messages[0]] + messages[-(self.max_history_turns - 1):]
        return messages[-self.max_history_turns:]

    def _build_messages(self, session_id: str, user_message: str) -> List[Dict[str, Any]]:
        history = self._session_history.setdefault(
            session_id, [{"role": "system", "content": ""}]
        )
        # Rebuild the system prompt every turn: the personality dials can be
        # changed mid-conversation (via the set_personality tool), and a stale
        # system message would keep the old settings until the next restart.
        history[0] = {"role": "system", "content": personality.build_system_prompt()}
        history.append({"role": "user", "content": user_message})
        # Trim the *stored* history in place, not just the returned copy —
        # otherwise the in-memory history grows unbounded for the lifetime of
        # the process (one entry per turn, forever).
        trimmed = self._apply_rolling_window(history)
        self._session_history[session_id] = trimmed
        return trimmed

    @classmethod
    async def stream_response(
        cls, session_id: str, user_message: str, provider: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        self = cls._get_instance(provider)
        messages = self._build_messages(session_id, user_message)
        full_reply = ""
        tool_calls = {}

        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=self.temperature,
                stream=True,
                tools=TOOLS_SCHEMA,
            )

            async for chunk in response:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta

                if getattr(delta, "content", None):
                    full_reply += delta.content
                    yield json.dumps({"type": "token", "data": delta.content})

                if getattr(delta, "tool_calls", None):
                    for tc in delta.tool_calls:
                        idx = tc.index
                        if idx not in tool_calls:
                            tool_calls[idx] = {"id": tc.id, "name": tc.function.name, "arguments": ""}
                        if tc.function.arguments:
                            tool_calls[idx]["arguments"] += tc.function.arguments

            # Execute tools if requested
            if tool_calls:
                assistant_message = {"role": "assistant", "content": None, "tool_calls": []}
                for idx, tc in tool_calls.items():
                    assistant_message["tool_calls"].append({
                        "id": tc["id"],
                        "type": "function",
                        "function": {
                            "name": tc["name"],
                            "arguments": tc["arguments"]
                        }
                    })
                messages.append(assistant_message)

                for idx, tc in tool_calls.items():
                    name = tc["name"]
                    try:
                        args = json.loads(tc["arguments"])
                    except json.JSONDecodeError:
                        args = {}

                    # Structured tool-call event (consumed by the WebSocket
                    # stream endpoint for persistence); ignored by SSE clients.
                    yield json.dumps({"type": "tool_call", "name": name, "args": args})

                    yield json.dumps({"type": "token", "data": f"\n\n*(System: Executing {name}...)*\n"})
                    
                    result = await handle_tool_call(name, args)
                    
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "name": name,
                        "content": json.dumps(result)
                    })

                # Follow-up LLM stream after tools
                follow_up = await self.client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    temperature=self.temperature,
                    stream=True,
                    tools=TOOLS_SCHEMA
                )
                async for chunk in follow_up:
                    if not chunk.choices:
                        continue
                    delta = chunk.choices[0].delta
                    if getattr(delta, "content", None):
                        full_reply += delta.content
                        yield json.dumps({"type": "token", "data": delta.content})

            if full_reply:
                self._session_history[session_id].append(
                    {"role": "assistant", "content": full_reply}
                )

        except Exception as e:
            logger.error(f"Error in LLM stream: {e}", exc_info=True)
            # Distinguish "can't reach the provider" from "the provider answered
            # with an error" — the old catch-all blamed connectivity for what
            # were often schema/auth/rate-limit failures, which sends you
            # debugging the wrong thing.
            if isinstance(e, (APIConnectionError, APITimeoutError)):
                if self.provider == "ollama":
                    detail = f"Cannot reach Ollama at {settings.OLLAMA_BASE_URL}. Is it running?"
                else:
                    detail = f"Cannot reach {self.provider}. Check your network connection."
            elif isinstance(e, AuthenticationError):
                detail = f"{self.provider} rejected the API key. Check your .env."
            elif isinstance(e, RateLimitError):
                detail = f"{self.provider} rate limit hit. Wait a moment and retry."
            else:
                detail = f"{self.provider} error: {e}"
            yield json.dumps({"type": "error", "data": detail})

# Backwards-compatible alias
LLMService = LLMEngine
