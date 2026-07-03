import edge_tts
from typing import AsyncGenerator
import logging

logger = logging.getLogger(__name__)

class TTSService:
    @staticmethod
    async def synthesize(text: str, voice: str = "en-US-AriaNeural") -> AsyncGenerator[bytes, None]:
        """
        Synthesizes text to speech using edge-tts.
        Yields audio bytes as they are generated.
        """
        try:
            communicate = edge_tts.Communicate(text, voice)
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    yield chunk["data"]
        except Exception as e:
            logger.error(f"TTS Error: {e}")
            yield b""
