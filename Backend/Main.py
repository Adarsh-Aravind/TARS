from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import uvicorn

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
# Explicitly allowing local development origins like localhost:3000 and localhost:5173
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ],
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
    uvicorn.run("Main:app", host="0.0.0.0", port=8000, reload=True)
