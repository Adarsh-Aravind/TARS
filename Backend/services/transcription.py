import os
import tempfile
from faster_whisper import WhisperModel
from config import settings
import logging

logger = logging.getLogger(__name__)

# Load model globally to keep it in memory
try:
    logger.info(f"Loading Whisper model: {settings.WHISPER_MODEL}")
    whisper_model = WhisperModel(settings.WHISPER_MODEL, device="cpu", compute_type="int8")
except Exception as e:
    logger.error(f"Failed to load Whisper model: {e}")
    whisper_model = None

class TranscriptionService:
    @staticmethod
    async def transcribe_audio(audio_bytes: bytes) -> str:
        if not whisper_model:
            return "Transcription model not loaded."
            
        # Write bytes to a temp file because faster_whisper expects a file path or file-like object
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
                tmp.write(audio_bytes)
                tmp_path = tmp.name

            segments, info = whisper_model.transcribe(tmp_path, beam_size=5)
            
            transcript = " ".join([segment.text for segment in segments])
            
            # Cleanup
            os.remove(tmp_path)
            
            return transcript.strip()
        except Exception as e:
            logger.error(f"Transcription error: {e}")
            return f"Error: {str(e)}"
