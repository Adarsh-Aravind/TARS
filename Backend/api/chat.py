import json
import asyncio
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

from services.llm import LLMService
from services.voice import voice_engine

router = APIRouter(tags=["chat"])

@router.on_event("startup")
async def startup_event():
    # Start the background wake word listener
    voice_engine.start()

@router.on_event("shutdown")
async def shutdown_event():
    voice_engine.stop()

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

    # Extract the latest user message for the new LLMEngine
    user_message = ""
    for msg in reversed(request.messages):
        if msg.role == "user":
            user_message = msg.content
            break

    if not user_message:
        raise HTTPException(status_code=400, detail="No user message found.")

    async def sse_generator():
        try:
            async for chunk_str in LLMService.stream_response("default_sse_session", user_message):
                chunk = json.loads(chunk_str)
                if chunk.get("type") == "token":
                    # Format as Server-Sent Events (SSE)
                    yield f"data: {json.dumps({'chunk': chunk['data']})}\n\n"
                elif chunk.get("type") == "error":
                    yield f"event: error\ndata: {json.dumps({'detail': chunk['data']})}\n\n"
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

import edge_tts
import speech_recognition as sr

@router.get("/events")
async def sse_events():
    """
    Streams system events to the frontend (e.g. wakeup).
    """
    async def event_stream():
        while True:
            if voice_engine.wakeup_event.is_set():
                voice_engine.wakeup_event.clear()
                yield "event: wakeup\ndata: {}\n\n"
            await asyncio.sleep(0.5)
    return StreamingResponse(event_stream(), media_type="text/event-stream")

@router.get("/audio/listen")
async def listen_for_command():
    """
    Called by frontend when woken up. Records for a few seconds and transcribes.
    """
    voice_engine.stop()
    text = ""
    try:
        import sounddevice as sd
        import speech_recognition as sr
        
        recognizer = sr.Recognizer()
        samplerate = 16000
        duration = 5.0
        
        print("[TARS] Listening for command...", flush=True)
        audio_data = sd.rec(int(samplerate * duration), samplerate=samplerate, channels=1, dtype='int16')
        sd.wait()
        
        raw_audio = audio_data.tobytes()
        audio = sr.AudioData(raw_audio, samplerate, 2)
        text = recognizer.recognize_google(audio)
        print(f"[TARS] Heard: {text}", flush=True)
    except Exception as e:
        import logging
        logging.error(f"Error during command listening: {e}")
    finally:
        voice_engine.start()
        
    return {"text": text}

from fastapi.responses import Response

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
        import logging
        logging.error(f"Error generating TARS TTS: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
