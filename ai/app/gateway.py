"""The one place model calls leave from. OpenAI-style chat format for every provider."""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Literal, Protocol

import httpx

from .config import Provider

log = logging.getLogger("ai.gateway")
Tier = Literal["small", "large"]


@dataclass
class ChatResult:
    content: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0


@dataclass
class Usage:
    tier: Tier = "small"
    calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0

    def add(self, r: ChatResult) -> None:
        self.calls += 1
        self.prompt_tokens += r.prompt_tokens
        self.completion_tokens += r.completion_tokens

    def as_dict(self) -> dict:
        return {"tier": self.tier, "calls": self.calls, "promptTokens": self.prompt_tokens, "completionTokens": self.completion_tokens}


class Chat(Protocol):
    async def __call__(self, messages: list[dict], tier: Tier, max_tokens: int = 500, temperature: float = 0.8) -> ChatResult | None: ...


@dataclass
class Gateway:
    provider: Provider | None
    client: httpx.AsyncClient = field(default_factory=lambda: httpx.AsyncClient())

    async def __call__(self, messages: list[dict], tier: Tier, max_tokens: int = 500, temperature: float = 0.8) -> ChatResult | None:
        p = self.provider
        if p is None:
            return None
        model = p.models[tier]
        payload: dict = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": min(max_tokens, 1500),
            "response_format": {"type": "json_object"},
        }
        # Reasoning models spend output tokens on thinking; keep that short.
        if "gpt-oss" in model:
            payload["reasoning_effort"] = "low"
        if p.name == "ollama" and re.search(r"qwen3|deepseek-r1", model):
            payload["reasoning_effort"] = "none"
        headers = {"Authorization": f"Bearer {p.key}"} if p.key else {}
        try:
            r = await self.client.post(p.url, json=payload, headers=headers, timeout=p.timeout_s)
        except httpx.HTTPError as e:
            log.warning("model call failed: %r", e)
            return None
        if r.status_code != 200:
            log.warning("upstream %s: %s", r.status_code, r.text[:300])
            return None
        data = r.json()
        usage = data.get("usage") or {}
        content = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        return ChatResult(content, model, int(usage.get("prompt_tokens") or 0), int(usage.get("completion_tokens") or 0))
