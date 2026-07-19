"""System control — volume, media, clipboard, notifications, shell, power.

Every function branches per-platform and returns the same result shape, so the
model never has to know which OS it's on.
"""
import asyncio
import datetime
import platform
import shutil
import subprocess
import sys
from typing import Any, Dict, Optional

from .registry import tool
from .risk import shell_risk, always

IS_WIN = sys.platform == "win32"
IS_MAC = sys.platform == "darwin"


async def _run(*args: str, timeout: float = 20.0) -> subprocess.CompletedProcess:
    """Run an argv list with no shell, capturing output."""
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        raise
    return subprocess.CompletedProcess(args, proc.returncode, out, err)


# --------------------------------------------------------------------------
# Volume
# --------------------------------------------------------------------------
@tool(
    name="set_volume",
    description="Set output volume 0-100, or mute/unmute.",
    parameters={
        "type": "object",
        "properties": {
            # Union type on purpose: models emit "60" as often as 60, and Groq
            # validates tool args server-side and hard-rejects a mismatch mid-stream.
            "level": {"type": ["integer", "string"], "description": "0-100."},
            "mute": {"type": "boolean", "description": "True to mute."},
        },
        "required": [],
    },
)
async def set_volume(level: Any = None, mute: Optional[bool] = None) -> Dict[str, Any]:
    if IS_WIN:
        try:
            from ctypes import POINTER, cast
            from comtypes import CLSCTX_ALL
            from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
        except ImportError:
            return {
                "status": "error",
                "message": "Windows volume control needs pycaw. Run: pip install pycaw comtypes",
            }

        import comtypes

        def _apply():
            # asyncio.to_thread runs this on a fresh worker thread, and COM is
            # per-thread: without CoInitialize here, the Activate() call below
            # fails with "CoInitialize has not been called".
            comtypes.CoInitialize()
            try:
                device = AudioUtilities.GetSpeakers()
                # pycaw changed shape: recent versions hand back a wrapper that
                # exposes EndpointVolume directly, older ones return a raw
                # IMMDevice you have to Activate yourself. Support both.
                if hasattr(device, "EndpointVolume"):
                    vol = device.EndpointVolume
                else:
                    interface = device.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                    vol = cast(interface, POINTER(IAudioEndpointVolume))
                if mute is not None:
                    vol.SetMute(bool(mute), None)
                if level is not None:
                    vol.SetMasterVolumeLevelScalar(
                        max(0, min(100, int(float(level)))) / 100.0, None
                    )
            finally:
                comtypes.CoUninitialize()

        await asyncio.to_thread(_apply)

    elif IS_MAC:
        if mute is not None:
            await _run("osascript", "-e", f"set volume output muted {str(bool(mute)).lower()}")
        if level is not None:
            lvl = max(0, min(100, int(float(level))))
            await _run("osascript", "-e", f"set volume output volume {lvl}")

    else:
        if not shutil.which("amixer"):
            return {"status": "error", "message": "amixer not found; install alsa-utils."}
        if mute is not None:
            await _run("amixer", "-q", "set", "Master", "mute" if mute else "unmute")
        if level is not None:
            lvl = max(0, min(100, int(float(level))))
            await _run("amixer", "-q", "set", "Master", f"{lvl}%")

    parts = []
    if level is not None:
        parts.append(f"volume {max(0, min(100, int(float(level))))}%")
    if mute is not None:
        parts.append("muted" if mute else "unmuted")
    return {"status": "success", "message": "Set " + (" and ".join(parts) or "nothing")}


# --------------------------------------------------------------------------
# Media transport
# --------------------------------------------------------------------------
@tool(
    name="media_control",
    description=(
        "Play/pause/skip whatever is playing system-wide. Sends OS media keys."
    ),
    parameters={
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["playpause", "next", "previous", "stop"],
                "description": "Transport action to send.",
            }
        },
        "required": ["action"],
    },
)
async def media_control(action: str) -> Dict[str, Any]:
    action = str(action).lower().strip()

    if IS_MAC:
        # macOS has no scriptable global media key, so drive whichever player is
        # actually running. Spotify and Music share the same AppleScript verbs.
        verbs = {
            "playpause": "playpause",
            "next": "next track",
            "previous": "previous track",
            "stop": "pause",
        }
        if action not in verbs:
            return {"status": "error", "message": f"Unknown media action: {action}"}

        for app_name in ("Spotify", "Music"):
            running = await _run(
                "osascript", "-e",
                f'tell application "System Events" to (name of processes) contains "{app_name}"',
            )
            if running.stdout.decode(errors="replace").strip() != "true":
                continue
            result = await _run("osascript", "-e",
                                f'tell application "{app_name}" to {verbs[action]}')
            if result.returncode == 0:
                return {"status": "success", "message": f"Sent {action} to {app_name}."}

        return {
            "status": "error",
            "message": "No scriptable media player is running. On macOS, media playing "
                       "in a browser tab can't be controlled this way — tell the user.",
        }

    if IS_WIN:
        import ctypes

        # Virtual key codes for the media transport keys.
        VK = {"playpause": 0xB3, "next": 0xB0, "previous": 0xB1, "stop": 0xB2}
        if action not in VK:
            return {"status": "error", "message": f"Unknown media action: {action}"}

        def _press():
            user32 = ctypes.windll.user32
            user32.keybd_event(VK[action], 0, 0, 0)     # key down
            user32.keybd_event(VK[action], 0, 2, 0)     # key up

        await asyncio.to_thread(_press)
        return {"status": "success", "message": f"Sent media {action}"}

    # Linux: MPRIS via playerctl.
    if not shutil.which("playerctl"):
        return {"status": "error", "message": "playerctl not found; install it for media control."}
    mapping = {"playpause": "play-pause", "next": "next", "previous": "previous", "stop": "stop"}
    if action not in mapping:
        return {"status": "error", "message": f"Unknown media action: {action}"}
    await _run("playerctl", mapping[action])
    return {"status": "success", "message": f"Sent media {action}"}


# --------------------------------------------------------------------------
# Clipboard
# --------------------------------------------------------------------------
@tool(
    name="clipboard",
    description="Read or write the clipboard.",
    parameters={
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["read", "write"]},
            "text": {"type": "string", "description": "Text to copy when writing."},
        },
        "required": ["action"],
    },
)
async def clipboard(action: str, text: Optional[str] = None) -> Dict[str, Any]:
    try:
        import pyperclip
    except ImportError:
        return {"status": "error", "message": "pyperclip is not installed."}

    if action == "read":
        content = await asyncio.to_thread(pyperclip.paste)
        return {"status": "success", "content": content or "", "message": "Clipboard read."}
    if action == "write":
        if text is None:
            return {"status": "error", "message": "`text` is required to write the clipboard."}
        await asyncio.to_thread(pyperclip.copy, text)
        return {"status": "success", "message": "Copied to clipboard."}
    return {"status": "error", "message": f"Unknown clipboard action: {action}"}


# --------------------------------------------------------------------------
# Notifications
# --------------------------------------------------------------------------
@tool(
    name="notify",
    description=(
        "Show a native desktop notification."
    ),
    parameters={
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "message": {"type": "string"},
        },
        "required": ["title", "message"],
    },
)
async def notify(title: str, message: str) -> Dict[str, Any]:
    try:
        if IS_MAC:
            safe_t = title.replace('"', "'")
            safe_m = message.replace('"', "'")
            await _run("osascript", "-e",
                       f'display notification "{safe_m}" with title "{safe_t}"')
        elif IS_WIN:
            # PowerShell toast via the shell's notify icon — no extra dependency.
            ps = (
                "[reflection.assembly]::loadwithpartialname('System.Windows.Forms');"
                "[reflection.assembly]::loadwithpartialname('System.Drawing');"
                "$n=New-Object System.Windows.Forms.NotifyIcon;"
                "$n.Icon=[System.Drawing.SystemIcons]::Information;"
                "$n.BalloonTipTitle=$env:TARS_TITLE;"
                "$n.BalloonTipText=$env:TARS_MSG;"
                "$n.Visible=$true;$n.ShowBalloonTip(6000);Start-Sleep -Seconds 7;$n.Dispose()"
            )
            # Pass text via env, never string-interpolated into the script.
            proc = await asyncio.create_subprocess_exec(
                "powershell", "-NoProfile", "-Command", ps,
                env={**__import__("os").environ, "TARS_TITLE": title, "TARS_MSG": message},
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
            )
            asyncio.create_task(proc.wait())  # fire and forget; toast lingers 7s
        else:
            if shutil.which("notify-send"):
                await _run("notify-send", title, message)
            else:
                return {"status": "error", "message": "notify-send not found."}
        return {"status": "success", "message": "Notification shown."}
    except Exception as e:
        return {"status": "error", "message": f"Notification failed: {e}"}


# --------------------------------------------------------------------------
# System info
# --------------------------------------------------------------------------
@tool(
    name="system_info",
    description=(
        "Current time, date, OS, battery, CPU, disk. Never guess these."
    ),
    parameters={"type": "object", "properties": {}, "required": []},
)
async def system_info() -> Dict[str, Any]:
    now = datetime.datetime.now()
    info: Dict[str, Any] = {
        "status": "success",
        "time": now.strftime("%I:%M %p").lstrip("0"),
        "date": now.strftime("%A, %B %d, %Y"),
        "os": f"{platform.system()} {platform.release()}",
        "machine": platform.node(),
    }
    try:
        import psutil

        battery = psutil.sensors_battery()
        if battery is not None:
            info["battery_percent"] = round(battery.percent)
            info["charging"] = battery.power_plugged
        info["cpu_percent"] = psutil.cpu_percent(interval=0.1)
        info["memory_percent"] = psutil.virtual_memory().percent
        disk = psutil.disk_usage("C:\\" if IS_WIN else "/")
        info["disk_free_gb"] = round(disk.free / 1e9, 1)
    except ImportError:
        info["note"] = "Install psutil for battery, CPU, and disk details."
    except Exception:
        pass
    return info


# --------------------------------------------------------------------------
# Shell
# --------------------------------------------------------------------------
@tool(
    name="run_shell",
    description=(
        "Run a shell command (PowerShell on Windows, sh elsewhere) when no other "
        "tool fits. Destructive commands are confirmed automatically."
    ),
    parameters={
        "type": "object",
        "properties": {
            "command": {"type": "string", "description": "The command line to execute."}
        },
        "required": ["command"],
    },
    risk=shell_risk,
)
async def run_shell(command: str) -> Dict[str, Any]:
    if not command or not command.strip():
        return {"status": "error", "message": "Command cannot be empty."}
    try:
        if IS_WIN:
            argv = ["powershell", "-NoProfile", "-NonInteractive", "-Command", command]
        else:
            argv = ["/bin/sh", "-c", command]
        result = await _run(*argv, timeout=60.0)
    except asyncio.TimeoutError:
        return {"status": "error", "message": "Command timed out after 60 seconds."}

    stdout = result.stdout.decode("utf-8", errors="replace").strip()
    stderr = result.stderr.decode("utf-8", errors="replace").strip()

    # Cap output — the whole thing goes back into the model's context.
    def _cap(s: str, limit: int = 4000) -> str:
        return s if len(s) <= limit else s[:limit] + f"\n...[truncated, {len(s)} chars total]"

    return {
        "status": "success" if result.returncode == 0 else "error",
        "exit_code": result.returncode,
        "stdout": _cap(stdout),
        "stderr": _cap(stderr),
        "message": _cap(stdout) or _cap(stderr) or "Command completed with no output.",
    }


# --------------------------------------------------------------------------
# Power
# --------------------------------------------------------------------------
@tool(
    name="power_control",
    description="Lock, sleep, restart, or shut down.",
    parameters={
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["lock", "sleep", "restart", "shutdown"]}
        },
        "required": ["action"],
    },
    risk=always("{action} the machine?"),
)
async def power_control(action: str) -> Dict[str, Any]:
    action = str(action).lower().strip()
    try:
        if IS_WIN:
            cmds = {
                "lock": ["rundll32.exe", "user32.dll,LockWorkStation"],
                "sleep": ["rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0"],
                "restart": ["shutdown", "/r", "/t", "5"],
                "shutdown": ["shutdown", "/s", "/t", "5"],
            }
        elif IS_MAC:
            cmds = {
                "lock": ["pmset", "displaysleepnow"],
                "sleep": ["pmset", "sleepnow"],
                "restart": ["osascript", "-e", 'tell app "System Events" to restart'],
                "shutdown": ["osascript", "-e", 'tell app "System Events" to shut down'],
            }
        else:
            cmds = {
                "lock": ["loginctl", "lock-session"],
                "sleep": ["systemctl", "suspend"],
                "restart": ["systemctl", "reboot"],
                "shutdown": ["systemctl", "poweroff"],
            }
        if action not in cmds:
            return {"status": "error", "message": f"Unknown power action: {action}"}
        await _run(*cmds[action], timeout=10.0)
        return {"status": "success", "message": f"Sent {action}."}
    except Exception as e:
        return {"status": "error", "message": f"Power action failed: {e}"}
