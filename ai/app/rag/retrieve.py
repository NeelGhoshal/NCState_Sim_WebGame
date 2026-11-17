"""Picks the few cards worth putting in a prompt.

One lookup per call, no extra model calls: dialogue has a timeout and a scripted fallback,
so retrieval must be cheap. The character only sees cards they would plausibly know
(topics.knows), and time-bound cards only while they are current.
"""
from __future__ import annotations

import logging
import re
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from .cards import DATA_DIR, NEWS_DAYS, Card, load_all
from .index import Bm25, tokens
from .topics import knows

log = logging.getLogger("ai.rag")

DAILY_KINDS = {"event", "news", "athletics"}
EVENT_AHEAD_DAYS = 3
# "What's going on?" deserves a few happenings, not one.
ASKS_WHATS_ON = re.compile(r"what'?s (up|on|going on|happening)|anything (fun|good|going on|happening|to do)|"
                           r"(events?|tonight|this week(end)?|plans?)|what (should|can) (i|we) do", re.I)


@dataclass
class Hit:
    card: Card
    score: float


def series(title: str) -> str:
    """'GIS Week: GeoAI Workshop' -> 'gis week'. Titles without a prefix are their own series."""
    head, sep, _ = title.partition(":")
    return (head if sep and len(head) >= 4 else title).strip().lower()


def now_local() -> datetime:
    return datetime.now().astimezone()


def is_current(c: Card, now: datetime) -> bool:
    if c.kind == "event":
        start, end = c.start_dt(), c.end_dt()
        if not start or not end:
            return False
        # An all-day event's end can equal its start; keep it for the whole day.
        end = max(end, start.replace(hour=23, minute=59))
        return end >= now and start <= now + timedelta(days=EVENT_AHEAD_DAYS)
    if c.kind in ("news", "athletics"):
        pub = c.published_dt()
        return bool(pub) and now - pub <= timedelta(days=NEWS_DAYS)
    return True


def when(c: Card, now: datetime) -> str:
    """'today at 7 PM', 'tomorrow', 'Thursday', or 'this week' for news."""
    if c.kind != "event":
        return "in the news this week" if c.kind == "news" else "in Wolfpack sports news"
    start = c.start_dt()
    assert start
    start = start.astimezone(now.tzinfo)
    days = (start.date() - now.date()).days
    day = "today" if days <= 0 else "tomorrow" if days == 1 else start.strftime("%A")
    if start.hour == 0 and start.minute == 0:
        return f"{day} (all day)" if days > 0 or start <= now else day
    t = start.strftime("%I:%M %p").lstrip("0").replace(":00 ", " ")
    return f"{day} at {t}"


class Retriever:
    """Holds the card set and its index. `reload` swaps both in one assignment, so a request
    that is reading never sees a half-built index."""

    def __init__(self, data_dir: Path = DATA_DIR, cards: list[Card] | None = None):
        self.data_dir = data_dir
        self.loaded_at: datetime | None = None
        self._lock = threading.Lock()
        self._state: tuple[list[Card], Bm25] = ([], Bm25([]))
        if cards is not None:
            self._set(cards)
        else:
            self.reload()

    def _set(self, cards: list[Card]) -> None:
        self._state = (cards, Bm25(cards))
        self.loaded_at = now_local()

    def reload(self) -> int:
        with self._lock:
            try:
                cards = load_all(self.data_dir)
            except Exception as e:  # a bad file must not take the service down
                log.warning("rag reload failed: %s", e)
                return len(self._state[0])
            self._set(cards)
            log.info("rag: %d cards loaded", len(cards))
            return len(cards)

    @property
    def cards(self) -> list[Card]:
        return self._state[0]

    def search(self, agent_id: str, topics: list[str], query: str, k: int = 4,
               now: datetime | None = None, places: str = "") -> list[Hit]:
        """Best cards for this character and this moment. Always tries to include one current
        happening, so characters have something new to bring up even after "hi"."""
        now = now or now_local()
        cards, index = self._state
        scores = index.scores(f"{query} {places}")
        place_toks = set(tokens(places))
        my_topics = set(topics)
        hits: list[Hit] = []
        fresh: list[Hit] = []
        for c, s in zip(cards, scores):
            if not knows(agent_id, topics, c) or not is_current(c, now):
                continue
            daily = c.kind in DAILY_KINDS
            bonus = 0.0
            if daily:
                # Interest and immediacy make a happening worth mentioning unprompted.
                bonus += 0.6 * len(my_topics & set(c.topics))
                start = c.start_dt()
                if start and (start.date() - now.date()).days <= 0:
                    bonus += 0.8
                if place_toks & set(tokens(" ".join(c.places))):
                    bonus += 1.0
                fresh.append(Hit(c, s + bonus))
            if s > 0:
                hits.append(Hit(c, s + bonus))
        hits.sort(key=lambda h: h.score, reverse=True)
        # Multi-day events appear once per day, and series ("GIS Week: ...") have many parts;
        # keep the best of each so one series cannot fill the prompt.
        titles: set[str] = set()
        hits = [h for h in hits if not (series(h.card.title) in titles or titles.add(series(h.card.title)))]
        out = hits[:k]
        want = 3 if ASKS_WHATS_ON.search(query) else 1
        have = sum(1 for h in out if h.card.kind in DAILY_KINDS)
        if have < want and fresh:
            fresh.sort(key=lambda h: (h.score, h.card.id), reverse=True)
            ids = {h.card.id for h in out}
            extra = [h for h in fresh if h.card.id not in ids and not (series(h.card.title) in titles or titles.add(series(h.card.title)))]
            extra = extra[: want - have]
            out = out[: k - len(extra)] + extra
        return out

    def upcoming(self, agent_id: str, topics: list[str], days: int = 1, k: int = 3,
                 now: datetime | None = None) -> list[Card]:
        """Events this character knows about in the next `days` days, soonest first."""
        now = now or now_local()
        horizon = now + timedelta(days=days + 1)
        out = [c for c in self.cards if c.kind == "event" and knows(agent_id, topics, c) and is_current(c, now)
               and (c.start_dt() or horizon) < horizon]
        out.sort(key=lambda c: (-len(set(topics) & set(c.topics)), c.start or ""))
        return out[:k]

    def stats(self) -> dict:
        cards = self.cards
        by_kind: dict[str, int] = {}
        for c in cards:
            by_kind[c.kind] = by_kind.get(c.kind, 0) + 1
        now = now_local()
        return {"cards": len(cards), "byKind": by_kind,
                "current": sum(1 for c in cards if c.kind in DAILY_KINDS and is_current(c, now)),
                "loadedAt": self.loaded_at.isoformat() if self.loaded_at else None}


def prompt_lines(hits: list[Hit], now: datetime | None = None) -> tuple[list[str], list[str]]:
    """Splits hits into (happenings, background) lines for the prompt."""
    now = now or now_local()
    happenings, background = [], []
    for h in hits:
        c = h.card
        if c.kind in DAILY_KINDS:
            where = f" at {c.places[0]}" if c.places else ""
            text = f" — {c.text}" if c.text else ""
            happenings.append(f"- {c.title} ({when(c, now)}{where}){text}")
        else:
            background.append(f"- {c.text}")
    return happenings, background
