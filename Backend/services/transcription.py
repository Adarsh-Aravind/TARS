import os
import asyncio
import tempfile
import logging

from config import settings

logger = logging.getLogger(__name__)

# Load the model once at import and keep it in memory. Shared by the HTTP
# transcription endpoint, the /audio/listen command capture, and the wake-word
# VoiceEngine — all local, nothing leaves the machine.
#
# Import is guarded: faster-whisper pulls in native libs (PyAV/ffmpeg) that can
# be missing or architecture-mismatched on some machines. A broken STT install
# must not take down the whole backend — it just disables voice features.
whisper_model = None
try:
    from faster_whisper import WhisperModel

    logger.info(f"Loading Whisper model: {settings.WHISPER_MODEL}")
    whisper_model = WhisperModel(settings.WHISPER_MODEL, device="cpu", compute_type="int8")
except Exception as e:
    logger.error(f"Whisper/faster-whisper unavailable, voice features disabled: {e}")
    whisper_model = None


def transcribe_sync(audio_bytes: bytes) -> str:
    """
    Transcribe WAV-encoded audio bytes locally with faster-whisper.
    Synchronous — safe to call from worker threads (the VoiceEngine loop).
    """
    if not whisper_model:
        return ""

    tmp_path = None
    try:
        # faster-whisper expects a path or file-like object.
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        segments, _info = whisper_model.transcribe(tmp_path, beam_size=5)
        return " ".join(segment.text for segment in segments).strip()
    except Exception as e:
        logger.error(f"Transcription error: {e}")
        return ""
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


class TranscriptionService:
    @staticmethod
    async def transcribe_audio(audio_bytes: bytes) -> str:
        # Offload the blocking model call to a thread so we don't stall the loop.
        return await asyncio.to_thread(transcribe_sync, audio_bytes)
