"""Retrieval: tagging, who knows what, freshness, search, the collectors and the endpoints.
No test touches the network: collectors run against httpx.MockTransport."""
import json
from datetime import datetime, timedelta

import httpx
from fastapi.testclient import TestClient

from app.gateway import ChatResult
from app.main import create_app
from app.rag import Card, Retriever
from app.rag import ingest, sources
from app.rag.cards import read_jsonl, write_jsonl
from app.rag.retrieve import is_current, when
from app.rag.topics import CAMPUS, knows, tag

NOW = datetime(2026, 11, 16, 12, 0).astimezone()


def iso(dt: datetime) -> str:
    return dt.isoformat()


def ev(id_, title, topics, start, places=("Talley Student Union",), text=""):
    return Card(id=id_, kind="event", title=title, text=text, source="test", topics=list(topics),
                places=list(places), start=iso(start), end=iso(start + timedelta(hours=2)))


FACT = Card(id="f:tunnel", kind="fact", title="Free Expression Tunnel", text="Anyone can paint the tunnel.",
            source="test", topics=["general"])
BIO = ev("e:bio", "Plant Biology Seminar", ["biology", "research"], NOW + timedelta(hours=3), text="Talk on crops.")
HACK = ev("e:hack", "Hackathon Kickoff", ["engineering", "makers"], NOW + timedelta(days=1))
OLD = ev("e:old", "Old Event", ["biology"], NOW - timedelta(days=2))
NEWS = Card(id="n:1", kind="news", title="Researchers map soil microbes", text="A study of soil.", source="test",
            topics=["research", CAMPUS], published=iso(NOW - timedelta(days=1)))


def rag(*cards):
    return Retriever(cards=list(cards))


# ------------------------------------------------------------------ tagging and knowledge

def test_tag_finds_topics_and_defaults_to_campus():
    assert {"engineering", "makers"} <= set(tag("Robotics hackathon with 3D printing"))
    assert tag("Homecoming parade") == [CAMPUS]
    assert "athletics" in tag("Wolfpack football hosts Duke")
    assert "athletics" not in tag("Wolfpack Welcome Week picnic")  # 'Wolfpack' alone is not sports


def test_knows_by_topic_general_and_everything():
    assert knows("maya", ["biology"], BIO)
    assert not knows("jordan", ["engineering"], BIO)
    assert knows("jordan", ["engineering"], FACT)        # general facts reach everyone
    assert knows("walt", ["all"], BIO)                   # the information desk hears everything


def test_campus_wide_news_reaches_some_characters_not_all():
    cards = [Card(id=f"n:{i}", kind="news", title="x", text="", source="t", topics=[CAMPUS]) for i in range(200)]
    share = sum(knows("maya", [], c) for c in cards) / len(cards)
    assert 0.4 < share < 0.8
    # Stable: the same character always hears the same items
    assert [knows("maya", [], c) for c in cards] == [knows("maya", [], c) for c in cards]
    assert [knows("maya", [], c) for c in cards] != [knows("dev", [], c) for c in cards]


def test_currency_of_events_and_news():
    assert is_current(BIO, NOW) and is_current(HACK, NOW)
    assert not is_current(OLD, NOW)
    assert not is_current(ev("e:far", "Far", [], NOW + timedelta(days=9)), NOW)
    assert is_current(NEWS, NOW)
    stale = Card(id="n:2", kind="news", title="x", text="", source="t", published=iso(NOW - timedelta(days=30)))
    assert not is_current(stale, NOW)


def test_when_reads_naturally():
    assert when(BIO, NOW) == "today at 3 PM"
    assert when(HACK, NOW).startswith("tomorrow")


# ------------------------------------------------------------------ search

def test_search_finds_relevant_known_cards():
    r = rag(FACT, BIO, HACK, OLD, NEWS)
    hits = r.search("maya", ["biology", "research"], "any plant seminars today?", now=NOW)
    assert hits[0].card.id == "e:bio"
    assert all(h.card.id not in ("e:hack", "e:old") for h in hits)  # not hers, or over


def test_search_offers_a_happening_even_for_small_talk():
    hits = rag(FACT, HACK).search("jordan", ["engineering"], "hi", now=NOW)
    assert [h.card.id for h in hits] == ["e:hack"]


def test_search_drops_repeated_multi_day_events():
    a = ev("e:flag:1", "Flag Display", [CAMPUS], NOW + timedelta(hours=1))
    b = ev("e:flag:2", "Flag Display", [CAMPUS], NOW + timedelta(days=1))
    hits = rag(a, b).search("walt", ["all"], "flag display", now=NOW)
    assert len(hits) == 1


def test_upcoming_is_per_character():
    r = rag(BIO, HACK)
    assert [c.id for c in r.upcoming("jordan", ["engineering"], now=NOW)] == ["e:hack"]
    assert [c.id for c in r.upcoming("maya", ["biology"], now=NOW)] == ["e:bio"]


def test_cards_round_trip(tmp_path):
    p = tmp_path / "x.jsonl"
    write_jsonl(p, [BIO, FACT])
    assert [c.id for c in read_jsonl(p)] == ["e:bio", "f:tunnel"]


# ------------------------------------------------------------------ collectors (mocked network)

CAL = {"page": {"current": 1, "total": 1}, "events": [{"event": {
    "id": 7, "title": "Robot Petting Zoo", "description_text": "<p>Meet robots built by engineering students.</p>",
    "location_name": "Hunt Library", "room_number": "", "experience": "inperson",
    "event_instances": [{"event_instance": {"start": "2026-11-17T13:00:00-05:00", "end": "2026-11-17T15:00:00-05:00"}}],
    "localist_url": "https://calendar.example/robot", "filters": {"event_types": [{"name": "Exhibit"}]}, "tags": []}},
    {"event": {"id": 8, "title": "Cancelled thing", "status": "canceled", "event_instances": [{"event_instance": {"start": "2026-11-17T13:00:00-05:00"}}]}}]}
RSS = f"""<rss><channel>
<item><title>Wolfpack volleyball wins</title><link>https://example/vb</link><pubDate>{NOW.strftime('%a, %d %b %Y %H:%M:%S %z')}</pubDate>
<description>&lt;p&gt;The volleyball team won in five sets.&lt;/p&gt;</description></item>
<item><title>Ancient story</title><link>https://example/old</link><pubDate>Mon, 01 Jan 2024 10:00:00 +0000</pubDate><description>old</description></item>
</channel></rss>"""


def mock_client(*_a, **_k):
    def handler(req: httpx.Request) -> httpx.Response:
        if "calendar" in req.url.host:
            return httpx.Response(200, json=CAL)
        if "news.ncsu.edu" in req.url.host:
            return httpx.Response(500)
        return httpx.Response(200, text=RSS)
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_event_cards_parsed_and_tagged():
    with mock_client() as c:
        cards = sources.fetch_events(c)
    assert len(cards) == 1
    e = cards[0]
    assert e.title == "Robot Petting Zoo" and e.places == ["Hunt Library"] and "engineering" in e.topics
    assert e.text == "Meet robots built by engineering students."


def test_rss_keeps_recent_items_only():
    with mock_client() as c:
        cards = sources.fetch_athletics(c)
    assert [c.title for c in cards] == ["Wolfpack volleyball wins"]
    assert "athletics" in cards[0].topics and cards[0].text == "The volleyball team won in five sets."


def test_run_daily_survives_a_failing_source(tmp_path, monkeypatch):
    monkeypatch.setattr(sources, "client", mock_client)
    counts = ingest.run_daily(tmp_path)
    assert counts["events"] == 1 and counts["athletics"] == 1 and str(counts["news"]).startswith("failed")
    files = list((tmp_path / "daily").glob("*.jsonl"))
    assert len(files) == 1 and len(read_jsonl(files[0])) == 2
    assert ingest.daily_is_fresh(tmp_path)


def test_places_from_osm_data():
    cards = sources.osm_places()
    talley = next(c for c in cards if c.title == "Talley Student Union")
    assert "Central Campus" in talley.text and "near" in talley.text


# ------------------------------------------------------------------ endpoints

TURN = {
    "university": "NC State", "day": 1, "minute": 730,
    "player": {"name": "Alex", "pronouns": "they/them"},
    "agent": {"id": "maya", "name": "Maya Okafor", "pronouns": "she/her", "role": "roommate", "persona": "p", "speech": "s",
              "values": "v", "semesterGoal": "g", "goal": "g", "rel": 50, "note": "n", "activity": "eating lunch in Talley",
              "minutesLeft": 60, "memories": [], "topics": ["biology"]},
    "allowed": {"actions": ["none"], "argsFor": {}}, "history": [], "playerText": "anything fun going on?",
}


def capture_app(cards):
    seen = []

    async def chat(messages, tier, max_tokens=500, temperature=0.8):
        seen.append(messages)
        return ChatResult('{"say":"There is a plant talk later.","action":"none","relationship_delta":0}', "fake", 10, 5)
    info = {"configured": True, "provider": "fake", "models": {}}
    return TestClient(create_app(chat=chat, provider_info=info, rag=rag(*cards))), seen


def test_turn_prompt_carries_this_characters_happenings():
    # The endpoint reads the real clock, so these events are set relative to it.
    today = datetime.now().astimezone().replace(hour=23, minute=0)
    bio = ev("e:bio2", "Plant Biology Seminar", ["biology"], today)
    hack = ev("e:hack2", "Hackathon Kickoff", ["engineering"], today)
    c, seen = capture_app([FACT, bio, hack])
    r = c.post("/api/agent/turn", json=TURN).json()
    system = seen[0][0]["content"]
    assert r["ok"] and "Plant Biology Seminar" in system and "Hackathon" not in system
    assert "never by name" in system
    assert any(s["title"] == "Plant Biology Seminar" for s in r["sources"])


def test_rag_status_and_search():
    c, _ = capture_app([FACT])
    assert c.get("/api/rag/status").json()["cards"] == 1
    hits = c.get("/api/rag/search", params={"q": "paint tunnel", "agent": "maya", "topics": "biology"}).json()["hits"]
    assert hits[0]["id"] == "f:tunnel"


def test_reflect_sees_upcoming_events():
    soon = ev("e:soon", "Hackathon Kickoff", ["engineering"], datetime.now().astimezone() + timedelta(hours=20))
    c, seen = capture_app([soon])
    c.post("/api/agent/reflect", json={"day": 1, "agentId": "jordan", "topics": ["engineering"],
                                       "player": {"name": "Alex", "pronouns": "they/them"}, "agentName": "Jordan",
                                       "persona": "p", "semesterGoal": "g", "rel": 50, "memoriesToday": []})
    assert "Hackathon Kickoff" in seen[0][1]["content"]


def test_static_cards_are_valid_json():
    from app.rag.cards import CARDS_DIR
    for p in CARDS_DIR.glob("*.jsonl"):
        for c in read_jsonl(p):
            assert c.id and c.text and c.source, (p.name, c.id)
            json.dumps(c.to_dict())


def test_whats_on_question_gets_several_happenings():
    cards = [ev(f"e:{i}", f"Biology Event {i}", ["biology"], NOW + timedelta(hours=i + 1)) for i in range(5)]
    hits = rag(FACT, *cards).search("maya", ["biology"], "what's going on around campus?", now=NOW)
    assert sum(h.card.kind == "event" for h in hits) == 3
    assert all(h.card.id != "f:tunnel" for h in hits)  # 'campus' alone is not a match


def test_one_item_per_event_series():
    parts = [ev(f"e:gis{i}", f"GIS Week: Talk {i}", ["engineering"], NOW + timedelta(hours=i + 1)) for i in range(4)]
    hits = rag(HACK, *parts).search("jordan", ["engineering"], "what's going on this week?", now=NOW)
    assert sum(h.card.title.startswith("GIS Week") for h in hits) == 1
