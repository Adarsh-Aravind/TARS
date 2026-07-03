import os
import io
import soundfile as sf
from pedalboard import Pedalboard, Reverb, HighpassFilter, LowpassFilter, PitchShift, Chorus
from kokoro_onnx import Kokoro
import numpy as np

# Load model (assume they are in the Backend directory)
MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "kokoro-v0_19.onnx")
VOICES_PATH = os.path.join(os.path.dirname(__file__), "..", "voices.json")

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
    """
    Applies the specific TARS audio effects:
    - Pitch: -2% to -4% (approx -0.5 semitones)
    - Tiny room reverb
    - High-pass around 80 Hz
    - Low-pass around 8 kHz
    - Very subtle robotic vocoder (5-10%) via Chorus/Comb filter
    """
    board = Pedalboard([
        PitchShift(semitones=-0.6),
        HighpassFilter(cutoff_frequency_hz=80.0),
        LowpassFilter(cutoff_frequency_hz=8000.0),
        Chorus(rate_hz=50.0, depth=0.1, centre_delay_ms=2.0, feedback=0.5, mix=0.1), # subtle robotic effect
        Reverb(room_size=0.1, damping=0.9, wet_level=0.15)
    ])
    
    # pedalboard expects shape (channels, samples), kokoro returns 1D array
    if audio_data.ndim == 1:
        audio_data = np.expand_dims(audio_data, axis=0)
        
    effected = board(audio_data, sample_rate)
    return effected[0] # return 1D array

def generate_tars_speech(text: str, voice="af_heart", speed=0.90) -> bytes:
    """
    Generates TARS speech for a given text and returns WAV file bytes.
    """
    k = get_kokoro()
    audio_array, sample_rate = k.create(text, voice=voice, speed=speed)
    
    processed_audio = apply_tars_effects(audio_array, sample_rate)
    
    buffer = io.BytesIO()
    sf.write(buffer, processed_audio, sample_rate, format='WAV', subtype='PCM_16')
    buffer.seek(0)
    return buffer.read()

def play_greeting():
    """
    Generate and play a random TARS greeting locally.
    """
    import random
    import sounddevice as sd
    
    greetings = ["TARS online.", "Awaiting instructions.", "Yes?", "TARS here."]
    greeting = random.choice(greetings)
    
    k = get_kokoro()
    audio_array, sample_rate = k.create(greeting, voice="af_heart", speed=0.90)
    processed_audio = apply_tars_effects(audio_array, sample_rate)
    
    sd.play(processed_audio, sample_rate)
    sd.wait()
