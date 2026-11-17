"""Model output is untrusted. Parse and check it before anything goes back to the game.
Mirrors src/agents/schema.ts, which the client runs again as a second guard."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from .models import Allowed


class Invalid(ValueError):
    pass


def extract_json(raw: str) -> dict[str, Any]:
    text = re.sub(r"<think>[\s\S]*?</think>", "", raw).strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise Invalid("no JSON object found")
    try:
        obj = json.loads(text[start : end + 1])
    except json.JSONDecodeError as e:
        raise Invalid(f"bad JSON: {e}") from e
    if not isinstance(obj, dict):
        raise Invalid("not an object")
    return obj


def _str(v: Any, limit: int) -> str:
    return v.strip()[:limit] if isinstance(v, str) else ""


def _int(v: Any, lo: int, hi: int, default: int) -> int:
    try:
        return max(lo, min(hi, round(float(v))))
    except (TypeError, ValueError):
        return default


@dataclass
class Turn:
    say: str
    action: str = "none"
    action_arg: str = ""
    relationship_delta: int = 0
    replies: list[str] = field(default_factory=list)
    memory: str = ""


def validate_turn(raw: str, allowed: Allowed) -> tuple[Turn, list[str]]:
    obj = extract_json(raw)
    warnings: list[str] = []
    say = _str(obj.get("say"), 600)
    if not say:
        raise Invalid('missing "say"')
    action = _str(obj.get("action"), 40) or "none"
    arg = _str(obj.get("action_arg"), 60)
    if action not in allowed.actions:
        warnings.append(f'action "{action}" not allowed; using none')
        action, arg = "none", ""
    elif action in allowed.argsFor:
        options = allowed.argsFor[action]
        if arg not in options:
            if len(options) == 1:
                arg = options[0]
            else:
                warnings.append(f'arg "{arg}" not valid for {action}; using none')
                action, arg = "none", ""
    else:
        arg = ""
    replies_raw = obj.get("replies")
    replies = [r for r in (_str(x, 90) for x in replies_raw) if r][:3] if isinstance(replies_raw, list) else []
    return Turn(
        say=say,
        action=action,
        action_arg=arg,
        relationship_delta=_int(obj.get("relationship_delta"), -3, 3, 0),
        replies=replies,
        memory=_str(obj.get("memory"), 200),
    ), warnings


def validate_reflection(raw: str) -> dict[str, Any]:
    o = extract_json(raw)
    summary = _str(o.get("summary"), 300)
    if not summary:
        raise Invalid("missing summary")
    return {
        "summary": summary,
        "importance": _int(o.get("importance"), 1, 10, 5),
        "note": _str(o.get("relationship_note"), 160),
        "goal": _str(o.get("tomorrow_goal"), 200),
        "text": _str(o.get("text_player"), 280),
    }


def validate_recap(raw: str) -> dict[str, str]:
    o = extract_json(raw)
    recap = _str(o.get("recap"), 700)
    if not recap:
        raise Invalid("missing recap")
    return {"recap": recap, "hook": _str(o.get("hook"), 300)}


def validate_epilogue(raw: str, ids: list[str]) -> dict[str, Any]:
    o = extract_json(raw)
    closing = _str(o.get("closing"), 1200)
    if not closing:
        raise Invalid("missing closing")
    src = o.get("characters") if isinstance(o.get("characters"), dict) else {}
    chars = {i: line for i in ids if (line := _str(src.get(i), 300))}
    return {"closing": closing, "characters": chars}
