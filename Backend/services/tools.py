import sys

TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "launch_app",
            "description": "Launch an application securely across platforms.",
            "parameters": {
                "type": "object",
                "properties": {
                    "app_name": {
                        "type": "string",
                        "description": "The name of the application or command to launch (e.g., 'notepad', 'calc', 'chrome')."
                    }
                },
                "required": ["app_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "set_volume",
            "description": "Set system volume (0-100).",
            "parameters": {
                "type": "object",
                "properties": {
                    "level": {
                        "type": "integer",
                        "description": "The volume level from 0 to 100."
                    }
                },
                "required": ["level"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "run_system_command",
            "description": "Execute a terminal/shell command (PowerShell on Windows) to perform file operations (rename, move, delete), system tasks, or open complex applications.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The command line string to execute."
                    }
                },
                "required": ["command"]
            }
        }
    }
]

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
    # Map common conversational names to actual executable names or URLs
    COMMON_ALIASES = {
        "file explorer": "explorer",
        "explorer": "explorer",
        "calculator": "calc",
        "notepad": "notepad",
        "youtube": "https://www.youtube.com",
        "google": "https://www.google.com",
        "browser": "https://www.google.com"
    }

    app_name_lower = app_name.lower().strip()
    if app_name_lower in COMMON_ALIASES:
        app_name = COMMON_ALIASES[app_name_lower]

    # Security: Allow alphanumeric, hyphens, underscores, dots, spaces, and basic URL characters (:, /)
    if not re.match(r"^[a-zA-Z0-9_\-\.\s\:\/]+$", app_name):
        return {"status": "error", "message": f"Invalid app name formatting: {app_name}"}

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
    elif tool_name == "run_system_command":
        command = arguments.get("command", "")
        if not command:
            return {"status": "error", "message": "Command cannot be empty"}
        try:
            # Use PowerShell explicitly on Windows for robust command execution
            shell_cmd = ["powershell", "-Command", command] if sys.platform == "win32" else command
            process = await asyncio.create_subprocess_exec(
                *shell_cmd if isinstance(shell_cmd, list) else shell_cmd,
                stdout=asyncio.subprocess.PIPE, 
                stderr=asyncio.subprocess.PIPE,
                shell=not isinstance(shell_cmd, list)
            )
            stdout, stderr = await process.communicate()
            
            output = ""
            if stdout:
                output += f"Output:\n{stdout.decode('utf-8', errors='replace').strip()}"
            if stderr:
                output += f"\nErrors:\n{stderr.decode('utf-8', errors='replace').strip()}"
                
            return {
                "status": "success" if process.returncode == 0 else "error", 
                "message": output.strip() or "Command executed successfully with no output",
                "exit_code": process.returncode
            }
        except Exception as e:
            return {"status": "error", "message": str(e)}
    else:
        return {"status": "error", "message": f"Unknown tool: {tool_name}"}
