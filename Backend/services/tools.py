import sys
import subprocess
import os
import json
import asyncio
import re
from typing import Dict, Any, Optional

async def launch_app(app_name: str) -> Dict[str, Any]:
    """
    Launch an application securely across platforms.
    """
    # Security: Strict regex whitelist for alphanumeric characters and hyphens/underscores
    if not re.match(r"^[a-zA-Z0-9_\-\.\s]+$", app_name):
        return {"status": "error", "message": "Invalid app name formatting."}

    try:
        if sys.platform == "win32":
            # On Windows, we can use the start command or directly execute if in PATH
            await asyncio.to_thread(os.startfile, app_name)
            return {"status": "success", "message": f"Launched {app_name} on Windows"}
        elif sys.platform == "darwin":
            # On macOS, use the open command
            process = await asyncio.create_subprocess_exec(
                "open", "-a", app_name,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
            )
            await process.communicate()
            return {"status": "success", "message": f"Launched {app_name} on macOS"}
        elif sys.platform.startswith("linux"):
            # On Linux, attempt standard xdg-open or executing directly
            process = await asyncio.create_subprocess_exec(
                app_name,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
            )
            return {"status": "success", "message": f"Launched {app_name} on Linux"}
        else:
            return {"status": "error", "message": f"Unsupported OS: {sys.platform}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def set_volume(level: Any) -> Dict[str, Any]:
    """
    Set system volume (0-100).
    """
    try:
        level = max(0, min(100, int(level)))
        if sys.platform == "win32":
            # Requires a 3rd party tool like nircmd or a custom pycaw script.
            # Using a stub for Windows volume control for now
            return {"status": "success", "message": f"Volume set to {level}% (Stub on Windows)"}
        elif sys.platform == "darwin":
            process = await asyncio.create_subprocess_exec(
                "osascript", "-e", f"set volume output volume {level}",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
            )
            await process.communicate()
            return {"status": "success", "message": f"Volume set to {level}% on macOS"}
        else:
            return {"status": "error", "message": "Volume control not implemented for this OS."}
    except ValueError:
        return {"status": "error", "message": "Invalid volume level."}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def handle_tool_call(tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    """
    Dispatcher for tool execution.
    """
    if tool_name == "launch_app":
        return await launch_app(arguments.get("app_name", ""))
    elif tool_name == "set_volume":
        return await set_volume(arguments.get("level", 50))
    else:
        return {"status": "error", "message": f"Unknown tool: {tool_name}"}
