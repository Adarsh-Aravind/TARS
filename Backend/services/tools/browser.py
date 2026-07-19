"""Playwright browser control — the fallback when deep links aren't enough.

`open_website` handles most requests by deep-linking into the user's own
browser. This module exists for the rest: tasks that need TARS to actually
click, type, and read a page back ("play the first video", "log in and check
my orders").

Important distinction for the model, and stated in every tool description: this
drives a *separate* Chromium window that TARS owns, not the user's daily
browser. It uses a persistent profile under ~/.tars/browser so logins survive
between sessions.

Playwright is an optional dependency. If it isn't installed, every tool here
returns an actionable error instead of raising, so the rest of TARS still works.
"""
import asyncio
import logging
from pathlib import Path
from typing import Any, Dict, Optional

from .registry import tool

logger = logging.getLogger(__name__)

PROFILE_DIR = Path.home() / ".tars" / "browser"

_playwright = None
_context = None
_page = None
_lock = asyncio.Lock()

_INSTALL_HINT = (
    "Browser automation is unavailable: Playwright is not installed. "
    "Run: pip install playwright && playwright install chromium"
)


async def _ensure_page():
    """Start (or reuse) the persistent browser context and return the active page."""
    global _playwright, _context, _page

    if _page is not None and not _page.is_closed():
        return _page

    try:
        from playwright.async_api import async_playwright
    except ImportError:
        raise RuntimeError(_INSTALL_HINT)

    if _playwright is None:
        _playwright = await async_playwright().start()

    if _context is None:
        PROFILE_DIR.mkdir(parents=True, exist_ok=True)
        _context = await _playwright.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            headless=False,          # the user should see what TARS is doing
            viewport={"width": 1280, "height": 800},
            args=["--disable-blink-features=AutomationControlled"],
        )

    _page = _context.pages[0] if _context.pages else await _context.new_page()
    return _page


async def shutdown() -> None:
    """Close the browser. Called from the FastAPI lifespan shutdown hook."""
    global _playwright, _context, _page
    try:
        if _context is not None:
            await _context.close()
        if _playwright is not None:
            await _playwright.stop()
    except Exception as e:
        logger.warning("Browser shutdown failed: %s", e)
    finally:
        _playwright = _context = _page = None


def _guard(fn):
    """Serialise browser access and turn Playwright faults into tool errors."""

    async def wrapper(*args, **kwargs):
        async with _lock:
            try:
                return await fn(*args, **kwargs)
            except RuntimeError as e:
                return {"status": "error", "message": str(e)}
            except Exception as e:
                return {"status": "error", "message": f"Browser action failed: {e}"}

    wrapper.__name__ = fn.__name__
    return wrapper


@tool(
    name="browser_open",
    description=(
        "Open a URL in TARS's own Chromium (NOT the user's browser). Only when the "
        "task needs clicking/typing/reading. Otherwise use open_website."
    ),
    parameters={
        "type": "object",
        "properties": {"url": {"type": "string", "description": "URL to open."}},
        "required": ["url"],
    },
)
@_guard
async def browser_open(url: str) -> Dict[str, Any]:
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    page = await _ensure_page()
    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
    await page.wait_for_timeout(1200)  # let client-rendered content settle
    text = (await page.inner_text("body"))[:4000]
    return {
        "status": "success",
        "url": page.url,
        "title": await page.title(),
        "content": text,
        "message": f"Opened {page.url}",
    }


@tool(
    name="browser_click",
    description=(
        "Click an element on TARS's open page, by visible text."
    ),
    parameters={
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "Visible text to click."},
            "index": {"type": "integer", "description": "Nth match, default 0."},
        },
        "required": ["text"],
    },
)
@_guard
async def browser_click(text: str, index: int = 0) -> Dict[str, Any]:
    page = await _ensure_page()

    # Try progressively looser strategies: an exact role match reads intent best,
    # a substring match catches the rest.
    candidates = [
        page.get_by_role("link", name=text),
        page.get_by_role("button", name=text),
        page.get_by_text(text),
    ]
    for locator in candidates:
        try:
            target = locator.nth(int(index or 0))
            if await target.count() == 0:
                continue
            await target.click(timeout=8000)
            await page.wait_for_timeout(1500)
            return {
                "status": "success",
                "url": page.url,
                "title": await page.title(),
                "content": (await page.inner_text("body"))[:3000],
                "message": f"Clicked '{text}'.",
            }
        except Exception:
            continue

    return {"status": "error", "message": f"Nothing matching '{text}' was clickable on this page."}


@tool(
    name="browser_type",
    description=(
        "Type into a field on TARS's open page."
    ),
    parameters={
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "Text to type."},
            "field": {"type": "string", "description": "Placeholder/label; omit for main input."},
            "submit": {"type": "boolean", "description": "Press Enter, default true."},
        },
        "required": ["text"],
    },
)
@_guard
async def browser_type(text: str, field: Optional[str] = None, submit: bool = True) -> Dict[str, Any]:
    page = await _ensure_page()

    locator = None
    if field:
        for candidate in (page.get_by_placeholder(field), page.get_by_label(field)):
            if await candidate.count() > 0:
                locator = candidate.first
                break
    if locator is None:
        # Fall back to the first visible text-ish input on the page.
        generic = page.locator(
            "input[type='search'], input[type='text'], textarea, [contenteditable='true']"
        )
        if await generic.count() == 0:
            return {"status": "error", "message": "No text input found on this page."}
        locator = generic.first

    await locator.click(timeout=8000)
    await locator.fill(text, timeout=8000)
    if submit:
        await locator.press("Enter")
        await page.wait_for_timeout(2000)

    return {
        "status": "success",
        "url": page.url,
        "content": (await page.inner_text("body"))[:3000],
        "message": f"Typed '{text}'" + (" and submitted." if submit else "."),
    }


@tool(
    name="browser_read",
    description="Read the text of TARS's currently open page.",
    parameters={"type": "object", "properties": {}, "required": []},
)
@_guard
async def browser_read() -> Dict[str, Any]:
    page = await _ensure_page()
    return {
        "status": "success",
        "url": page.url,
        "title": await page.title(),
        "content": (await page.inner_text("body"))[:6000],
        "message": f"Read {page.url}",
    }
