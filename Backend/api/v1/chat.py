from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from services.llm import LLMEngine
from db.database import save_message
import json

router = APIRouter()

class ChatRequest(BaseModel):
    session_id: str
    message: str
    provider: Optional[str] = None

class ChatResponse(BaseModel):
    reply: str

@router.post("/", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """
    Standard synchronous chat endpoint.
    Not ideal for long generations due to timeouts, but useful for short queries.
    For production, prefer the WebSocket stream endpoint.
    """
    try:
        # Save user message
        await save_message(req.session_id, "user", req.message)
        
        full_reply = ""
        # We use the stream logic and aggregate it
        async for chunk_str in LLMEngine.stream_response(req.session_id, req.message, req.provider):
            data = json.loads(chunk_str)
            if data["type"] == "token":
                full_reply += data["data"]
                
        # Save assistant message
        await save_message(req.session_id, "assistant", full_reply)
        
        return ChatResponse(reply=full_reply)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
