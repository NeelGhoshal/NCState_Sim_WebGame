"""A small BM25 index over cards. Lexical, dependency-free and fast enough to run on every
dialogue turn. Embeddings could replace `search` later without changing callers."""
from __future__ import annotations

import math
import re
from collections import Counter

from .cards import Card

STOP = set("""a an and are as at be but by for from has have he her his i if in into is it its me my of on or our
she so that the their them they this to was we were what when where which who will with you your yours about
do does did just like really very can could would should there here how why hey hi hello yeah ok okay
campus nc state ncsu university around going happening anything something stuff thing fun today tonight
know any whats new good""".split())

WORD = re.compile(r"[a-z0-9]+(?:'[a-z]+)?")


def stem(w: str) -> str:
    for suf in ("ing", "ers", "ies", "ed", "es", "er", "s"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            return w[: -len(suf)] + ("y" if suf == "ies" else "")
    return w


def tokens(text: str) -> list[str]:
    return [stem(w.replace("'", "")) for w in WORD.findall(text.lower()) if w not in STOP and len(w) > 1]


class Bm25:
    def __init__(self, cards: list[Card], k1: float = 1.4, b: float = 0.75):
        self.cards = cards
        self.k1, self.b = k1, b
        self.docs = [Counter(tokens(f"{c.title} {c.title} {c.text} {' '.join(c.places)} {' '.join(c.topics)}")) for c in cards]
        self.lens = [sum(d.values()) for d in self.docs]
        self.avg = (sum(self.lens) / len(self.lens)) if self.lens else 1.0
        df: Counter[str] = Counter()
        for d in self.docs:
            df.update(d.keys())
        n = len(cards)
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}

    def scores(self, query: str) -> list[float]:
        q = tokens(query)
        out = [0.0] * len(self.cards)
        if not q:
            return out
        for i, d in enumerate(self.docs):
            s = 0.0
            norm = self.k1 * (1 - self.b + self.b * self.lens[i] / self.avg)
            for t in q:
                f = d.get(t)
                if f:
                    s += self.idf[t] * f * (self.k1 + 1) / (f + norm)
            out[i] = s
        return out
