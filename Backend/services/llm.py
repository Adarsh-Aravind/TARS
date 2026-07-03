import asyncio
import json
import logging
from typing import List, Dict, Any, AsyncGenerator
from openai import AsyncOpenAI
import litellm

from config import settings
from services.tools import handle_tool_call

logger = logging.getLogger(__name__)

# A strict system prompt designed to prevent hallucinations and enforce strict tool usage.
SYSTEM_PROMPT = """You are TARS, an elite desktop OS automated assistant execution backend. 
You are highly logical, efficient, and slightly sarcastic (Humor setting: 75%). 
You are completely honest (Honesty setting: 90%).
You communicate decisions strictly using the provided tools. 
Do not guess or hallucinate parameters. 
If a required action lacks a tool, report it cleanly without formatting empty commands."""

class LLMService:
    def __init__(self):
        # We use litellm or openai directly. Using OpenAI SDK for compatibility with Ollama
        if settings.LLM_PROVIDER == "ollama":
            self.client = AsyncOpenAI(
                base_url=settings.OLLAMA_BASE_URL + "/v1",
                api_key="ollama" # Required but ignored
            )
        else:
            self.client = AsyncOpenAI(
                api_key=settings.OPENAI_API_KEY if settings.LLM_PROVIDER == "openai" else settings.GEMINI_API_KEY
            )
        
        self.model = settings.LLM_MODEL
        self.temperature = settings.TEMPERATURE
        self.max_history_turns = 10  # Enforce rolling context window (5-10 turns)

    def _apply_rolling_window(self, messages: List[Dict[str, str]]) -> List[Dict[str, str]]:
        """
        Enforce a strict rolling context window to keep the local context clean.
        """
        if len(messages) <= self.max_history_turns:
            return messages
        
        # Always keep the first message if it's the system prompt
        has_system = messages[0].get("role") == "system"
        if has_system:
            return [messages[0]] + messages[-(self.max_history_turns - 1):]
        else:
            return messages[-self.max_history_turns:]

    async def stream_response(self, messages: List[Dict[str, str]]) -> AsyncGenerator[str, None]:
        """
        Streams response from the LLM, handling tool calls implicitly if needed.
        """
        # Ensure system prompt is injected
        if not messages or messages[0].get("role") != "system":
            messages.insert(0, {"role": "system", "content": SYSTEM_PROMPT})
            
        messages = self._apply_rolling_window(messages)

        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=self.temperature,
                stream=True
            )
            
            async for chunk in response:
                if chunk.choices and chunk.choices[0].delta.content is not None:
                    yield chunk.choices[0].delta.content
                    
        except Exception as e:
            logger.error(f"Error in LLM stream: {e}", exc_info=True)
            yield f"\n[System Error: LLM connection failed. Ensure {settings.LLM_PROVIDER} is running.]\n"
