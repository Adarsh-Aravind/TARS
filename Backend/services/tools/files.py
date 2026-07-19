"""File operations, scoped to the user's home directory.

Everything here resolves paths through `_safe_path`, which expands `~`, follows
symlinks, and then refuses anything that escapes the home directory. That keeps
a hallucinated path from reaching system files, and it means the confirmation
prompts only ever have to cover the user's own data.
"""
import asyncio
import os
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional

from .registry import tool
from .risk import always, path_write_risk

HOME = Path.home().resolve()

# Well-known folders so the model can say "desktop" instead of a full path.
_SHORTCUTS = {
    "home": HOME,
    "desktop": HOME / "Desktop",
    "documents": HOME / "Documents",
    "downloads": HOME / "Downloads",
    "pictures": HOME / "Pictures",
    "music": HOME / "Music",
    "videos": HOME / "Videos",
}

MAX_READ_BYTES = 200_000


class UnsafePath(ValueError):
    pass


def _safe_path(raw: str, must_exist: bool = False) -> Path:
    """Resolve a user-supplied path and confine it to the home directory."""
    if not raw or not str(raw).strip():
        raise UnsafePath("Empty path.")

    text = str(raw).strip().strip('"').strip("'")

    key = text.lower()
    if key in _SHORTCUTS:
        resolved = _SHORTCUTS[key]
    else:
        expanded = Path(os.path.expandvars(os.path.expanduser(text)))
        if not expanded.is_absolute():
            expanded = HOME / expanded
        resolved = expanded

    resolved = resolved.resolve()

    # Confinement check. `is_relative_to` handles the `/home/user-evil` case
    # that a naive startswith() string compare would wrongly allow.
    if resolved != HOME and not resolved.is_relative_to(HOME):
        raise UnsafePath(
            f"{resolved} is outside the home directory. TARS only touches files under {HOME}."
        )
    if must_exist and not resolved.exists():
        raise UnsafePath(f"No such file or folder: {resolved}")
    return resolved


def _describe(p: Path) -> Dict[str, Any]:
    try:
        stat = p.stat()
        return {
            "path": str(p),
            "name": p.name,
            "is_dir": p.is_dir(),
            "size_kb": round(stat.st_size / 1024, 1),
        }
    except OSError:
        return {"path": str(p), "name": p.name, "is_dir": p.is_dir()}


@tool(
    name="find_files",
    description=(
        "Find files by name. folder accepts 'desktop'/'downloads'/'documents' or a path."
    ),
    parameters={
        "type": "object",
        "properties": {
            "pattern": {
                "type": "string",
                "description": "Glob or substring, e.g. '*.pdf' or 'invoice'.",
            },
            "folder": {"type": "string", "description": "Default: home."},
            "recursive": {"type": "boolean", "description": "Default true."},
        },
        "required": ["pattern"],
    },
)
async def find_files(
    pattern: str, folder: Optional[str] = None, recursive: bool = True
) -> Dict[str, Any]:
    try:
        root = _safe_path(folder or "home", must_exist=True)
    except UnsafePath as e:
        return {"status": "error", "message": str(e)}

    # A bare word means "name contains this"; anything with a glob char is a glob.
    glob = pattern if any(c in pattern for c in "*?[") else f"*{pattern}*"

    def _search() -> List[Dict[str, Any]]:
        it = root.rglob(glob) if recursive else root.glob(glob)
        found = []
        for p in it:
            # Skip the noise that dominates a home-directory walk.
            if any(part.startswith(".") or part in
                   ("node_modules", "__pycache__", "venv", ".venv", "Library")
                   for part in p.relative_to(root).parts):
                continue
            found.append(_describe(p))
            if len(found) >= 50:
                break
        return found

    try:
        results = await asyncio.wait_for(asyncio.to_thread(_search), timeout=25.0)
    except asyncio.TimeoutError:
        return {"status": "error", "message": "Search took too long. Narrow it to a specific folder."}
    except OSError as e:
        return {"status": "error", "message": f"Search failed: {e}"}

    return {
        "status": "success",
        "count": len(results),
        "results": results,
        "message": f"Found {len(results)} match(es) for '{pattern}' in {root}.",
    }


@tool(
    name="read_file",
    description="Read a text file's contents.",
    parameters={
        "type": "object",
        "properties": {"path": {"type": "string", "description": "Path to the file."}},
        "required": ["path"],
    },
)
async def read_file(path: str) -> Dict[str, Any]:
    try:
        p = _safe_path(path, must_exist=True)
    except UnsafePath as e:
        return {"status": "error", "message": str(e)}

    if p.is_dir():
        entries = [_describe(c) for c in list(p.iterdir())[:50]]
        return {"status": "success", "is_dir": True, "entries": entries,
                "message": f"{p} is a folder with {len(entries)} visible item(s)."}

    if p.stat().st_size > MAX_READ_BYTES:
        return {
            "status": "error",
            "message": f"{p.name} is {round(p.stat().st_size / 1e6, 1)} MB — too large to read "
                       f"into context. Ask the user what specifically they need from it.",
        }

    try:
        content = await asyncio.to_thread(p.read_text, encoding="utf-8", errors="replace")
    except OSError as e:
        return {"status": "error", "message": f"Could not read {p}: {e}"}

    return {"status": "success", "path": str(p), "content": content,
            "message": f"Read {len(content)} characters from {p.name}."}


@tool(
    name="write_file",
    description=(
        "Create or overwrite a text file."
    ),
    parameters={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Where to write."},
            "content": {"type": "string", "description": "Full text content of the file."},
        },
        "required": ["path", "content"],
    },
    risk=path_write_risk,
)
async def write_file(path: str, content: str) -> Dict[str, Any]:
    try:
        p = _safe_path(path)
    except UnsafePath as e:
        return {"status": "error", "message": str(e)}
    try:
        await asyncio.to_thread(p.parent.mkdir, parents=True, exist_ok=True)
        await asyncio.to_thread(p.write_text, content, encoding="utf-8")
    except OSError as e:
        return {"status": "error", "message": f"Could not write {p}: {e}"}
    return {"status": "success", "path": str(p), "message": f"Wrote {len(content)} characters to {p}."}


@tool(
    name="move_file",
    description="Move or rename a file or folder.",
    parameters={
        "type": "object",
        "properties": {
            "source": {"type": "string"},
            "destination": {"type": "string"},
        },
        "required": ["source", "destination"],
    },
    risk=always("Move {source} to {destination}?"),
)
async def move_file(source: str, destination: str) -> Dict[str, Any]:
    try:
        src = _safe_path(source, must_exist=True)
        dst = _safe_path(destination)
    except UnsafePath as e:
        return {"status": "error", "message": str(e)}
    try:
        await asyncio.to_thread(dst.parent.mkdir, parents=True, exist_ok=True)
        await asyncio.to_thread(shutil.move, str(src), str(dst))
    except OSError as e:
        return {"status": "error", "message": f"Move failed: {e}"}
    return {"status": "success", "message": f"Moved {src.name} to {dst}."}


@tool(
    name="delete_file",
    description=(
        "Delete a file or folder (moved to trash)."
    ),
    parameters={
        "type": "object",
        "properties": {"path": {"type": "string"}},
        "required": ["path"],
    },
    risk=always("Delete {path}?"),
)
async def delete_file(path: str) -> Dict[str, Any]:
    try:
        p = _safe_path(path, must_exist=True)
    except UnsafePath as e:
        return {"status": "error", "message": str(e)}

    # Prefer the trash so a mistaken delete stays recoverable.
    try:
        import send2trash

        await asyncio.to_thread(send2trash.send2trash, str(p))
        return {"status": "success", "message": f"Moved {p.name} to the trash."}
    except ImportError:
        return {
            "status": "error",
            "message": "send2trash is not installed, and TARS will not permanently delete "
                       "files without it. Run: pip install send2trash",
        }
    except Exception as e:
        return {"status": "error", "message": f"Could not trash {p}: {e}"}
