#!/usr/bin/env python3
"""TARS launcher — one script, both platforms.

`tars.bat` (Windows) and `tars.command` (macOS/Linux) are thin shims that find a
Python and hand off to this file. Everything real happens here so the two
platforms can't drift apart.

What it does, in order:
  1. Creates .venv and installs Python dependencies if they're missing.
  2. Installs npm dependencies and builds the frontend if needed.
  3. Starts the FastAPI backend and waits for /health to answer.
  4. Starts the Electron overlay and hands the terminal over to it.
  5. Shuts the backend down cleanly on exit.

Flags:
  --dev        Run Vite + Electron with hot reload instead of the built bundle.
  --setup      Do the install/build steps and exit without launching.
  --backend    Backend only (useful when the overlay runs on another machine).
  --reinstall  Force dependency reinstall.
"""
import argparse
import os
import platform
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "Backend"
FRONTEND = ROOT / "frontend"
VENV = ROOT / ".venv"

IS_WIN = platform.system() == "Windows"
HEALTH_URL = "http://127.0.0.1:8000/health"

# Marker files let us skip the slow steps on every subsequent launch.
DEPS_STAMP = VENV / ".tars-deps-installed"


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
def say(msg: str) -> None:
    print(f"  {msg}", flush=True)


def step(msg: str) -> None:
    print(f"\n[TARS] {msg}", flush=True)


def die(msg: str) -> None:
    print(f"\n[TARS] ERROR: {msg}\n", file=sys.stderr, flush=True)
    sys.exit(1)


# ---------------------------------------------------------------------------
# Paths inside the venv
# ---------------------------------------------------------------------------
def venv_python() -> Path:
    return VENV / ("Scripts/python.exe" if IS_WIN else "bin/python")


def npm_cmd() -> str:
    # npm ships as npm.cmd on Windows; shutil.which resolves the right one.
    found = shutil.which("npm")
    if not found:
        die(
            "npm was not found on PATH.\n"
            "  Install Node.js 18 or newer from https://nodejs.org and re-run this script."
        )
    return found


def run(cmd, cwd=None, check=True, **kwargs) -> subprocess.CompletedProcess:
    result = subprocess.run(cmd, cwd=cwd, **kwargs)
    if check and result.returncode != 0:
        die(f"Command failed ({result.returncode}): {' '.join(map(str, cmd))}")
    return result


# ---------------------------------------------------------------------------
# Setup steps
# ---------------------------------------------------------------------------
def ensure_venv(force: bool) -> None:
    if not venv_python().exists():
        step("Creating Python virtual environment...")
        run([sys.executable, "-m", "venv", str(VENV)])

    if DEPS_STAMP.exists() and not force:
        return

    step("Installing Python dependencies (first run takes a few minutes)...")
    py = str(venv_python())
    run([py, "-m", "pip", "install", "--upgrade", "pip", "--quiet"])
    run([py, "-m", "pip", "install", "-r", str(BACKEND / "requirements.txt")])

    # Playwright's browser binary is a separate ~150MB download and is optional:
    # TARS works without it, just without the browser_* tools.
    step("Installing Chromium for browser automation (optional, ~150MB)...")
    result = run([py, "-m", "playwright", "install", "chromium"], check=False)
    if result.returncode != 0:
        say("Chromium install failed — browser automation will be unavailable.")
        say("Everything else still works. Retry later with: playwright install chromium")

    DEPS_STAMP.touch()


def ensure_frontend(force: bool, dev: bool) -> None:
    npm = npm_cmd()

    if force or not (FRONTEND / "node_modules").exists():
        step("Installing frontend dependencies...")
        run([npm, "install"], cwd=FRONTEND)

    # Dev mode serves from Vite, so a production bundle isn't needed.
    if not dev and (force or not (FRONTEND / "dist" / "index.html").exists()):
        step("Building the frontend...")
        run([npm, "run", "build"], cwd=FRONTEND)


def ensure_env() -> None:
    env_file = BACKEND / ".env"
    if env_file.exists():
        return
    example = BACKEND / ".env.example"
    if example.exists():
        shutil.copy(example, env_file)
        step("Created Backend/.env from the example.")
        say("Add your GROQ_API_KEY to Backend/.env, or set LLM_PROVIDER=ollama for local.")


# ---------------------------------------------------------------------------
# Processes
# ---------------------------------------------------------------------------
def backend_already_running() -> bool:
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=1.5):
            return True
    except (urllib.error.URLError, OSError):
        return False


def start_backend() -> subprocess.Popen | None:
    if backend_already_running():
        step("Backend is already running — reusing it.")
        return None

    step("Starting the backend...")
    env = {**os.environ, "HOST": "127.0.0.1", "PORT": "8000", "PYTHONUNBUFFERED": "1"}
    proc = subprocess.Popen([str(venv_python()), "Main.py"], cwd=BACKEND, env=env)

    for _ in range(90):  # up to ~45s; first run loads the Whisper/Kokoro models
        if proc.poll() is not None:
            die("The backend exited during startup. Scroll up for its traceback.")
        if backend_already_running():
            say("Backend is up at http://127.0.0.1:8000")
            return proc
        time.sleep(0.5)

    proc.terminate()
    die("The backend did not become healthy within 45 seconds.")


def start_frontend(dev: bool) -> subprocess.Popen:
    npm = npm_cmd()
    if dev:
        step("Starting Vite + Electron (hot reload)...")
        return subprocess.Popen([npm, "run", "electron"], cwd=FRONTEND)
    step("Starting the TARS overlay...")
    return subprocess.Popen(
        [npm, "run", "electron:start"],
        cwd=FRONTEND,
        env={**os.environ, "NODE_ENV": "production"},
    )


def terminate(proc: subprocess.Popen | None, name: str) -> None:
    if proc is None or proc.poll() is not None:
        return
    say(f"Stopping {name}...")
    try:
        proc.terminate()
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser(description="Launch TARS.")
    parser.add_argument("--dev", action="store_true", help="Hot-reload dev mode.")
    parser.add_argument("--setup", action="store_true", help="Install and build, then exit.")
    parser.add_argument("--backend", action="store_true", help="Run the backend only.")
    parser.add_argument("--reinstall", action="store_true", help="Force dependency reinstall.")
    args = parser.parse_args()

    if sys.version_info < (3, 10):
        die(f"Python 3.10+ is required; this is {platform.python_version()}.")

    print("\n" + "=" * 52)
    print("  TARS  —  starting up")
    print("=" * 52)

    ensure_env()
    ensure_venv(args.reinstall)

    if not args.backend:
        ensure_frontend(args.reinstall, args.dev)

    if args.setup:
        step("Setup complete. Run the launcher again to start TARS.")
        return

    backend = start_backend()
    frontend = None

    try:
        if args.backend:
            step("Backend-only mode. Press Ctrl+C to stop.")
            if backend is not None:
                backend.wait()
            else:
                while True:
                    time.sleep(3600)
        else:
            frontend = start_frontend(args.dev)
            print("\n" + "=" * 52)
            print("  TARS is running.")
            print("    Alt+Space        summon (text)")
            print("    Shift+Alt+Space  summon (voice)")
            print("    Ctrl+C here      quit")
            print("=" * 52 + "\n")
            frontend.wait()
    except KeyboardInterrupt:
        print()
    finally:
        terminate(frontend, "overlay")
        terminate(backend, "backend")
        say("TARS stopped.")


if __name__ == "__main__":
    # Ctrl+C should unwind through the finally block, not kill us outright.
    signal.signal(signal.SIGINT, signal.default_int_handler)
    main()
