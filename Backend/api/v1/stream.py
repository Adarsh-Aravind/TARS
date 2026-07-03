from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict
from services.llm import LLMEngine
from db.database import save_message
import json
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

# Connection manager could be expanded if we need broadcast
active_connections: Dict[str, WebSocket] = {}

@router.websocket("/")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    session_id = "default" # Can be updated from client messages
    
    try:
        while True:
            data_str = await websocket.receive_text()
            data = json.loads(data_str)
            
            session_id = data.get("session_id", session_id)
            user_message = data.get("message", "")
            provider = data.get("provider")

            if not user_message:
                continue
                
            # Save user message
            await save_message(session_id, "user", user_message)

            full_reply = ""
            tool_calls = []
            
            # Stream response
            async for chunk_str in LLMEngine.stream_response(session_id, user_message, provider):
                chunk = json.loads(chunk_str)
                await websocket.send_text(chunk_str)
                
                if chunk["type"] == "token":
                    full_reply += chunk["data"]
                elif chunk["type"] == "tool_call":
                    tool_calls.append({
                        "name": chunk["name"],
                        "args": chunk["args"]
                    })
                    
            # Save assistant message
            await save_message(
                session_id, 
                "assistant", 
                full_reply, 
                json.dumps(tool_calls) if tool_calls else None
            )
            
    except WebSocketDisconnect:
        logger.info(f"Client disconnected from session {session_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        try:
            await websocket.send_text(json.dumps({"type": "error", "data": str(e)}))
            await websocket.close()
        except:
            pass
