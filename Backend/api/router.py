from fastapi import APIRouter
from .v1 import chat, stream, audio

api_router = APIRouter()

api_router.include_router(chat.router, prefix="/v1/chat", tags=["chat"])
api_router.include_router(stream.router, prefix="/v1/stream", tags=["stream"])
api_router.include_router(audio.router, prefix="/v1/audio", tags=["audio"])
