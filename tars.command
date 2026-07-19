#!/usr/bin/env bash
# ===========================================================================
#  TARS launcher (macOS / Linux)
#
#  On macOS the .command extension makes this double-clickable in Finder.
#  From a terminal: ./tars.command --dev
#
#  A .bat file cannot run on macOS — this is its counterpart. Both delegate to
#  scripts/launch.py, so the two platforms behave identically.
#
#  First time only, make it executable:  chmod +x tars.command
# ===========================================================================

set -euo pipefail

cd "$(dirname "$0")"

# Prefer the project venv if it exists — it has the right packages.
if [ -x ".venv/bin/python" ]; then
    TARS_PY=".venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
    TARS_PY="python3"
elif command -v python >/dev/null 2>&1; then
    TARS_PY="python"
else
    echo
    echo "  [TARS] ERROR: Python 3 was not found."
    echo
    echo "  macOS:  brew install python@3.12"
    echo "  Linux:  sudo apt install python3 python3-venv"
    echo
    read -r -p "  Press Return to close." _
    exit 1
fi

"$TARS_PY" scripts/launch.py "$@"
EXITCODE=$?

# Hold the window open on failure so a double-clicked launch shows the error.
if [ $EXITCODE -ne 0 ]; then
    echo
    echo "  [TARS] exited with code $EXITCODE"
    read -r -p "  Press Return to close." _
fi

exit $EXITCODE
