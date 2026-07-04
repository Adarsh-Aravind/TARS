import io
import wave
import time
import logging
import threading

import numpy as np
import sounddevice as sd

from services.transcription import transcribe_sync

# Wake phrase. Whisper is accurate enough that we can match on the actual word
# instead of the loose "tar"/"cars"/"stars" homophones the old Google path used.
WAKE_WORDS = ("tars",)


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
            text = transcribe_sync(self._to_wav(audio_int16, samplerate)).lower()
            if any(word in text for word in WAKE_WORDS):
                logging.info(f"Wake word detected in: '{text}'")
                self.wakeup_event.set()
        except Exception as e:
            logging.error(f"VoiceEngine transcription error: {e}")
        finally:
            self._busy = False

    def _listen_loop(self):
        samplerate = 16000
        duration = 2.5
        silence_threshold = 250  # mean absolute int16 amplitude gate

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
                        int(samplerate * duration),
                        samplerate=samplerate,
                        channels=1,
                        dtype="int16",
                    )
                    sd.wait()

                if not self.is_listening:
                    break

                mono = audio_data.reshape(-1)

                # Skip near-silence: saves CPU and avoids Whisper hallucinating
                # words out of background noise.
                if np.abs(mono).mean() < silence_threshold:
                    continue

                # Drop this block if the previous one is still transcribing.
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
