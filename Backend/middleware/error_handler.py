from fastapi import Request
from fastapi.responses import JSONResponse
import logging
import traceback
from datetime import datetime

logger = logging.getLogger(__name__)

async def global_exception_handler(request: Request, exc: Exception):
    """
    Catches any unhandled exception, logs the traceback server-side,
    and returns a clean, generic JSON error to the client.
    """
    error_msg = f"Unhandled Exception on {request.method} {request.url.path}"
    logger.error(error_msg)
    logger.error(traceback.format_exc())

    # If it's a known HTTP exception, let FastAPI handle it natively,
    # or handle it specifically if we want to override.
    # We will just catch standard exceptions here.

    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal Server Error",
            "detail": str(exc) if not isinstance(exc, Exception) else "An unexpected error occurred.",
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
    )
