"""Placeholder content filter for player input and model output. Phase 1 replaces it
once the age rating is decided. Keep in sync with src/agents/filter.ts (scripted mode)."""
import re

_BLOCKED = [
    re.compile(p, re.I)
    for p in [
        r"\bn[i1]gg", r"\bf[a@]gg?[o0]t", r"\bretard", r"\bkill (yo)?ur ?self\b", r"\bkys\b",
        r"\brape\b", r"\bporn", r"\bnude", r"\bsex(ual|ually)?\b", r"\bcocaine\b", r"\bmeth\b",
    ]
]


def blocked(text: str) -> bool:
    return any(p.search(text) for p in _BLOCKED)
