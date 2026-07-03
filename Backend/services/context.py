import sys
import subprocess
import time
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

def get_active_window_title() -> str:
    """
    Get the title of the currently active window across platforms.
    """
    try:
        if sys.platform == "win32":
            # Using ctypes to avoid external dependencies for simple win32 api calls
            import ctypes
            hwnd = ctypes.windll.user32.GetForegroundWindow()
            length = ctypes.windll.user32.GetWindowTextLengthW(hwnd)
            buf = ctypes.create_unicode_buffer(length + 1)
            ctypes.windll.user32.GetWindowTextW(hwnd, buf, length + 1)
            return buf.value if buf.value else "[No Active Window]"
            
        elif sys.platform == "darwin":
            # macOS requires osascript
            script = 'tell application "System Events" to get name of first application process whose frontmost is true'
            result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, check=True)
            return result.stdout.strip()
            
        else:
            return "[Active Window Title not supported on this OS]"
    except Exception as e:
        return f"[Window Title Error: {e}]"

def get_system_context() -> Dict[str, Any]:
    """
    Bundle all system context to inject into LLM prompts or metadata.
    """
    return {
        "time": time.strftime("%Y-%m-%d %H:%M:%S"),
        "os": sys.platform,
        "active_window": get_active_window_title(),
        "clipboard_snippet": get_clipboard_content()[:200]  # Limit length
    }
