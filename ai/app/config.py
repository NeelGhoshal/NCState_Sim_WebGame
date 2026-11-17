"""Provider selection. Keys come from the repo-root .env.local and never leave this server."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]

DEFAULT_MODELS: dict[str, dict[str, str]] = {
    "groq": {"small": "openai/gpt-oss-20b", "large": "openai/gpt-oss-120b"},
    "openrouter": {"small": "openai/gpt-oss-20b:free", "large": "openai/gpt-oss-120b:free"},
    "ollama": {"small": "qwen3:8b", "large": "qwen3:8b"},
}


@dataclass(frozen=True)
class Provider:
    name: str
    url: str
    key: str | None
    models: dict[str, str]
    timeout_s: float


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for name in (".env", ".env.local"):
        env.update({k: v for k, v in dotenv_values(ROOT / name).items() if v is not None})
    env.update({k: v for k, v in os.environ.items() if k.startswith(("LLM_", "GROQ_", "OPENROUTER_", "OLLAMA_"))})
    return env


def pick_provider(env: dict[str, str]) -> Provider | None:
    name = (env.get("LLM_PROVIDER") or "").strip().lower()
    if not name:
        name = "groq" if env.get("GROQ_API_KEY") else "openrouter" if env.get("OPENROUTER_API_KEY") else ""
    if name not in DEFAULT_MODELS:
        return None
    models = {
        "small": env.get("LLM_MODEL_SMALL") or DEFAULT_MODELS[name]["small"],
        "large": env.get("LLM_MODEL_LARGE") or DEFAULT_MODELS[name]["large"],
    }
    if name == "groq":
        key = env.get("GROQ_API_KEY")
        return Provider(name, "https://api.groq.com/openai/v1/chat/completions", key, models, 15) if key else None
    if name == "openrouter":
        key = env.get("OPENROUTER_API_KEY")
        return Provider(name, "https://openrouter.ai/api/v1/chat/completions", key, models, 20) if key else None
    base = (env.get("OLLAMA_URL") or "http://localhost:11434").rstrip("/")
    return Provider(name, f"{base}/v1/chat/completions", None, models, 60)
