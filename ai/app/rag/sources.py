"""Collectors for public NC State information. Each returns Cards.

Sources, all public and allowed by their robots.txt at the time of writing:
  - NC State events calendar API (calendar.ncsu.edu, Localist): upcoming campus events
  - NC State News RSS (news.ncsu.edu/feed): university news
  - GoPack RSS (gopack.com/rss): Wolfpack athletics news
  - Wikipedia API: background articles (CC BY-SA 4.0, attributed per card)
  - src/data/campusOsm.json (OpenStreetMap, ODbL): where buildings are

Not used: social media (terms forbid scraping, and posts belong to real, identifiable people)
and the Technician site, which refuses automated clients. Cards keep a title, a short excerpt
and a link, never whole articles.
"""
from __future__ import annotations

import html
import json
import logging
import math
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path

import httpx

from .cards import Card
from .topics import CAMPUS, GENERAL, tag

log = logging.getLogger("ai.rag")

USER_AGENT = "campus-sim-rag/0.1 (educational game prototype; non-commercial)"
# Wikimedia's robot policy (https://w.wiki/4wJS) asks automated clients for contact details in the
# User-Agent. Set RAG_CONTACT in .env.local (an email or a project URL) to collect Wikipedia cards.
TIMEOUT = 20
POLITE_DELAY = 1.0  # seconds between requests to one host (calendar.ncsu.edu asks for 1)
EXCERPT = 260

CALENDAR_API = "https://calendar.ncsu.edu/api/2/events"
NEWS_RSS = "https://news.ncsu.edu/feed/"
ATHLETICS_RSS = "https://gopack.com/rss?path=general"
WIKI_API = "https://en.wikipedia.org/w/api.php"

ROOT = Path(__file__).resolve().parents[3]
OSM_FILE = ROOT / "src" / "data" / "campusOsm.json"


def client(contact: str = "") -> httpx.Client:
    ua = f"{USER_AGENT[:-1]}; {contact})" if contact else USER_AGENT
    return httpx.Client(headers={"User-Agent": ua}, timeout=TIMEOUT, follow_redirects=True)


def clean(text: str | None) -> str:
    t = html.unescape(re.sub(r"<[^>]+>", " ", text or "")).replace("�", "-")
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"The post .* appeared first on .*$", "", t).strip()
    return t


def excerpt(text: str, limit: int = EXCERPT) -> str:
    t = clean(text)
    if len(t) <= limit:
        return t
    cut = t[:limit]
    end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    return cut[: end + 1] if end > limit * 0.5 else cut.rsplit(" ", 1)[0] + "…"


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60]


# ---------------------------------------------------------------- events calendar

def fetch_events(c: httpx.Client, days: int = 4, max_pages: int = 4) -> list[Card]:
    out: list[Card] = []
    for page in range(1, max_pages + 1):
        r = c.get(CALENDAR_API, params={"days": days, "pp": 100, "page": page})
        r.raise_for_status()
        data = r.json()
        for wrap in data.get("events", []):
            card = _event_card(wrap.get("event", {}))
            if card:
                out.append(card)
        total = data.get("page", {}).get("total", 1)
        if page >= total:
            break
        time.sleep(POLITE_DELAY)
    return out


def _event_card(e: dict) -> Card | None:
    title = clean(e.get("title"))
    inst = (e.get("event_instances") or [{}])[0].get("event_instance", {})
    if not title or not inst.get("start") or e.get("status") == "canceled":
        return None
    place = clean(e.get("location_name")) or clean(e.get("location"))
    room = clean(e.get("room_number"))
    if e.get("experience") == "virtual":
        place = "online"
    types = [t.get("name", "") for t in (e.get("filters") or {}).get("event_types", [])]
    depts = [d.get("name", "") for d in e.get("departments") or []]
    body = clean(e.get("description_text"))
    # Tag from the title, the start of the description and the calendar's own labels; a whole
    # description mentions too much in passing.
    topics = tag(" ".join([title, excerpt(body, 160), " ".join(types), " ".join(e.get("tags") or [])]))
    return Card(
        id=f"event:{e.get('id') or slug(title)}:{inst['start'][:10]}",
        kind="event", title=title, text=excerpt(body, 200),
        source="NC State events calendar", url=e.get("localist_url") or "",
        topics=topics, places=[p for p in [place + (f", {room}" if room else "")] if p],
        start=inst.get("start"), end=inst.get("end") or inst.get("start"),
    )


# ---------------------------------------------------------------- RSS feeds

def fetch_rss(c: httpx.Client, url: str, kind: str, source: str, extra_topics: list[str], days: int = 10) -> list[Card]:
    r = c.get(url)
    r.raise_for_status()
    root = ET.fromstring(r.content)
    cutoff = datetime.now().astimezone() - timedelta(days=days)
    out = []
    for item in root.iter("item"):
        title = clean(item.findtext("title"))
        link = (item.findtext("link") or "").strip()
        try:
            pub = parsedate_to_datetime(item.findtext("pubDate") or "")
        except (TypeError, ValueError):
            continue
        if not title or pub < cutoff:
            continue
        desc = item.findtext("description") or ""
        cats = [clean(x.text) for x in item.findall("category")]
        out.append(Card(
            id=f"{kind}:{slug(link or title)}", kind=kind, title=title, text=excerpt(desc),
            source=source, url=link, topics=tag(f"{title} {excerpt(desc, 160)} {' '.join(cats)}", extra_topics),
            published=pub.isoformat(),
        ))
    return out


def fetch_news(c: httpx.Client) -> list[Card]:
    return fetch_rss(c, NEWS_RSS, "news", "NC State News", [CAMPUS])


def fetch_athletics(c: httpx.Client) -> list[Card]:
    return fetch_rss(c, ATHLETICS_RSS, "athletics", "GoPack.com", ["athletics", CAMPUS])


# ---------------------------------------------------------------- Wikipedia (static)

# Article title -> topics. Background every character can lean on.
WIKI_PAGES: dict[str, list[str]] = {
    "North Carolina State University": [GENERAL],
    "NC State Wolfpack": [GENERAL, "athletics"],
    "NC State Wolfpack football": ["athletics"],
    "NC State Wolfpack men's basketball": ["athletics"],
    "NC State Wolfpack women's basketball": ["athletics"],
    "Reynolds Coliseum": [GENERAL, "athletics"],
    "Carter–Finley Stadium": [GENERAL, "athletics"],
    "Lenovo Center": ["athletics"],
    "D. H. Hill Jr. Library": [GENERAL, "academics"],
    "James B. Hunt Jr. Library": [GENERAL, "academics", "technology"],
    "Centennial Campus": [GENERAL, "research", "engineering"],
    "Memorial Belltower (North Carolina State University)": [GENERAL],
    "Technician (newspaper)": [GENERAL, "clubs"],
    "WKNC-FM": ["arts", "clubs"],
    "Krispy Kreme Challenge": [GENERAL, "wellness"],
    "Hillsborough Street": [GENERAL, "dining"],
    "NC State College of Engineering": ["engineering"],
    "Phytotron": ["biology", "research"],
    "Gregg Museum of Art & Design": ["arts"],
    "J. C. Raulston Arboretum": ["biology"],
}
WIKI_PARAGRAPHS = 8
WIKI_LICENSE = "CC BY-SA 4.0"
SKIP_SECTIONS = re.compile(r"^(see also|references|notes|external links|further reading|notable (alumni|people|faculty)|alumni|presidents|chancellors|head coaches|coaching staff|roster)", re.I)


def fetch_wikipedia(c: httpx.Client, pages: dict[str, list[str]] = WIKI_PAGES) -> list[Card]:
    out: list[Card] = []
    for title, topics in pages.items():
        try:
            r = c.get(WIKI_API, params={"action": "query", "prop": "extracts", "explaintext": 1, "redirects": 1,
                                        "titles": title, "format": "json", "formatversion": 2})
            r.raise_for_status()
            page = r.json()["query"]["pages"][0]
        except Exception as e:
            log.warning("wikipedia %s: %s", title, e)
            continue
        if page.get("missing"):
            log.info("wikipedia: no article %s", title)
            continue
        url = "https://en.wikipedia.org/wiki/" + page["title"].replace(" ", "_")
        n = 0
        section = ""
        for block in page.get("extract", "").split("\n"):
            block = block.strip()
            m = re.match(r"^=+\s*(.+?)\s*=+$", block)
            if m:
                section = m.group(1)
                continue
            if section and SKIP_SECTIONS.match(section):
                continue
            if len(block) < 120:
                continue
            # Skip paragraphs that are someone's quote ('Name: "..."' or opening with a quote):
            # they are a real person's words, not campus facts.
            if block.startswith(("\"", "“")) or re.match(r"^[^.\"“]{0,60}:\s*[\"“]", block):
                continue
            n += 1
            out.append(Card(
                id=f"wiki:{slug(page['title'])}:{n}", kind="fact", title=page["title"] + (f" — {section}" if section else ""),
                text=excerpt(block, 420), source=f"Wikipedia: {page['title']}", url=url,
                topics=topics, license=WIKI_LICENSE,
            ))
            if n >= WIKI_PARAGRAPHS:
                break
        time.sleep(0.3)
    return out


# ---------------------------------------------------------------- campus places from OSM (static)

def osm_places(path: Path = OSM_FILE) -> list[Card]:
    """One card per named campus building: which part of campus, and what is next to it."""
    if not path.exists():
        return []
    d = json.loads(path.read_text(encoding="utf-8"))
    rail = [l["p"] for l in d["lines"] if l["k"] == "rail"]
    dan_allen = [l["p"] for l in d["lines"] if l.get("name") == "Dan Allen Drive"]
    dan_x = min((p[i] for p in dan_allen for i in range(0, len(p), 2)), default=200)

    def rail_y(x: float) -> float | None:
        for p in rail:
            for i in range(0, len(p) - 3, 2):
                ax, ay, bx, by = p[i:i + 4]
                if min(ax, bx) <= x <= max(ax, bx) and ax != bx:
                    return ay + (x - ax) / (bx - ax) * (by - ay)
        return None

    seen: dict[str, tuple[float, float, str]] = {}
    for b in d["buildings"]:
        name = b.get("name")
        if not name or name in seen:
            continue
        p = b["p"]
        cx = sum(p[0::2]) / (len(p) / 2)
        cy = sum(p[1::2]) / (len(p) / 2)
        ry = rail_y(cx)
        if cx < dan_x:
            area = "West Campus"
        elif ry is not None and cy < ry:
            area = "North Campus, north of the railroad tracks"
        else:
            area = "Central Campus, south of the railroad tracks"
        seen[name] = (cx, cy, area)
    out = []
    for name, (x, y, area) in seen.items():
        near = sorted((math.hypot(x - x2, y - y2), n2) for n2, (x2, y2, _) in seen.items() if n2 != name)[:3]
        out.append(Card(
            id=f"place:{slug(name)}", kind="place", title=name,
            text=f"{name} is on {area}, near {', '.join(n for _, n in near)}.",
            source="OpenStreetMap", url="https://www.openstreetmap.org/copyright",
            topics=[GENERAL], places=[name], license="ODbL",
        ))
    return out
