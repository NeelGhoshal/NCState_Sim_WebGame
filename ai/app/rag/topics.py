"""Topic tags for cards, and who hears about what.

Each character has a list of topics (sent by the client, from src/data/agents.ts). A character
knows a card when they share a topic with it. Campus-wide cards reach most characters, but
not all: who hears what is decided by a stable hash, so each character ends up with their
own slice of the day's news instead of everyone repeating the same headline.
"""
from __future__ import annotations

import hashlib
import re

from .cards import Card

# Every character knows "general" cards: basic campus facts and places.
GENERAL = "general"
# Campus-wide happenings: most characters hear about them.
CAMPUS = "campus"
# A character with this topic hears everything (the information desk).
EVERYTHING = "all"
CAMPUS_REACH = 0.6

RULES: list[tuple[str, str]] = [
    ("biology", r"biolog|genetic|genom|plant|ecolog|microb|zoolog|botan|insect|entomolog|wildlife|forest"),
    ("science", r"scien|chemist|physics|math|statistic|laborator|\blab\b|molecul"),
    ("research", r"research|study finds|scientists?|grant|discover|professor|faculty|ph\.?d|dissertation"),
    ("engineering", r"engineer|robot|comput|software|data science|\bai\b|artificial intelligence|machine learning|electric|mechanic"),
    ("makers", r"maker|3d print|prototyp|hackathon|fabricat|design studio|tinker|hardware"),
    ("technology", r"technolog|\btech\b|cyber|software|\bapp\b|digital"),
    ("entrepreneurship", r"startup|entrepreneur|venture|pitch|innovation|business plan"),
    ("premed", r"pre-?med|pre-?health|\bmcat\b|medical school|shadowing"),
    ("health", r"health|medic|clinic|nurs|veterinar|\bvet\b|disease|patient|pre-?med"),
    ("wellness", r"wellness|mental health|yoga|fitness|counsel|meditat|recreation|intramural|workout"),
    ("athletics", r"football|basketball|soccer|volleyball|baseball|softball|wrestl|swim|\btrack\b|cross country|gymnast|tennis|golf|rifle|\bacc\b|carter-finley|lenovo center|reynolds coliseum"),
    ("arts", r"\bart\b|\barts\b|music|concert|theat|danc|gallery|gregg museum|film|poetry|exhibit|choir|band|perform"),
    ("career", r"career|internship|\bjobs?\b|resume|employer|networking|recruit|hiring"),
    ("clubs", r"\bclub|student organization|involvement|\bmeeting\b|interest meeting|greek|fraternit|sororit"),
    ("dining", r"dining|food|lunch|dinner|breakfast|coffee|pizza|ice cream|howling cow|snack|bake|cook"),
    ("academics", r"lecture|seminar|workshop|exam|\bclass|colloquium|defense|symposium|registration|advising|tutor"),
    ("residence", r"residence hall|housing|roommate|university housing|\bdorm"),
    ("service", r"volunteer|service|donat|food drive|habitat|blood drive|charit"),
    ("veterans", r"veteran|military|rotc"),
]
_COMPILED = [(t, re.compile(p, re.I)) for t, p in RULES]


def tag(text: str, extra: list[str] | None = None) -> list[str]:
    found = {t for t, rx in _COMPILED if rx.search(text)}
    found.update(extra or [])
    if not found:
        found.add(CAMPUS)
    return sorted(found)


def _hash01(*parts: str) -> float:
    h = hashlib.sha1("|".join(parts).encode()).digest()
    return int.from_bytes(h[:4], "big") / 2**32


def knows(agent_id: str, agent_topics: list[str], card: Card) -> bool:
    if EVERYTHING in agent_topics or GENERAL in card.topics:
        return True
    if set(agent_topics) & set(card.topics):
        return True
    if CAMPUS in card.topics or "athletics" in card.topics:
        return _hash01(agent_id, card.id) < CAMPUS_REACH
    return False
