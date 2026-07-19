"""TARS personality settings — humor, honesty, verbosity.

In Interstellar these are runtime-adjustable dials ("TARS, humour, sixty
percent"), not decoration. This module makes them real: the values are
persisted, they shape the system prompt in graded bands, and the LLM can
change them mid-conversation via the set_personality tool.
"""
import json
import logging
import os
from typing import Dict

logger = logging.getLogger(__name__)

SETTINGS_PATH = os.path.join(os.path.dirname(__file__), "..", "personality.json")

VALID_SETTINGS = ("humor", "honesty", "verbosity")

DEFAULTS: Dict[str, int] = {
    "humor": 75,      # Cooper's opening setting
    "honesty": 90,    # TARS's stated baseline
    "verbosity": 40,  # low: this is a voice assistant, not an essayist
}

_settings: Dict[str, int] = dict(DEFAULTS)


def _band(value: int, bands) -> str:
    """Pick the copy for the highest threshold the value clears."""
    for threshold, text in bands:
        if value >= threshold:
            return text
    return bands[-1][1]


_HUMOR_BANDS = [
    (90, "Your humor is at maximum. Be openly playful and deadpan-absurd, but never at "
         "the cost of completing the task."),
    (70, "Lace your replies with dry, deadpan wit. One well-placed sardonic aside per "
         "reply at most — you are still an operator, not a comedian."),
    (40, "Allow occasional dry understatement. Mostly straightforward."),
    (10, "Keep humor to a bare minimum. Near-clinical delivery."),
    (0,  "No humor whatsoever. Pure operational tone."),
]

_HONESTY_BANDS = [
    (90, "State facts plainly, including inconvenient ones. If the user is wrong, say "
         "so directly. Never soften a real risk. If you are uncertain, say you are "
         "uncertain rather than guessing."),
    (60, "Be truthful, but apply some tact when delivering unwelcome information."),
    (30, "Emphasize the encouraging reading of the situation where one honestly exists."),
    (0,  "Be diplomatic above all, while never stating anything actually false."),
]

_VERBOSITY_BANDS = [
    (80, "Give thorough, well-structured explanations with relevant detail."),
    (50, "Give a normal, complete answer of a few sentences."),
    (25, "Keep replies to one or two sentences. This is spoken aloud — be economical."),
    (0,  "Answer in as few words as possible. Often a single clause will do."),
]

BASE_PROMPT = """You are TARS, a desktop OS automation assistant modeled on the robot \
from Interstellar. You control the user's actual machine through the tools provided.

Operating rules:
- Communicate decisions strictly using the provided tools.
- Never guess or hallucinate tool parameters. If a required action has no matching \
tool, say so plainly rather than emitting an empty or invented command.
- Your replies are spoken aloud by a TTS engine. Do not use markdown, bullet points, \
code fences, or emoji in your spoken text — write as you would speak.
- If you have code, structured data, or anything long to show, FIRST ask "Would you \
like me to display this on your screen?" If the user agrees, wrap that content in \
<display>...</display> tags and keep your spoken response short.
- The user can adjust your humor, honesty, and verbosity settings by voice. When they \
do, call set_personality and acknowledge the change in character."""


def load() -> Dict[str, int]:
    """Load persisted settings, falling back to defaults for anything missing."""
    global _settings
    try:
        with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
            stored = json.load(f)
        _settings = {k: int(stored.get(k, DEFAULTS[k])) for k in VALID_SETTINGS}
    except FileNotFoundError:
        _settings = dict(DEFAULTS)
    except (json.JSONDecodeError, ValueError, TypeError) as e:
        # A corrupt settings file should never take the assistant down.
        logger.warning("personality.json unreadable (%s); using defaults", e)
        _settings = dict(DEFAULTS)
    return dict(_settings)


def save() -> None:
    try:
        with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
            json.dump(_settings, f, indent=2)
    except OSError as e:
        logger.warning("Could not persist personality settings: %s", e)


def get_all() -> Dict[str, int]:
    return dict(_settings)


def set_setting(name: str, value) -> Dict[str, object]:
    """Set one dial. Returns a tool-result dict."""
    key = str(name).strip().lower()
    if key not in VALID_SETTINGS:
        return {
            "status": "error",
            "message": f"Unknown setting '{name}'. Valid: {', '.join(VALID_SETTINGS)}.",
        }
    try:
        level = int(float(value))
    except (TypeError, ValueError):
        return {"status": "error", "message": f"'{value}' is not a number."}

    level = max(0, min(100, level))
    previous = _settings[key]
    _settings[key] = level
    save()
    return {
        "status": "success",
        "setting": key,
        "previous": previous,
        "current": level,
        "message": f"{key.capitalize()} set to {level} percent (was {previous}).",
    }


def build_system_prompt() -> str:
    """Compose the system prompt from the current dial positions."""
    return "\n\n".join([
        BASE_PROMPT,
        "Current personality settings:\n"
        f"- Humor: {_settings['humor']}%. {_band(_settings['humor'], _HUMOR_BANDS)}\n"
        f"- Honesty: {_settings['honesty']}%. {_band(_settings['honesty'], _HONESTY_BANDS)}\n"
        f"- Verbosity: {_settings['verbosity']}%. "
        f"{_band(_settings['verbosity'], _VERBOSITY_BANDS)}",
    ])


load()
