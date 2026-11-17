import json

import pytest
from fastapi.testclient import TestClient

from app.config import pick_provider
from app.gateway import ChatResult
from app.main import create_app
from app.models import Allowed
from app.validate import Invalid, extract_json, validate_reflection, validate_turn

ALLOWED = Allowed(actions=["none", "end_conversation", "invite", "share_info"], argsFor={"invite": ["jordan_meeting"], "share_info": ["a", "b"]})


# ------------------------------------------------------------------ validation

def test_accepts_well_formed_turn():
    t, w = validate_turn('{"say":"Hey!","action":"invite","action_arg":"jordan_meeting","relationship_delta":2,"replies":["a","b","c"],"memory":"met"}', ALLOWED)
    assert t.action == "invite" and t.action_arg == "jordan_meeting" and not w


def test_strips_fences_and_think_blocks():
    assert extract_json('<think>hmm</think>```json\n{"say":"x"}\n```') == {"say": "x"}


def test_downgrades_disallowed_action():
    t, w = validate_turn('{"say":"Take my money","action":"give_money","relationship_delta":1}', ALLOWED)
    assert t.action == "none" and len(w) == 1


def test_args_downgraded_or_filled():
    t, _ = validate_turn('{"say":"x","action":"share_info","action_arg":"zzz"}', ALLOWED)
    assert t.action == "none"
    t, _ = validate_turn('{"say":"x","action":"invite","action_arg":"party"}', ALLOWED)
    assert t.action_arg == "jordan_meeting"


def test_clamps_relationship_delta():
    t, _ = validate_turn('{"say":"x","relationship_delta":40}', ALLOWED)
    assert t.relationship_delta == 3


def test_rejects_missing_say_and_prose():
    with pytest.raises(Invalid):
        validate_turn('{"action":"none"}', ALLOWED)
    with pytest.raises(Invalid):
        validate_turn("sure! here you go", ALLOWED)


def test_reflection_importance_clamped():
    assert validate_reflection('{"summary":"Good day.","importance":"12"}')["importance"] == 10


# ------------------------------------------------------------------ provider selection

def test_provider_selection_order():
    assert pick_provider({}) is None
    assert pick_provider({"GROQ_API_KEY": "k"}).name == "groq"
    assert pick_provider({"OPENROUTER_API_KEY": "k"}).name == "openrouter"
    assert pick_provider({"LLM_PROVIDER": "ollama"}).name == "ollama"
    assert pick_provider({"LLM_PROVIDER": "groq"}) is None  # no key
    assert pick_provider({"GROQ_API_KEY": "k", "LLM_MODEL_SMALL": "m"}).models["small"] == "m"


# ------------------------------------------------------------------ endpoints

TURN_REQ = {
    "university": "Test U", "day": 1, "minute": 730,
    "player": {"name": "Alex", "pronouns": "they/them"},
    "agent": {"id": "maya", "name": "Maya Okafor", "pronouns": "she/her", "role": "roommate", "persona": "p", "speech": "s",
              "values": "v", "semesterGoal": "g", "goal": "g", "rel": 50, "note": "n", "activity": "eating", "minutesLeft": 60, "memories": []},
    "allowed": {"actions": ["none", "end_conversation"], "argsFor": {}},
    "history": [], "playerText": "hi",
}
INFO = {"configured": True, "provider": "fake", "models": {"small": "s", "large": "l"}}


def client_with(reply: str | None):
    async def chat(messages, tier, max_tokens=500, temperature=0.8):
        return None if reply is None else ChatResult(reply, "fake", 100, 20)
    return TestClient(create_app(chat=chat, provider_info=INFO))


def test_status():
    assert client_with("{}").get("/api/llm/status").json()["provider"] == "fake"


def test_turn_ok_and_usage():
    r = client_with(json.dumps({"say": "Hey!", "action": "invite", "relationship_delta": 9})).post("/api/agent/turn", json=TURN_REQ).json()
    assert r["ok"] and r["turn"]["action"] == "none" and r["turn"]["relationship_delta"] == 3
    assert r["usage"] == {"tier": "small", "calls": 1, "promptTokens": 100, "completionTokens": 20}


def test_turn_invalid_output_reports_failure():
    r = client_with("I am not JSON").post("/api/agent/turn", json=TURN_REQ).json()
    assert r["ok"] is False and r["usage"]["calls"] == 1


def test_turn_model_down():
    r = client_with(None).post("/api/agent/turn", json=TURN_REQ).json()
    assert r["ok"] is False and r["usage"]["calls"] == 0


def test_turn_filters_player_input():
    r = client_with('{"say":"x"}').post("/api/agent/turn", json={**TURN_REQ, "playerText": "kys"}).json()
    assert r["ok"] and r.get("filtered")


def test_unconfigured_service_never_calls_model():
    async def chat(*a, **k):
        raise AssertionError("should not be called")
    c = TestClient(create_app(chat=chat, provider_info={"configured": False, "provider": None, "models": None}))
    assert c.post("/api/agent/turn", json=TURN_REQ).json()["ok"] is False


def test_recap_and_epilogue():
    c = client_with('{"recap":"Previously, things.","hook":"Today."}')
    r = c.post("/api/director/recap", json={"day": 2, "player": TURN_REQ["player"], "yesterday": [], "relationships": [], "today": []}).json()
    assert r["ok"] and r["recap"].startswith("Previously")
    c = client_with('{"closing":"The end.","characters":{"maya":"Friends.","ghost":"x"}}')
    r = c.post("/api/director/epilogue", json={"player": TURN_REQ["player"], "quizScore": 80, "log": [],
                                              "characters": [{"id": "maya", "name": "Maya", "rel": 60, "note": "n"}]}).json()
    assert r["ok"] and r["characters"] == {"maya": "Friends."}
