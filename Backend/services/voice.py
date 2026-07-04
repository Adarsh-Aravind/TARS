import io
import re
import wave
import time
import logging
import threading
from collections import deque

import numpy as np
import sounddevice as sd

from services.transcription import transcribe_sync

# Wake vocabulary. The phrase is "Hey TARS", but the tiny.en Whisper model
# routinely renders "TARS" as one of a handful of near-homophones ("tar",
# "tarz", "tar's", ...). We match on this explicit set of token spellings —
# word-boundary matched, not substring — so we catch the real mishearings
# without firing on unrelated words like "stars" or "guitars".
WAKE_WORDS = frozenset({
    "tars", "tar", "tarz", "taz", "tarss", "tares", "tarce", "tarts",
})


def _matches_wake(text: str) -> bool:
    """True if a transcript contains the TARS wake word in any of its common
    Whisper spellings. Punctuation is stripped and matching is per-token so
    "hey, tars." works but "superstars" does not."""
    tokens = re.sub(r"[^a-z\s]", " ", text.lower()).split()
    return any(tok in WAKE_WORDS for tok in tokens)


class VoiceEngine:
    """
    Background wake-word listener. Records short blocks from the mic and runs
    them through the local Whisper model — nothing is sent to the cloud.
    """

    def __init__(self):
        self.is_listening = False
        self.wakeup_event = threading.Event()
        self.lock = threading.Lock()      # guards start/stop state transitions
        self.mic_lock = threading.Lock()  # serializes physical microphone access
        self.thread = None
        self._busy = False  # avoid piling up transcription threads
        # After a detection we ignore audio for a short cooldown so a single
        # "Hey TARS" — which now lands in several overlapping windows — fires
        # exactly one wakeup instead of a burst.
        self._last_wake = 0.0
        self._cooldown = 2.5

    @staticmethod
    def _to_wav(audio_int16: np.ndarray, samplerate: int) -> bytes:
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)  # int16
            wf.setframerate(samplerate)
            wf.writeframes(audio_int16.tobytes())
        return buf.getvalue()

    def _process_audio(self, audio_int16: np.ndarray, samplerate: int):
        try:
            text = transcribe_sync(self._to_wav(audio_int16, samplerate))
            if _matches_wake(text):
                logging.info(f"Wake word detected in: '{text}'")
                self._last_wake = time.monotonic()
                self.wakeup_event.set()
        except Exception as e:
            logging.error(f"VoiceEngine transcription error: {e}")
        finally:
            self._busy = False

    def _listen_loop(self):
        samplerate = 16000
        block = 1.0              # capture granularity (s)
        window = 2.0             # length of audio actually transcribed (s)
        silence_threshold = 250  # mean absolute int16 amplitude gate

        # Rolling buffer of the most recent blocks. We capture in short blocks
        # but transcribe the concatenation of the last few, so consecutive
        # windows OVERLAP. A wake word spoken across a block boundary — which a
        # fixed non-overlapping window would slice in half and miss — is always
        # whole inside at least one window.
        max_blocks = max(1, round(window / block))
        ring = deque(maxlen=max_blocks)

        while self.is_listening:
            try:
                # Hold the mic lock only for the actual capture so a foreground
                # /audio/listen capture can never open a second overlapping
                # InputStream on the same device (that races PortAudio and is
                # the classic "wake word never fires after the first use" bug).
                with self.mic_lock:
                    if not self.is_listening:
                        break
                    audio_data = sd.rec(
                        int(samplerate * block),
                        samplerate=samplerate,
                        channels=1,
                        dtype="int16",
                    )
                    sd.wait()

                if not self.is_listening:
                    break

                ring.append(audio_data.reshape(-1))

                # Stay quiet for a moment after a hit: one utterance now spans
                # several overlapping windows, and we only want one wakeup.
                if time.monotonic() - self._last_wake < self._cooldown:
                    continue

                mono = np.concatenate(ring)

                # Skip near-silence: saves CPU and avoids Whisper hallucinating
                # words out of background noise.
                if np.abs(mono).mean() < silence_threshold:
                    continue

                # Drop this window if the previous one is still transcribing.
                if self._busy:
                    continue
                self._busy = True
                threading.Thread(
                    target=self._process_audio,
                    args=(mono.copy(), samplerate),
                    daemon=True,
                ).start()
            except Exception as e:
                logging.error(f"VoiceEngine loop error: {e}")
                time.sleep(1)

    def record(self, duration: float, samplerate: int = 16000) -> np.ndarray:
        """
        Capture a single mono clip through the shared mic lock. Used by the
        foreground /audio/listen path so it is serialized against the wake-word
        loop instead of fighting it for the device. Blocking — run in a thread.
        """
        with self.mic_lock:
            audio = sd.rec(
                int(samplerate * duration),
                samplerate=samplerate,
                channels=1,
                dtype="int16",
            )
            sd.wait()
        return audio.reshape(-1)

    def start(self):
        with self.lock:
            if self.is_listening:
                return
            self.is_listening = True
            self.thread = threading.Thread(target=self._listen_loop, daemon=True)
            self.thread.start()
            logging.info("VoiceEngine started listening for wake word (local Whisper).")

    def stop(self):
        with self.lock:
            if not self.is_listening:
                return
            self.is_listening = False
            thread = self.thread
        # Wait (outside self.lock, to avoid deadlocking start/stop) for the loop
        # to finish its in-flight capture and release the mic. Without this the
        # caller could grab the device while the loop's last sd.rec is still
        # open. join timeout comfortably exceeds one capture block (2.5s).
        if thread and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=4.0)
        logging.info("VoiceEngine stopped.")


voice_engine = VoiceEngine()
