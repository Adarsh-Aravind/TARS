"""Shared risk classifiers.

The policy is "confirm destructive only": anything that opens, reads, or is
trivially reversible runs instantly; anything that deletes, overwrites, moves,
or takes the machine down asks first.

Shell is the hard case — it is an open-ended string, so we pattern-match known
destructive verbs rather than trying to prove a command is safe. False
positives here cost one confirmation click; false negatives cost data.
"""
import re
from typing import Any, Dict, Optional

# Destructive shell verbs across PowerShell, cmd, and POSIX shells. Matched on
# word boundaries so `remove-item` hits but `list-removed-items` doesn't.
_DESTRUCTIVE_PATTERNS = [
    r"\brm\b", r"\brmdir\b", r"\bdel\b", r"\berase\b", r"\bunlink\b",
    r"\bremove-item\b", r"\bclear-content\b", r"\bformat\b", r"\bmkfs\b",
    r"\bdiskpart\b", r"\bdd\b", r"\bfdisk\b",
    r"\bshutdown\b", r"\brestart\b", r"\breboot\b", r"\bhalt\b",
    r"\bstop-computer\b", r"\brestart-computer\b",
    r"\bkill\b", r"\btaskkill\b", r"\bstop-process\b", r"\bpkill\b",
    r"\bmv\b", r"\bmove\b", r"\bmove-item\b", r"\brename-item\b", r"\bren\b",
    r"\bsudo\b", r"\bchmod\b", r"\bchown\b", r"\bicacls\b", r"\btakeown\b",
    r"\breg\s+delete\b", r"\bset-itemproperty\b", r"\bnew-itemproperty\b",
    r"\bgit\s+push\b", r"\bgit\s+reset\s+--hard\b", r"\bgit\s+clean\b",
    r"\bnpm\s+publish\b", r"\bpip\s+uninstall\b",
    r"\bcurl\b[^|]*\|\s*(ba)?sh", r"\bwget\b[^|]*\|\s*(ba)?sh",
    r">\s*[^>\s]", r">>",           # output redirection overwrites/appends files
    r"\bInvoke-WebRequest\b[^|]*\|",
]

_DESTRUCTIVE_RE = re.compile("|".join(_DESTRUCTIVE_PATTERNS), re.IGNORECASE)


def shell_risk(args: Dict[str, Any]) -> Optional[str]:
    command = str(args.get("command", "")).strip()
    if not command:
        return None
    if _DESTRUCTIVE_RE.search(command):
        return f"Run this command? {command}"
    return None


def always(template: str):
    """Risk classifier that always confirms, formatting args into the prompt."""

    def _risk(args: Dict[str, Any]) -> Optional[str]:
        try:
            return template.format(**args)
        except (KeyError, IndexError):
            return template

    return _risk


def path_write_risk(args: Dict[str, Any]) -> Optional[str]:
    """Confirm overwriting an existing file; creating a new one is free."""
    import os

    path = str(args.get("path", ""))
    if path and os.path.exists(path):
        return f"Overwrite the existing file at {path}?"
    return None
