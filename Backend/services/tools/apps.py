"""Launching applications and opening web destinations.

Two distinct tools, and the split matters:

  launch_app   — native applications, resolved per-platform.
  open_website — URLs in the *user's own default browser*, with deep-link
                 intents so "open youtube and search lofi" is one call that
                 lands on the results page, not the homepage.

Deep links are how we satisfy most "open X and do Y" requests without driving a
browser at all. Playwright (browser.py) is the fallback for the cases that
genuinely need clicking.
"""
import asyncio
import os
import re
import shutil
import sys
import urllib.parse
from typing import Any, Dict, Optional

from .registry import tool

IS_WIN = sys.platform == "win32"
IS_MAC = sys.platform == "darwin"

# --------------------------------------------------------------------------
# Native application resolution
# --------------------------------------------------------------------------
# Spoken names -> what each platform actually calls the thing. Keys are
# lowercase and matched after normalisation.
_APP_ALIASES = {
    "win32": {
        "file explorer": "explorer", "explorer": "explorer", "finder": "explorer",
        "files": "explorer", "calculator": "calc", "calc": "calc",
        "notepad": "notepad", "text editor": "notepad",
        "terminal": "wt", "command prompt": "cmd", "cmd": "cmd",
        "powershell": "powershell", "task manager": "taskmgr",
        "settings": "ms-settings:", "control panel": "control",
        "paint": "mspaint", "snipping tool": "snippingtool",
        "vs code": "code", "vscode": "code", "code": "code",
        "spotify": "spotify", "discord": "discord", "steam": "steam",
        "chrome": "chrome", "edge": "msedge", "firefox": "firefox",
    },
    "darwin": {
        "file explorer": "Finder", "explorer": "Finder", "finder": "Finder",
        "files": "Finder", "calculator": "Calculator", "calc": "Calculator",
        "notepad": "TextEdit", "text editor": "TextEdit", "notes": "Notes",
        "terminal": "Terminal", "iterm": "iTerm",
        "task manager": "Activity Monitor", "activity monitor": "Activity Monitor",
        "settings": "System Settings", "system preferences": "System Settings",
        "preview": "Preview", "mail": "Mail", "messages": "Messages",
        "vs code": "Visual Studio Code", "vscode": "Visual Studio Code",
        "code": "Visual Studio Code",
        "spotify": "Spotify", "discord": "Discord", "steam": "Steam",
        "chrome": "Google Chrome", "safari": "Safari", "firefox": "Firefox",
    },
    "linux": {
        "file explorer": "xdg-open", "explorer": "xdg-open", "files": "nautilus",
        "calculator": "gnome-calculator", "calc": "gnome-calculator",
        "notepad": "gedit", "text editor": "gedit",
        "terminal": "x-terminal-emulator",
        "task manager": "gnome-system-monitor",
        "settings": "gnome-control-center",
        "vs code": "code", "vscode": "code", "code": "code",
        "chrome": "google-chrome", "firefox": "firefox",
    },
}


def _platform_key() -> str:
    if IS_WIN:
        return "win32"
    if IS_MAC:
        return "darwin"
    return "linux"


def _resolve_app(name: str) -> str:
    table = _APP_ALIASES[_platform_key()]
    key = re.sub(r"\s+", " ", name.lower().strip())
    return table.get(key, name.strip())


# --------------------------------------------------------------------------
# Web deep links
# --------------------------------------------------------------------------
# site -> (base_url_when_no_query, search_url_template). {q} is URL-encoded.
_SITES = {
    "youtube": ("https://www.youtube.com", "https://www.youtube.com/results?search_query={q}"),
    "google": ("https://www.google.com", "https://www.google.com/search?q={q}"),
    "maps": ("https://maps.google.com", "https://www.google.com/maps/search/{q}"),
    "gmail": ("https://mail.google.com", "https://mail.google.com/mail/u/0/#search/{q}"),
    "drive": ("https://drive.google.com", "https://drive.google.com/drive/search?q={q}"),
    "github": ("https://github.com", "https://github.com/search?q={q}"),
    "spotify": ("https://open.spotify.com", "https://open.spotify.com/search/{q}"),
    "wikipedia": ("https://www.wikipedia.org", "https://en.wikipedia.org/w/index.php?search={q}"),
    "amazon": ("https://www.amazon.com", "https://www.amazon.com/s?k={q}"),
    "reddit": ("https://www.reddit.com", "https://www.reddit.com/search/?q={q}"),
    "x": ("https://x.com", "https://x.com/search?q={q}"),
    "twitter": ("https://x.com", "https://x.com/search?q={q}"),
    "linkedin": ("https://www.linkedin.com", "https://www.linkedin.com/search/results/all/?keywords={q}"),
    "stackoverflow": ("https://stackoverflow.com", "https://stackoverflow.com/search?q={q}"),
    "netflix": ("https://www.netflix.com", "https://www.netflix.com/search?q={q}"),
    "chatgpt": ("https://chat.openai.com", "https://chat.openai.com/?q={q}"),
    "claude": ("https://claude.ai", "https://claude.ai/new?q={q}"),
    "translate": ("https://translate.google.com", "https://translate.google.com/?text={q}"),
    "news": ("https://news.google.com", "https://news.google.com/search?q={q}"),
}


def _build_url(site: Optional[str], query: Optional[str], url: Optional[str]) -> Optional[str]:
    if url:
        if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", url):
            url = "https://" + url
        return url
    if not site:
        return None
    key = site.lower().strip()
    if key not in _SITES:
        # Unknown site name — treat it as a bare domain.
        base = "https://" + key if "." in key else None
        if base and query:
            return f"https://www.google.com/search?q={urllib.parse.quote_plus(key + ' ' + query)}"
        return base
    home, search = _SITES[key]
    if query:
        return search.format(q=urllib.parse.quote_plus(query))
    return home


async def _open_native(target: str) -> None:
    """Hand a URL or app name to the OS's default opener."""
    if IS_WIN:
        await asyncio.to_thread(os.startfile, target)
    elif IS_MAC:
        proc = await asyncio.create_subprocess_exec(
            "open", target,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.communicate()
    else:
        proc = await asyncio.create_subprocess_exec(
            "xdg-open", target,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.communicate()


@tool(
    name="launch_app",
    description=(
        "Open a native desktop app by its everyday name (spotify, calculator, "
        "vs code, terminal). For web pages use open_website."
    ),
    parameters={
        "type": "object",
        "properties": {
            "app_name": {"type": "string", "description": "e.g. 'calculator'."}
        },
        "required": ["app_name"],
    },
)
async def launch_app(app_name: str) -> Dict[str, Any]:
    resolved = _resolve_app(app_name)

    # Reject shell metacharacters — this value reaches the OS opener.
    if re.search(r"[;&|`$<>\n\r]", resolved):
        return {"status": "error", "message": f"Refusing unsafe app name: {app_name}"}

    try:
        if IS_MAC:
            proc = await asyncio.create_subprocess_exec(
                "open", "-a", resolved,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await proc.communicate()
            if proc.returncode != 0:
                return {
                    "status": "error",
                    "message": f"macOS could not open '{resolved}': "
                               f"{stderr.decode(errors='replace').strip()}",
                }
            return {"status": "success", "message": f"Opened {resolved}"}

        if IS_WIN:
            await _open_native(resolved)
            return {"status": "success", "message": f"Opened {resolved}"}

        # Linux: prefer the real binary, fall back to the desktop opener.
        if shutil.which(resolved):
            await asyncio.create_subprocess_exec(
                resolved,
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
            )
            return {"status": "success", "message": f"Opened {resolved}"}
        await _open_native(resolved)
        return {"status": "success", "message": f"Opened {resolved}"}
    except FileNotFoundError:
        return {
            "status": "error",
            "message": f"'{app_name}' is not installed or not on PATH. "
                       f"Tell the user it isn't available.",
        }
    except OSError as e:
        return {"status": "error", "message": f"Could not open '{app_name}': {e}"}


@tool(
    name="open_website",
    description=(
        "Open a web page in the user's default browser. Prefer this over browser_*. "
        "site+query deep-links to results (site='youtube', query='lofi' opens that "
        "search). Sites: " + ",".join(sorted(_SITES)) + ". Or pass url."
    ),
    parameters={
        "type": "object",
        "properties": {
            "site": {"type": "string", "description": "e.g. 'youtube', 'maps'."},
            "query": {"type": "string", "description": "Search text for that site."},
            "url": {"type": "string", "description": "Explicit URL instead of site."},
        },
        "required": [],
    },
)
async def open_website(
    site: Optional[str] = None,
    query: Optional[str] = None,
    url: Optional[str] = None,
) -> Dict[str, Any]:
    target = _build_url(site, query, url)
    if not target:
        return {
            "status": "error",
            "message": "Provide either a `url`, or a `site` (optionally with `query`).",
        }
    try:
        await _open_native(target)
        return {"status": "success", "message": f"Opened {target}", "url": target}
    except OSError as e:
        return {"status": "error", "message": f"Could not open {target}: {e}"}
