"""Web search and page reading.

Uses DuckDuckGo's no-JavaScript HTML endpoint so there's no API key to manage.
That endpoint is scraped, not contracted — if the markup shifts, `web_search`
degrades to an error the model can report, rather than returning wrong answers.
"""
import html
import re
import urllib.parse
from typing import Any, Dict, List

import httpx

from .registry import tool

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

_RESULT_RE = re.compile(
    r'<a rel="nofollow" class="result__a" href="(?P<url>[^"]+)".*?>(?P<title>.*?)</a>'
    r'.*?class="result__snippet".*?>(?P<snippet>.*?)</a>',
    re.DOTALL,
)

_TAG_RE = re.compile(r"<[^>]+>")
_SCRIPT_RE = re.compile(r"<(script|style|nav|footer|header)\b.*?</\1>", re.DOTALL | re.IGNORECASE)


def _clean(fragment: str) -> str:
    return html.unescape(_TAG_RE.sub("", fragment)).strip()


def _unwrap_ddg(url: str) -> str:
    """DuckDuckGo wraps results in a redirect; pull the real URL back out."""
    if "duckduckgo.com/l/" in url or url.startswith("//duckduckgo.com/l/"):
        parsed = urllib.parse.urlparse(url if url.startswith("http") else "https:" + url)
        target = urllib.parse.parse_qs(parsed.query).get("uddg")
        if target:
            return urllib.parse.unquote(target[0])
    if url.startswith("//"):
        return "https:" + url
    return url


@tool(
    name="web_search",
    description=(
        "Search the web and read the top results. Use for current facts, news, or "
        "prices — never guess those. Returns text; does not open a browser."
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "The search query."},
            "count": {"type": "integer", "description": "1-8, default 5."},
        },
        "required": ["query"],
    },
)
async def web_search(query: str, count: int = 5) -> Dict[str, Any]:
    count = max(1, min(8, int(count or 5)))
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.post(
                "https://html.duckduckgo.com/html/",
                data={"q": query},
                headers={"User-Agent": _UA},
            )
            resp.raise_for_status()
    except httpx.HTTPError as e:
        return {"status": "error", "message": f"Search request failed: {e}"}

    results: List[Dict[str, str]] = []
    for match in _RESULT_RE.finditer(resp.text):
        url = _unwrap_ddg(match.group("url"))
        # Sponsored results come back through DuckDuckGo's /y.js ad redirector.
        # They're advertising, not answers — the model must not cite them.
        if "duckduckgo.com/y.js" in url or "ad_domain=" in url:
            continue
        results.append({
            "title": _clean(match.group("title")),
            "url": url,
            "snippet": _clean(match.group("snippet")),
        })
        if len(results) >= count:
            break

    if not results:
        return {
            "status": "error",
            "message": "No results parsed. The search page layout may have changed — "
                       "say you couldn't retrieve results rather than inventing them.",
        }

    return {
        "status": "success",
        "query": query,
        "results": results,
        "message": f"{len(results)} result(s) for '{query}'.",
    }


@tool(
    name="fetch_page",
    description=(
        "Fetch a page and return its readable text."
    ),
    parameters={
        "type": "object",
        "properties": {"url": {"type": "string", "description": "The page URL."}},
        "required": ["url"],
    },
)
async def fetch_page(url: str) -> Dict[str, Any]:
    if not re.match(r"^https?://", url):
        url = "https://" + url
    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": _UA})
            resp.raise_for_status()
    except httpx.HTTPError as e:
        return {"status": "error", "message": f"Could not fetch {url}: {e}"}

    body = _SCRIPT_RE.sub(" ", resp.text)
    text = re.sub(r"\s+", " ", _clean(body))
    if len(text) > 8000:
        text = text[:8000] + " ...[truncated]"

    return {"status": "success", "url": str(resp.url), "content": text,
            "message": f"Fetched {len(text)} characters from {resp.url}."}
