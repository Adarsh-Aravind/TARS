import json
import asyncio
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel
from typing import List

from services.llm import LLMService
from db.database import save_message

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])

# Fixed session id for the desktop overlay's SSE stream. The rolling context
# window lives server-side in LLMService keyed by this id.
SSE_SESSION_ID = "default_sse_session"


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage]


@router.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    """
    Accepts conversation history and streams text chunks back to the frontend using SSE.
    """
    if not request.messages:
        raise HTTPException(status_code=400, detail="Messages list cannot be empty.")

    # Extract the latest user message for the LLM engine.
    user_message = ""
    for msg in reversed(request.messages):
        if msg.role == "user":
            user_message = msg.content
            break

    if not user_message:
        raise HTTPException(status_code=400, detail="No user message found.")

    async def sse_generator():
        # Persist the user turn up front so history survives a crash mid-stream.
        try:
            await save_message(SSE_SESSION_ID, "user", user_message)
        except Exception as e:
            logger.error(f"Failed to persist user message: {e}")

        assistant_reply = ""
        cancelled = False
        try:
            async for chunk_str in LLMService.stream_response(SSE_SESSION_ID, user_message):
                chunk = json.loads(chunk_str)
                if chunk.get("type") == "token":
                    assistant_reply += chunk["data"]
                    # Format as Server-Sent Events (SSE)
                    yield f"data: {json.dumps({'chunk': chunk['data']})}\n\n"
                elif chunk.get("type") == "error":
                    yield f"event: error\ndata: {json.dumps({'detail': chunk['data']})}\n\n"

            # Normal completion: persist the assistant turn.
            if assistant_reply:
                try:
                    await save_message(SSE_SESSION_ID, "assistant", assistant_reply)
                except Exception as e:
                    logger.error(f"Failed to persist assistant message: {e}")
        except asyncio.CancelledError:
            # Client disconnected abruptly. Silence the error and exit cleanly.
            cancelled = True
        except Exception as e:
            # Secure server-side logging
            logger.error(f"LLM Stream Error: {e}", exc_info=True)
            yield f"event: error\ndata: {json.dumps({'detail': 'An internal LLM connection error occurred.'})}\n\n"
        finally:
            if not cancelled:
                yield "event: done\ndata: {}\n\n"

    return StreamingResponse(sse_generator(), media_type="text/event-stream")





@router.get("/audio/tars-tts")
async def tars_tts(text: str):
    """
    Synthesize TARS voice with Kokoro and Pedalboard effects.
    """
    try:
        from services.tars_voice import generate_tars_speech
        wav_bytes = generate_tars_speech(text)
        return Response(content=wav_bytes, media_type="audio/wav")
    except Exception as e:
        logger.error(f"Error generating TARS TTS: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
