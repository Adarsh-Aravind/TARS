import sys
import subprocess
import time
import asyncio
from typing import Dict, Any

def get_clipboard_content() -> str:
    """
    Safely get the current clipboard content.
    """
    try:
        import pyperclip
        return pyperclip.paste()
    except ImportError:
        return "[Clipboard Error: pyperclip is not installed. Run `pip install pyperclip`]"
    except Exception as e:
        return f"[Clipboard Error: {e}]"

async def get_active_window_title() -> str:
    """
    Get the title of the currently active window safely across platforms.
    """
    if sys.platform == "win32":
        try:
            import ctypes
            
            def _get_window_title():
                hwnd = ctypes.windll.user32.GetForegroundWindow()
                length = ctypes.windll.user32.GetWindowTextLengthW(hwnd)
                buf = ctypes.create_unicode_buffer(length + 1)
                ctypes.windll.user32.GetWindowTextW(hwnd, buf, length + 1)
                return buf.value if buf.value else "[No Active Window]"
                
            return await asyncio.to_thread(_get_window_title)
        except Exception as e:
            return f"[Win32 Context Error: {e}]"
            
    elif sys.platform == "darwin":
        try:
            script = 'tell application "System Events" to get name of first application process whose frontmost is true'
            process = await asyncio.create_subprocess_exec(
                "osascript", "-e", script,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
            )
            stdout, _ = await process.communicate()
            if process.returncode == 0:
                return stdout.decode().strip()
            else:
                return f"[macOS Script Error: Could not fetch window. Code {process.returncode}]"
        except FileNotFoundError:
            return "[macOS Error: osascript not found in PATH]"
        except Exception as e:
            return f"[macOS Context Error: {e}]"
            
    else:
        return "[Active Window Title not supported on this OS]"

async def get_system_context() -> Dict[str, Any]:
    """
    Bundle all system context to inject into LLM prompts or metadata.
    """
    clipboard = await asyncio.to_thread(get_clipboard_content)
    return {
        "time": time.strftime("%Y-%m-%d %H:%M:%S"),
        "os": sys.platform,
        "active_window": await get_active_window_title(),
        "clipboard_snippet": clipboard[:200]  # Limit length
    }
