from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import uvicorn
import os

from config import settings
from db.database import init_db
from middleware.error_handler import global_exception_handler
from middleware.rate_limiter import rate_limiter_middleware

# Routers
from api.chat import router as chat_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Initialize the SQLite database
    await init_db()
    yield
    # Shutdown logic goes here
    pass

app = FastAPI(
    title="TARS Backend",
    description="Backend for the TARS cross-platform desktop AI assistant",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS Middleware (Allow frontend to connect)
# Safe for local usage since it binds to 127.0.0.1
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add global error handler
app.add_exception_handler(Exception, global_exception_handler)

# Add rate limiter middleware
app.middleware("http")(rate_limiter_middleware)

# Include API routers
app.include_router(chat_router, prefix="/api/v1")

@app.get("/health")
async def health_check():
    return {
        "status": "ok", 
        "provider": settings.LLM_PROVIDER,
        "model": settings.LLM_MODEL
    }

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("Main:app", host="127.0.0.1", port=port, reload=True)
