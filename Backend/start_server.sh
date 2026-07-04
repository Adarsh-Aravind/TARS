#!/usr/bin/env bash
# TARS backend launcher for macOS / Linux (equivalent of start_server.bat)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV_PYTHON="../.venv/bin/python"

if [ ! -x "$VENV_PYTHON" ]; then
  echo "No virtual environment found at ../.venv"
  echo "Create one first, e.g.:"
  echo "  python3 -m venv ../.venv"
  echo "  ../.venv/bin/pip install -r requirements.txt"
  exit 1
fi

echo "Starting TARS backend using virtual environment..."
"$VENV_PYTHON" Main.py
