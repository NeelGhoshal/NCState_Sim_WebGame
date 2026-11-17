"""AI service for the campus sim. Stateless: the TypeScript client sends a snapshot of what
each call needs, and gets back validated output plus token usage. When a call fails or
the output is invalid, the reply says so and the client falls back to scripted lines."""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import datetime

from fastapi import FastAPI

from . import prompts
from .config import load_env, pick_provider
from .content_filter import blocked
from .gateway import Chat, Gateway, Tier, Usage
from .models import EpilogueRequest, RecapRequest, ReflectRequest, TurnRequest
from .rag import Retriever, prompt_lines
from .rag.ingest import daily_is_fresh, run_daily
from .rag.retrieve import when
from .validate import Invalid, validate_epilogue, validate_recap, validate_reflection, validate_turn

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("ai")


def refresh_hours(env: dict[str, str]) -> float:
    try:
        return max(0.0, float(env.get("RAG_REFRESH_HOURS", "6")))
    except ValueError:
        return 6.0


def create_app(chat: Chat | None = None, provider_info: dict | None = None,
               rag: Retriever | None = None, refresh: float | None = None) -> FastAPI:
    """`chat`, `provider_info` and `rag` are injectable for tests. `refresh` is how often, in
    hours, to collect campus happenings in the background; 0 turns it off (the default in tests)."""
    env = load_env()
    provider = pick_provider(env) if chat is None else None
    injected = chat is not None
    chat = chat or Gateway(provider)
    info = provider_info or {
        "configured": provider is not None,
        "provider": provider.name if provider else None,
        "models": provider.models if provider else None,
    }
    rag = rag or Retriever()
    hours = refresh if refresh is not None else (0 if injected else refresh_hours(env))
    refresh_state: dict = {"every_hours": hours, "last": None, "result": None}

    async def refresh_loop() -> None:
        """Collects today's events and news when the newest file is stale, then reloads the
        index. Runs in a worker thread so requests are never blocked by the network."""
        while True:
            try:
                if not daily_is_fresh(max_age_hours=hours):
                    refresh_state["result"] = await asyncio.to_thread(run_daily)
                    refresh_state["last"] = datetime.now().astimezone().isoformat()
                    log.info("rag refresh: %s", refresh_state["result"])
                await asyncio.to_thread(rag.reload)
            except Exception as e:  # never let a refresh failure stop the service
                log.warning("rag refresh failed: %s", e)
            await asyncio.sleep(hours * 3600)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        task = asyncio.create_task(refresh_loop()) if hours > 0 else None
        yield
        if task:
            task.cancel()

    app = FastAPI(title="Campus sim AI service", lifespan=lifespan)

    async def run(messages: list[dict], tier: Tier, max_tokens: int):
        usage = Usage(tier=tier)
        if not info["configured"]:
            return None, usage
        r = await chat(messages, tier, max_tokens)
        if r is None:
            return None, usage
        usage.add(r)
        return r.content, usage

    def failed(reason: str, usage: Usage) -> dict:
        log.info("fallback: %s", reason)
        return {"ok": False, "reason": reason, "usage": usage.as_dict()}

    @app.get("/api/llm/status")
    async def status() -> dict:
        return {"server": True, **info}

    @app.get("/api/rag/status")
    async def rag_status() -> dict:
        return {**rag.stats(), "refresh": refresh_state}

    @app.get("/api/rag/search")
    async def rag_search(q: str = "", agent: str = "debug", topics: str = "all", k: int = 5) -> dict:
        """What a character would retrieve for a line. For checking the corpus by hand."""
        hits = rag.search(agent, [t for t in topics.split(",") if t], q, k=min(k, 20))
        return {"hits": [{"score": round(h.score, 2), **h.card.to_dict()} for h in hits]}

    @app.post("/api/agent/turn")
    async def turn(req: TurnRequest) -> dict:
        if blocked(req.playerText):
            return {"ok": True, "filtered": True, "turn": {
                "say": "Let's talk about something else.", "action": "none", "action_arg": "",
                "relationship_delta": -1, "replies": [], "memory": ""}, "warnings": ["player input filtered"], "usage": Usage().as_dict()}
        a = req.agent
        recent = " ".join(l.text for l in req.history[-2:])
        hits = rag.search(a.id, a.topics, f"{req.playerText} {recent}", places=a.activity)
        happenings, background = prompt_lines(hits)
        raw, usage = await run(prompts.turn_messages(req, happenings, background), "small", 450)
        if raw is None:
            return failed("no model output", usage)
        try:
            t, warnings = validate_turn(raw, req.allowed)
        except Invalid as e:
            return failed(f"invalid turn: {e}", usage)
        if blocked(t.say):
            return failed("model output filtered", usage)
        return {"ok": True, "turn": asdict(t), "warnings": warnings, "usage": usage.as_dict(),
                "sources": [{"title": h.card.title, "source": h.card.source, "url": h.card.url} for h in hits]}

    @app.post("/api/agent/reflect")
    async def reflect(req: ReflectRequest) -> dict:
        soon = rag.upcoming(req.agentId, req.topics) if req.agentId else []
        upcoming = [f"- {c.title} ({when(c, datetime.now().astimezone())}"
                    f"{', ' + c.places[0] if c.places else ''})" for c in soon]
        raw, usage = await run(prompts.reflect_messages(req, upcoming), "large", 500)
        if raw is None:
            return failed("no model output", usage)
        try:
            r = validate_reflection(raw)
        except Invalid as e:
            return failed(f"invalid reflection: {e}", usage)
        if blocked(r["summary"] + " " + r["text"]):
            return failed("model output filtered", usage)
        return {"ok": True, "reflection": r, "usage": usage.as_dict()}

    @app.post("/api/director/recap")
    async def recap(req: RecapRequest) -> dict:
        raw, usage = await run(prompts.recap_messages(req), "large", 450)
        if raw is None:
            return failed("no model output", usage)
        try:
            return {"ok": True, **validate_recap(raw), "usage": usage.as_dict()}
        except Invalid as e:
            return failed(f"invalid recap: {e}", usage)

    @app.post("/api/director/epilogue")
    async def epilogue(req: EpilogueRequest) -> dict:
        raw, usage = await run(prompts.epilogue_messages(req), "large", 700)
        if raw is None:
            return failed("no model output", usage)
        try:
            return {"ok": True, **validate_epilogue(raw, [c.id for c in req.characters]), "usage": usage.as_dict()}
        except Invalid as e:
            return failed(f"invalid epilogue: {e}", usage)

    return app


app = create_app()
