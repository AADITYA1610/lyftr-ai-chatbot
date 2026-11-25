from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend import main


@pytest.fixture
def chat_app(monkeypatch, tmp_path):
    database = (tmp_path / "test.db").as_posix()
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database}")
    monkeypatch.setenv("ENABLE_FAILURE_SIMULATION", "true")
    monkeypatch.setenv("LLM_MODEL", "test-model")

    calls = []

    def fake_completion(*, model, messages, **kwargs):
        calls.append(model)
        reply = messages[0]["content"]
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=reply))],
            usage=SimpleNamespace(prompt_tokens=12, completion_tokens=4),
        )

    router = SimpleNamespace(completion=fake_completion)
    monkeypatch.setattr(main, "create_gateway", lambda: (router, 2))

    with TestClient(main.app) as client:
        yield client, calls


def test_blank_message_returns_422(chat_app):
    client, calls = chat_app
    response = client.post("/chat", json={"session_id": "blank", "message": "   "})

    assert response.status_code == 422
    assert calls == []


def test_same_first_message_uses_cache_in_new_session(chat_app):
    client, calls = chat_app
    first = client.post("/chat", json={"session_id": "first", "message": "Hello"})
    second = client.post("/chat", json={"session_id": "second", "message": "Hello"})

    assert first.status_code == second.status_code == 200
    live, cached = first.json(), second.json()
    assert live["metadata"]["resolution_source"] == "LIVE_INFERENCE"
    assert cached["metadata"]["resolution_source"] == "LLM_CACHE"
    assert cached["metadata"]["key_id"] is None
    assert live["reply"] == cached["reply"]
    for field in ("input_tokens", "output_tokens"):
        assert live["metadata"][field] == cached["metadata"][field]
    assert calls == ["key_1"]


def test_simulated_failure_uses_second_key(chat_app):
    client, calls = chat_app
    response = client.post(
        "/chat",
        json={"session_id": "fallback", "message": "Hello"},
        headers={"X-Simulate-Failure": "key_1=429"},
    )

    assert response.status_code == 200
    assert response.json()["metadata"]["key_id"] == "key_2"
    assert response.json()["metadata"]["fallback_attempts"] == 1
    assert calls == ["key_2"]


def test_all_keys_fail_without_saving_turn(chat_app):
    client, calls = chat_app
    response = client.post(
        "/chat",
        json={"session_id": "failed", "message": "Hello"},
        headers={"X-Simulate-Failure": "*=429"},
    )

    assert response.status_code == 503
    assert response.json() == {"detail": "all providers unavailable"}
    assert client.get("/sessions/failed/messages").status_code == 404
    assert calls == []


def test_system_prompt_persists_in_one_session(chat_app):
    client, _ = chat_app

    first = client.post(
        "/chat",
        json={
            "session_id": "custom",
            "message": "Hello",
            "system_prompt": "Reply in French.",
        },
    )
    follow_up = client.post(
        "/chat", json={"session_id": "custom", "message": "Continue"}
    )
    other = client.post(
        "/chat", json={"session_id": "other", "message": "Hello"}
    )

    assert first.status_code == follow_up.status_code == other.status_code == 200
    assert first.json()["reply"] == follow_up.json()["reply"] == "Reply in French."
    assert other.json()["reply"] == main.DEFAULT_SYSTEM_PROMPT

    history = client.get("/sessions/custom/messages")
    assert history.status_code == 200
    assert [message["role"] for message in history.json()["messages"]] == [
        "user", "assistant", "user", "assistant",
    ]