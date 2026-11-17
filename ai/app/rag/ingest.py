"""Collects cards from the sources and writes them to ai/data.

    python -m app.rag.ingest            daily happenings (events, news, athletics)
    python -m app.rag.ingest --static   background cards (Wikipedia, campus places)
    python -m app.rag.ingest --all      both

From the repo root: `npm run rag:update` (daily) or `npm run rag:static`. The AI service also
runs the daily collection on its own every RAG_REFRESH_HOURS (see main.py).
"""
from __future__ import annotations

import argparse
import logging
from datetime import datetime
from pathlib import Path

from ..config import load_env
from .cards import DAILY_FILES_KEPT, DATA_DIR, Card, write_jsonl
from . import sources

log = logging.getLogger("ai.rag")


def run_daily(data_dir: Path = DATA_DIR) -> dict:
    """Fetches today's happenings into daily/<date>.jsonl. A source that fails is skipped;
    the others still land. Returns counts per source."""
    counts: dict[str, int | str] = {}
    cards: list[Card] = []
    with sources.client() as c:
        for name, fn in (("events", sources.fetch_events), ("news", sources.fetch_news), ("athletics", sources.fetch_athletics)):
            try:
                got = fn(c)
                cards += got
                counts[name] = len(got)
            except Exception as e:
                log.warning("rag %s failed: %s", name, e)
                counts[name] = f"failed: {e.__class__.__name__}"
    if not cards:
        return counts
    daily = data_dir / "daily"
    write_jsonl(daily / f"{datetime.now().astimezone():%Y-%m-%d}.jsonl", dedupe(cards))
    for old in sorted(daily.glob("*.jsonl"))[:-DAILY_FILES_KEPT]:
        old.unlink(missing_ok=True)
    return counts


def run_static(data_dir: Path = DATA_DIR) -> dict:
    out = data_dir / "cards"
    contact = load_env().get("RAG_CONTACT", "").strip()
    wiki: list[Card] = []
    if contact:
        with sources.client(contact) as c:
            wiki = sources.fetch_wikipedia(c)
    else:
        log.info("rag: RAG_CONTACT not set, skipping Wikipedia (its robot policy asks for contact details)")
    if wiki:
        write_jsonl(out / "wikipedia.jsonl", wiki)
    places = sources.osm_places()
    if places:
        write_jsonl(out / "places.jsonl", places)
    return {"wikipedia": len(wiki) if contact else "skipped (set RAG_CONTACT)", "places": len(places)}


def dedupe(cards: list[Card]) -> list[Card]:
    seen: dict[str, Card] = {}
    for c in cards:
        seen.setdefault(c.id, c)
    return list(seen.values())


def daily_is_fresh(data_dir: Path = DATA_DIR, max_age_hours: float = 6) -> bool:
    files = sorted((data_dir / "daily").glob("*.jsonl"))
    if not files:
        return False
    age = datetime.now().timestamp() - files[-1].stat().st_mtime
    return age < max_age_hours * 3600


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--static", action="store_true", help="background cards only")
    ap.add_argument("--all", action="store_true", help="background and daily cards")
    a = ap.parse_args()
    if a.static or a.all:
        print("static:", run_static())
    if not a.static or a.all:
        print("daily:", run_daily())


if __name__ == "__main__":
    main()
