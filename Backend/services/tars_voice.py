import functools
import io
import os

import numpy as np
import soundfile as sf
from pedalboard import (
    Chorus,
    Compressor,
    Delay,
    Distortion,
    HighpassFilter,
    LowpassFilter,
    PitchShift,
    Pedalboard,
    Reverb,
)
from kokoro_onnx import Kokoro

# Load model (assume they are in the Backend directory).
# kokoro-onnx >= 0.4 ships the voice pack as a NumPy .bin ("voices.bin"), NOT
# the legacy 30 MB voices.json — loading the JSON with the installed 0.5.x
# raises "Failed to interpret file as a pickle" and 500s every TTS request.
# The .bin lives at the repo root (one level above Backend).
MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "kokoro-v0_19.onnx")
VOICES_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "voices.bin")

# TARS is a male voice; af_heart doesn't exist in the v0.19 pack. am_adam +
# the pitch/EQ effects below gets us the closest to the film's flat delivery.
DEFAULT_VOICE = "am_adam"

kokoro_model = None

def get_kokoro():
    global kokoro_model
    if kokoro_model is None:
        if os.path.exists(MODEL_PATH) and os.path.exists(VOICES_PATH):
            kokoro_model = Kokoro(MODEL_PATH, VOICES_PATH)
        else:
            raise FileNotFoundError("Kokoro model files not found. Please run download_kokoro.py")
    return kokoro_model

def apply_tars_effects(audio_data: np.ndarray, sample_rate: int) -> np.ndarray:
    """Shape a neutral TTS read into TARS's delivery.

    The character of the voice in the film is less "robot" than people expect —
    it is a calm human read played back through a small speaker in a metal
    chassis. So the chain is mostly restraint:

      PitchShift    barely down. Overdoing this is what makes assistants sound
                    like a cartoon villain.
      Compressor    the single most important stage. TARS is conversationally
                    flat, never rising or falling much, and that evenness is
                    what a hard 4:1 with a low threshold produces.
      Distortion    a trace of saturation for speaker-cone grit.
      Chorus        a hint of movement. The old 50 Hz rate was well into
                    ring-modulator territory and read as a metallic buzz;
                    slowing it keeps the machine quality without the artifact.
      Delay         one very short, quiet tap — the chassis reflection that
                    makes the voice sound enclosed rather than in the room.
      Filters       80 Hz / 7.5 kHz, the passband of a small unit speaker.
    """
    board = Pedalboard([
        PitchShift(semitones=-0.7),
        HighpassFilter(cutoff_frequency_hz=80.0),
        Compressor(threshold_db=-20.0, ratio=4.0, attack_ms=5.0, release_ms=120.0),
        Distortion(drive_db=4.0),
        Chorus(rate_hz=0.7, depth=0.06, centre_delay_ms=3.0, feedback=0.12, mix=0.10),
        Delay(delay_seconds=0.028, feedback=0.06, mix=0.11),
        LowpassFilter(cutoff_frequency_hz=7500.0),
        Reverb(room_size=0.09, damping=0.92, wet_level=0.11, dry_level=0.92),
    ])

    # pedalboard expects shape (channels, samples); kokoro returns a 1D array.
    if audio_data.ndim == 1:
        audio_data = np.expand_dims(audio_data, axis=0)

    effected = board(audio_data, sample_rate)[0]

    # Compression plus saturation adds gain, and clipped speech sounds broken
    # rather than characterful. Normalise to a fixed headroom so every utterance
    # comes back at a consistent, safe level.
    peak = float(np.max(np.abs(effected))) if effected.size else 0.0
    if peak > 0:
        effected = effected * (0.89 / peak)

    return effected

def _synthesize(text: str, voice: str, speed: float) -> bytes:
    k = get_kokoro()
    audio_array, sample_rate = k.create(text, voice=voice, speed=speed)
    processed_audio = apply_tars_effects(audio_array, sample_rate)

    buffer = io.BytesIO()
    sf.write(buffer, processed_audio, sample_rate, format="WAV", subtype="PCM_16")
    buffer.seek(0)
    return buffer.read()


# Short utterances repeat constantly — the wake greetings, "Done.", "I'm on it."
# Synthesis costs a few hundred milliseconds, which is exactly the gap between
# the greeting feeling instant and feeling laggy, so cache the common ones.
# Bounded: the cache holds audio, and an unbounded one would grow without limit
# across a long session.
@functools.lru_cache(maxsize=64)
def _synthesize_cached(text: str, voice: str, speed: float) -> bytes:
    return _synthesize(text, voice, speed)


# Only short strings are worth caching; long replies are near-unique, and
# caching them would evict the greetings that actually repeat.
CACHEABLE_LENGTH = 60


def generate_tars_speech(text: str, voice=DEFAULT_VOICE, speed=0.90) -> bytes:
    """Generate TARS speech for a given text and return WAV file bytes."""
    if len(text) <= CACHEABLE_LENGTH:
        return _synthesize_cached(text, voice, speed)
    return _synthesize(text, voice, speed)

def play_greeting():
    """
    Generate and play a random TARS greeting locally.
    """
    import random
    import sounddevice as sd
    
    greetings = ["TARS online.", "Awaiting instructions.", "Yes?", "TARS here."]
    greeting = random.choice(greetings)

    k = get_kokoro()
    audio_array, sample_rate = k.create(greeting, voice=DEFAULT_VOICE, speed=0.90)
    processed_audio = apply_tars_effects(audio_array, sample_rate)
    
    sd.play(processed_audio, sample_rate)
    sd.wait()
