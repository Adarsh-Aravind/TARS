from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from services.transcription import TranscriptionService
from services.tts import TTSService

router = APIRouter()

class SynthesizeRequest(BaseModel):
    text: str
    voice: str = "en-US-AriaNeural"

@router.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """
    Accepts an audio file upload and returns the text transcript.
    """
    try:
        content = await file.read()
        transcript = await TranscriptionService.transcribe_audio(content)
        return {"transcript": transcript}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/synthesize")
async def synthesize_audio(req: SynthesizeRequest):
    """
    Accepts text and returns a streaming audio response.
    """
    try:
        audio_stream = TTSService.synthesize(req.text, req.voice)
        return StreamingResponse(audio_stream, media_type="audio/mpeg")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
