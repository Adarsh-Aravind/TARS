from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

class Settings(BaseSettings):
    # LLM Settings
    LLM_PROVIDER: str = "groq"  # groq, ollama, openai, gemini
    LLM_MODEL: str = "llama-3.3-70b-versatile"  # Groq default; reliable tool calling
    TEMPERATURE: float = 0.1
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    GROQ_BASE_URL: str = "https://api.groq.com/openai/v1"

    # API Keys for Cloud Fallback
    GROQ_API_KEY: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None
    GEMINI_API_KEY: Optional[str] = None

    MAX_TOKENS: int = 1024
    RATE_LIMIT_RPM: int = 60
    SQLITE_PATH: str = "./tars.db"
    WHISPER_MODEL: str = "tiny.en"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

settings = Settings()
