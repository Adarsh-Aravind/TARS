from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

class Settings(BaseSettings):
    # LLM Settings
    LLM_PROVIDER: str = "ollama"  # ollama, openai, gemini
    LLM_MODEL: str = "qwen2.5:7b"  # Defaulting to an instruction-following model like qwen2.5
    TEMPERATURE: float = 0.1
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    
    # API Keys for Cloud Fallback
    OPENAI_API_KEY: Optional[str] = None
    GEMINI_API_KEY: Optional[str] = None
    ELEVENLABS_API_KEY: Optional[str] = None
    
    MAX_TOKENS: int = 1024
    RATE_LIMIT_RPM: int = 60
    SQLITE_PATH: str = "./jarvis.db"
    WHISPER_MODEL: str = "tiny.en"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

settings = Settings()
