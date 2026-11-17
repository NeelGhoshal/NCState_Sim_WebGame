"""Request bodies sent by the TypeScript client. The client owns game state; these are
snapshots of what one call needs. Field names match src/agents/runtime.ts."""
from __future__ import annotations

from pydantic import BaseModel, Field


class Memory(BaseModel):
    day: int
    minute: int
    text: str
    importance: int = 5


class Person(BaseModel):
    name: str = Field(max_length=40)
    pronouns: str = Field(max_length=20)


class AgentCard(BaseModel):
    id: str
    name: str
    pronouns: str
    role: str
    persona: str
    speech: str
    values: str
    semesterGoal: str
    goal: str
    rel: int
    note: str
    activity: str
    minutesLeft: int
    memories: list[Memory] = []
    # What this character follows. Decides which campus happenings they have heard about
    # (ai/app/rag/topics.py). From AgentDef.topics in src/data/agents.ts.
    topics: list[str] = []


class Allowed(BaseModel):
    actions: list[str]
    argsFor: dict[str, list[str]] = {}


class InviteOption(BaseModel):
    id: str
    label: str
    day: int
    start: int


class FactOption(BaseModel):
    id: str
    text: str


class GiftOption(BaseModel):
    id: str
    label: str


class Line(BaseModel):
    who: str  # "player" | "agent"
    text: str = Field(max_length=700)


class TurnRequest(BaseModel):
    university: str
    day: int
    minute: int
    player: Person
    agent: AgentCard
    allowed: Allowed
    invites: list[InviteOption] = []
    facts: list[FactOption] = []
    gift: GiftOption | None = None
    history: list[Line] = []
    playerText: str = Field(max_length=300)


class ReflectRequest(BaseModel):
    day: int
    agentId: str = ""
    topics: list[str] = []
    player: Person
    agentName: str
    persona: str
    semesterGoal: str
    rel: int
    memoriesToday: list[Memory]
    tomorrowPlans: list[str] = []


class RecapRequest(BaseModel):
    day: int
    player: Person
    yesterday: list[str]
    relationships: list[str]
    today: list[str]


class EpilogueCharacter(BaseModel):
    id: str
    name: str
    rel: int
    note: str


class EpilogueRequest(BaseModel):
    player: Person
    quizScore: int | None
    log: list[str]
    characters: list[EpilogueCharacter]
