"""Knowledge cards: short, sourced snippets the characters can draw on.

Static cards (traditions, places, background) live in ai/data/cards/*.jsonl and are committed.
Daily cards (events, news, athletics) are written by the ingest job to ai/data/daily/<date>.jsonl,
are not committed, and age out. A card is data for a prompt, never game state.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
CARDS_DIR = DATA_DIR / "cards"
DAILY_DIR = DATA_DIR / "daily"

# How long a daily card stays usable after it was collected (news) or after it ends (events).
NEWS_DAYS = 10
DAILY_FILES_KEPT = 14


@dataclass
class Card:
    id: str
    kind: str                      # fact | place | event | news | athletics
    title: str
    text: str
    source: str                    # human-readable source name, for attribution
    url: str = ""
    topics: list[str] = field(default_factory=list)
    places: list[str] = field(default_factory=list)
    start: str | None = None       # ISO datetime, events only
    end: str | None = None
    published: str | None = None   # ISO datetime, news only
    license: str = ""

    @staticmethod
    def from_dict(d: dict) -> "Card":
        known = {k: d[k] for k in Card.__dataclass_fields__ if k in d}
        return Card(**known)

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v not in (None, "", [])}

    def start_dt(self) -> datetime | None:
        return _parse(self.start)

    def end_dt(self) -> datetime | None:
        return _parse(self.end) or self.start_dt()

    def published_dt(self) -> datetime | None:
        return _parse(self.published)


def _parse(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.astimezone()
    except ValueError:
        return None


def read_jsonl(path: Path) -> list[Card]:
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("//"):
            out.append(Card.from_dict(json.loads(line)))
    return out


def write_jsonl(path: Path, cards: list[Card]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text("".join(json.dumps(c.to_dict(), ensure_ascii=False) + "\n" for c in cards), encoding="utf-8")
    tmp.replace(path)


def load_all(data_dir: Path = DATA_DIR, daily_files: int = 3) -> list[Card]:
    """Static cards plus the newest few daily files. Later files win on duplicate ids."""
    cards: dict[str, Card] = {}
    for p in sorted((data_dir / "cards").glob("*.jsonl")):
        for c in read_jsonl(p):
            cards[c.id] = c
    for p in sorted((data_dir / "daily").glob("*.jsonl"))[-daily_files:]:
        for c in read_jsonl(p):
            cards[c.id] = c
    return list(cards.values())
