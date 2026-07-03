from fastapi import Request
from fastapi.responses import JSONResponse
import time
from collections import defaultdict
from config import settings

# In-memory store: { ip_address: [timestamp1, timestamp2, ...] }
request_log = defaultdict(list)

async def rate_limiter_middleware(request: Request, call_next):
    """
    Sliding window rate limiter based on client IP.
    Restricts requests per minute to RATE_LIMIT_RPM defined in config.
    """
    client_ip = request.client.host if request.client else "unknown"
    current_time = time.time()
    
    # Clean up requests older than 60 seconds for this IP
    request_log[client_ip] = [ts for ts in request_log[client_ip] if current_time - ts < 60]
    
    if len(request_log[client_ip]) >= settings.RATE_LIMIT_RPM:
        return JSONResponse(
            status_code=429,
            content={"error": "Too Many Requests", "detail": "Rate limit exceeded."},
            headers={"Retry-After": "60"}
        )
    
    # Log current request
    request_log[client_ip].append(current_time)
    
    response = await call_next(request)
    return response
