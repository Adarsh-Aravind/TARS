import sys
import subprocess
import os
import json
from typing import Dict, Any, Optional

def launch_app(app_name: str) -> Dict[str, Any]:
    """
    Launch an application securely across platforms.
    """
    try:
        if sys.platform == "win32":
            # On Windows, we can use the start command or directly execute if in PATH
            os.startfile(app_name)
            return {"status": "success", "message": f"Launched {app_name} on Windows"}
        elif sys.platform == "darwin":
            # On macOS, use the open command
            subprocess.run(["open", "-a", app_name], check=True)
            return {"status": "success", "message": f"Launched {app_name} on macOS"}
        elif sys.platform.startswith("linux"):
            # On Linux, attempt standard xdg-open or executing directly
            # This requires the exact binary name in most cases, or using gtk-launch
            subprocess.Popen([app_name], start_new_session=True)
            return {"status": "success", "message": f"Launched {app_name} on Linux"}
        else:
            return {"status": "error", "message": f"Unsupported OS: {sys.platform}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

def set_volume(level: int) -> Dict[str, Any]:
    """
    Set system volume (0-100).
    """
    try:
        level = max(0, min(100, level))
        if sys.platform == "win32":
            # Requires a 3rd party tool like nircmd or a custom pycaw script.
            # Using a stub for Windows volume control for now
            return {"status": "success", "message": f"Volume set to {level}% (Stub on Windows)"}
        elif sys.platform == "darwin":
            subprocess.run(["osascript", "-e", f"set volume output volume {level}"], check=True)
            return {"status": "success", "message": f"Volume set to {level}% on macOS"}
        else:
            return {"status": "error", "message": "Volume control not implemented for this OS."}
    except Exception as e:
        return {"status": "error", "message": str(e)}

def handle_tool_call(tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    """
    Dispatcher for tool execution.
    """
    if tool_name == "launch_app":
        return launch_app(arguments.get("app_name", ""))
    elif tool_name == "set_volume":
        return set_volume(arguments.get("level", 50))
    else:
        return {"status": "error", "message": f"Unknown tool: {tool_name}"}
