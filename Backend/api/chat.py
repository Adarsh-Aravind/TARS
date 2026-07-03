import json
import asyncio
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

from services.llm import LLMService

router = APIRouter(tags=["chat"])

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[ChatMessage]

llm_service = LLMService()

@router.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    """
    Accepts conversation history and streams text chunks back to the frontend using SSE.
    """
    if not request.messages:
        raise HTTPException(status_code=400, detail="Messages list cannot be empty.")

    # Convert Pydantic models to dicts for the service layer
    messages_dict = [{"role": msg.role, "content": msg.content} for msg in request.messages]

    async def sse_generator():
        try:
            async for chunk in llm_service.stream_response(messages_dict):
                # Format as Server-Sent Events (SSE)
                yield f"data: {json.dumps({'chunk': chunk})}\n\n"
        except asyncio.CancelledError:
            # Client disconnected abruptly. Silence the error and exit cleanly.
            pass
        except Exception as e:
            # Secure server-side logging
            import logging
            logging.error(f"LLM Stream Error: {e}", exc_info=True)
            # Send an error event if something fails during streaming
            yield f"event: error\ndata: {json.dumps({'detail': 'An internal LLM connection error occurred.'})}\n\n"
        finally:
            if not asyncio.current_task().cancelled():
                # Send a done event
                yield "event: done\ndata: {}\n\n"

    return StreamingResponse(sse_generator(), media_type="text/event-stream")

@router.post("/audio/transcribe")
async def transcribe_audio():
    """
    Stub for audio transcription (e.g., local Faster-Whisper).
    """
    return {"status": "stub", "message": "Transcription endpoint not fully implemented yet."}

@router.post("/audio/synthesize")
async def synthesize_audio():
    """
    Stub for audio synthesis (e.g., Edge-TTS).
    """
    return {"status": "stub", "message": "Synthesis endpoint not fully implemented yet."}
