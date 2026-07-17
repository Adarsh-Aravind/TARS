from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging
import os
import uvicorn

from config import settings
from db.database import init_db
from middleware.error_handler import global_exception_handler
from middleware.rate_limiter import rate_limiter_middleware

# Routers
from api.chat import router as chat_router
from api.router import api_router

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialize the SQLite database.
    await init_db()
    yield
    # Shutdown


app = FastAPI(
    title="TARS Backend",
    description="Backend for the TARS cross-platform desktop AI assistant",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS Middleware (allow the local frontend to connect).
# allow_credentials must be False when allow_origins is "*", otherwise the
# combination is rejected by browsers per the CORS spec. We don't use cookies,
# so credentials aren't needed anyway.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add global error handler
app.add_exception_handler(Exception, global_exception_handler)

# Add rate limiter middleware
app.middleware("http")(rate_limiter_middleware)

# Include API routers.
# chat_router  -> live SSE + audio endpoints the desktop app actually calls.
# api_router   -> versioned REST/WebSocket stack (chat, stream, audio) with DB
#                 persistence. Both mount under /api with distinct paths.
app.include_router(chat_router, prefix="/api/v1")
app.include_router(api_router, prefix="/api")


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "provider": settings.LLM_PROVIDER,
        "model": settings.LLM_MODEL,
    }


if __name__ == "__main__":
    # Bind to loopback by default so the assistant (which can execute local
    # shell commands via tools) is never exposed to the LAN. Override with the
    # HOST env var only if you understand the risk.
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("Main:app", host=host, port=port, reload=True)
