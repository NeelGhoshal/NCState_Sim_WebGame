"""Prompt builders. Each takes a request snapshot and returns chat messages."""
from __future__ import annotations

from .models import EpilogueRequest, RecapRequest, ReflectRequest, TurnRequest


def fmt_time(minute: int) -> str:
    m = minute % 1440
    h, mm = divmod(m, 60)
    return f"{h % 12 or 12}:{mm:02d} {'PM' if h >= 12 else 'AM'}"


def campus_block(university: str, happenings: list[str], background: list[str]) -> list[str]:
    """Retrieved cards, framed so the model treats them as hearsay it may use, not a script."""
    out = []
    if happenings:
        out.append(f"Things you have heard are happening around {university} (real campus happenings). "
                   "Bring one up only if it fits the moment or the player asks what is going on. Keep to the details "
                   "written here, and refer to people by their role (a professor, the coach), never by name:\n"
                   + "\n".join(happenings))
    if background:
        out.append("Campus knowledge you can draw on if it is relevant:\n" + "\n".join(background))
    return out


def turn_messages(req: TurnRequest, happenings: list[str] | None = None, background: list[str] | None = None) -> list[dict]:
    a, p = req.agent, req.player
    first = a.name.split(" ")[0]
    memories = "\n".join(f"- (day {m.day}, {fmt_time(m.minute)}) {m.text}" for m in a.memories[-8:]) \
        or "- Nothing yet. You have not met the player before."
    invites = "\n".join(f'  - "{i.id}": {i.label}, day {i.day} at {fmt_time(i.start)}' for i in req.invites)
    facts = "\n".join(f'  - "{f.id}": {f.text}' for f in req.facts)
    parts = [
        f"You are {a.name} ({a.pronouns}), {a.role}, a character in a college life game set at {req.university}. "
        "Stay in character. Never mention being an AI or a game.",
        f"Persona: {a.persona}",
        f"Speech style: {a.speech}",
        f"Values: {a.values}",
        f"Semester goal: {a.semesterGoal}",
        f"Today's goal: {a.goal}",
        f"Right now: day {req.day}, {fmt_time(req.minute)}. You are {a.activity}. You must leave in {a.minutesLeft} minutes.",
        f"You are talking with {p.name} ({p.pronouns}). Relationship: {a.rel}/100. Your note on them: {a.note}",
        f"What you remember. You know nothing about the player beyond this:\n{memories}",
        *campus_block(req.university, happenings or [], background or []),
        f"Actions you may take this turn: {', '.join(req.allowed.actions)}.",
        f"Invitations you may extend (only if it fits naturally):\n{invites}" if invites else "",
        (f"Things you know and may share (action share_info):\n{facts}\n"
         "Some you only heard from someone else. One marked as said in private is gossip: share it only if "
         "that fits who you are and how much you trust the player.") if facts else "",
        f'You may give the player {req.gift.label} (action give, arg "{req.gift.id}").' if req.gift else "",
        "You cannot give money, grades, or anything not listed. Do not invent events that already happened.",
        'Reply ONLY with a JSON object: {"say": string, "action": string, "action_arg": string, '
        '"relationship_delta": integer -3..3, "replies": [3 strings], "memory": string}.',
        '"say" is under 60 words, spoken aloud. "replies" are three short, varied things the player might say next, '
        'in first person. "memory" is one short sentence worth remembering about this exchange, or "".',
    ]
    transcript = "\n".join(f"{p.name if l.who == 'player' else first}: {l.text}" for l in req.history[-12:])
    user = (f"Conversation so far:\n{transcript}\n\n" if transcript else "") + \
        f'{p.name} says: "{req.playerText}"\n\nRespond as {first} with the JSON object only.'
    return [{"role": "system", "content": "\n\n".join(x for x in parts if x)}, {"role": "user", "content": user}]


def reflect_messages(req: ReflectRequest, upcoming: list[str] | None = None) -> list[dict]:
    lines = "\n".join(f"- [{m.importance}] {m.text}" for m in req.memoriesToday)
    parts = [
        f"Character: {req.agentName}. {req.persona}",
        f"Semester goal: {req.semesterGoal}",
        f"Relationship with the player ({req.player.name}): {req.rel}/100.",
        f"Today's memories (day {req.day}):\n{lines}",
        f"Plans tomorrow: {'; '.join(req.tomorrowPlans)}" if req.tomorrowPlans else "",
        ("Coming up on campus that this character has heard about (it may shape tomorrow's goal or the text; "
         "refer to people by role, not name):\n" + "\n".join(upcoming)) if upcoming else "",
        'Return {"summary": "1-2 sentences, first person, what today meant", "importance": 1-10, '
        '"relationship_note": "short note about the player", "tomorrow_goal": "one sentence", '
        '"text_player": "a short casual text to send the player tomorrow morning, or empty string"}.',
    ]
    return [
        {"role": "system", "content": "You manage the overnight memory of a character in a college life game. Reply only with JSON."},
        {"role": "user", "content": "\n\n".join(x for x in parts if x)},
    ]


def recap_messages(req: RecapRequest) -> list[dict]:
    yesterday = "\n".join(f"- {x}" for x in req.yesterday) or "- Nothing notable."
    today = "\n".join(f"- {x}" for x in req.today) or "- Nothing scheduled."
    return [
        {"role": "system", "content": "You are the director of an episodic college life game. You write short TV-style recaps. "
            "Use only the facts given. Never mention numbers, scores, clock times or hours of sleep; describe feelings and events instead. "
            "Reply only with JSON."},
        {"role": "user", "content": f"Player: {req.player.name} ({req.player.pronouns}).\nYesterday (day {req.day - 1}):\n{yesterday}\n\n"
            f"Relationships: {', '.join(req.relationships)}\n\nScheduled today (day {req.day}):\n{today}\n\n"
            'Return {"recap": "2-3 sentences in second person, starting with Previously", '
            '"hook": "one sentence teaser for today, based only on the schedule"}.'},
    ]


def epilogue_messages(req: EpilogueRequest) -> list[dict]:
    log = "\n".join(f"- {x}" for x in req.log[-40:])
    chars = "; ".join(f"{c.id} = {c.name}, relationship {c.rel}/100, note: {c.note}" for c in req.characters)
    shape = ", ".join(f'"{c.id}": "one sentence on where they stand with the player"' for c in req.characters)
    quiz = req.quizScore if req.quizScore is not None else "did not take it"
    return [
        {"role": "system", "content": "You are the director of an episodic college life game. Write the closing of an episode. "
            "Use only the facts given. Reply only with JSON."},
        {"role": "user", "content": f"Player: {req.player.name} ({req.player.pronouns}). Quiz score: {quiz}.\nLog:\n{log}\n\n"
            f"Characters: {chars}\n\n" + 'Return {"closing": "3-4 sentences in second person", "characters": {' + shape + "}}."},
    ]
