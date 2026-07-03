import aiosqlite
import json
from typing import List, Optional
from config import settings
from .models import ChatMessageResponse

async def init_db():
    async with aiosqlite.connect(settings.SQLITE_PATH) as db:
        await db.execute('''
            CREATE TABLE IF NOT EXISTS chat_sessions (
                session_id TEXT PRIMARY KEY,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        await db.execute('''
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                role TEXT NOT NULL,
                content TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                tool_calls_json TEXT,
                FOREIGN KEY (session_id) REFERENCES chat_sessions(session_id)
            )
        ''')
        await db.commit()

async def get_db_connection() -> aiosqlite.Connection:
    """Dependency for yielding an active aiosqlite connection."""
    conn = await aiosqlite.connect(settings.SQLITE_PATH)
    conn.row_factory = aiosqlite.Row
    return conn

async def save_message(
    session_id: str, 
    role: str, 
    content: Optional[str] = None, 
    tool_calls_json: Optional[str] = None
):
    """Saves a single message to the DB. Ensures the session exists first."""
    async with aiosqlite.connect(settings.SQLITE_PATH) as db:
        # Ensure session exists
        await db.execute('''
            INSERT OR IGNORE INTO chat_sessions (session_id) VALUES (?)
        ''', (session_id,))
        
        await db.execute('''
            INSERT INTO chat_messages (session_id, role, content, tool_calls_json)
            VALUES (?, ?, ?, ?)
        ''', (session_id, role, content, tool_calls_json))
        await db.commit()

async def get_session_history(session_id: str, limit: int = 50) -> List[ChatMessageResponse]:
    """Retrieves the recent history for a session."""
    async with aiosqlite.connect(settings.SQLITE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute('''
            SELECT id, session_id, role, content, timestamp, tool_calls_json 
            FROM chat_messages 
            WHERE session_id = ? 
            ORDER BY timestamp DESC 
            LIMIT ?
        ''', (session_id, limit)) as cursor:
            rows = await cursor.fetchall()
            
            # Reverse to return in chronological order
            messages = [ChatMessageResponse(**dict(row)) for row in reversed(rows)]
            return messages
