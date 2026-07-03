from pydantic import BaseModel
from typing import List, Optional, Any
from datetime import datetime

class ChatSessionCreate(BaseModel):
    session_id: str

class ChatSessionResponse(BaseModel):
    session_id: str
    created_at: str

class ChatMessageCreate(BaseModel):
    session_id: str
    role: str  # 'user', 'assistant', 'system', 'tool'
    content: Optional[str] = None
    tool_calls_json: Optional[str] = None

class ChatMessageResponse(BaseModel):
    id: int
    session_id: str
    role: str
    content: Optional[str] = None
    timestamp: str
    tool_calls_json: Optional[str] = None
