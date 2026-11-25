import json
import os
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from backend.database import connect, database_path, initialize_database
from backend.gateway import (
    ProvidersUnavailable,
    complete_with_failover,
    create_gateway,
    create_response_cache,
)

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant."


class ChatRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=128)
    message: str = Field(min_length=1, max_length=4000)
    system_prompt: str | None = None

    @field_validator("message", mode="before")
    @classmethod
    def trim_message(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("session_id")
    @classmethod
    def reject_blank_session_id(cls, value):
        if not value.strip():
            raise ValueError("session_id must not be blank")
        return value


@asynccontextmanager
async def lifespan(app: FastAPI):
    path = database_path(os.getenv("DATABASE_URL", "sqlite:///./app.db"))
    initialize_database(path)
    with connect(path) as connection, connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS session_prompts (
                session_id TEXT PRIMARY KEY,
                system_prompt TEXT NOT NULL
            )
        """)

    app.state.database_path = path
    app.state.gateway, app.state.keys_configured = create_gateway()
    app.state.response_cache = create_response_cache()
    app.state.model = os.getenv("LLM_MODEL", "").strip()
    app.state.failure_simulation_enabled = (
        os.getenv("ENABLE_FAILURE_SIMULATION", "").strip().lower() == "true"
    )
    yield


app = FastAPI(
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
        if origin.strip()
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Simulate-Failure"],
)


def read_history(session_id: str) -> list[dict]:
    try:
        with connect(app.state.database_path) as connection:
            rows = connection.execute(
                """
                SELECT role, content, metadata
                FROM messages
                WHERE session_id = ?
                ORDER BY id
                """,
                (session_id,),
            ).fetchall()
    except sqlite3.Error:
        raise HTTPException(503, detail="database unavailable") from None

    messages = []
    for role, content, metadata in rows:
        message = {"role": role, "content": content}
        if metadata is not None:
            message["metadata"] = json.loads(metadata)
        messages.append(message)
    return messages


@app.get("/health")
def health():
    try:
        with connect(app.state.database_path) as connection:
            connection.execute("SELECT id FROM messages LIMIT 1").fetchone()
    except sqlite3.Error:
        raise HTTPException(503, detail="database unavailable") from None

    if app.state.gateway is None:
        raise HTTPException(503, detail="LLM gateway not configured")

    return {
        "status": "ok",
        "keys_configured": app.state.keys_configured,
        "cache_enabled": True,
    }


@app.post("/chat")
def chat(
    request: ChatRequest,
    simulate_failure: str | None = Header(default=None, alias="X-Simulate-Failure"),
):
    started = perf_counter()

    if app.state.gateway is None:
        raise HTTPException(503, detail="all providers unavailable")

    history = read_history(request.session_id)

    system_prompt = request.system_prompt
    if system_prompt is None:
        try:
            with connect(app.state.database_path) as connection:
                row = connection.execute(
                    "SELECT system_prompt FROM session_prompts WHERE session_id = ?",
                    (request.session_id,),
                ).fetchone()
        except sqlite3.Error:
            raise HTTPException(503, detail="database unavailable") from None
        system_prompt = row[0] if row is not None else DEFAULT_SYSTEM_PROMPT

    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(
        {"role": item["role"], "content": item["content"]}
        for item in history
    )
    messages.append({"role": "user", "content": request.message})

    simulated_failures = set()
    if simulate_failure and app.state.failure_simulation_enabled:
        for entry in simulate_failure.split(","):
            key, separator, status = entry.partition("=")
            if separator and status.strip() in {"429", "500", "502", "503"}:
                simulated_failures.add(key.strip())

    try:
        answer, key_id, fallback_attempts = complete_with_failover(
            app.state.gateway,
            app.state.keys_configured,
            app.state.model,
            messages,
            simulated_failures,
            app.state.response_cache,
        )
    except ProvidersUnavailable:
        raise HTTPException(503, detail="all providers unavailable") from None

    reply = answer["reply"]
    metadata = {
        "resolution_source": "LLM_CACHE" if key_id is None else "LIVE_INFERENCE",
        "model": app.state.model,
        "latency_ms": round((perf_counter() - started) * 1000),
        "input_tokens": answer["input_tokens"],
        "output_tokens": answer["output_tokens"],
        "key_id": key_id,
        "fallback_attempts": fallback_attempts,
    }

    created_at = datetime.now(timezone.utc).isoformat()
    try:
        with connect(app.state.database_path) as connection, connection:
            if request.system_prompt is not None:
                connection.execute(
                    """
                    INSERT INTO session_prompts (session_id, system_prompt)
                    VALUES (?, ?)
                    ON CONFLICT(session_id)
                    DO UPDATE SET system_prompt = excluded.system_prompt
                    """,
                    (request.session_id, request.system_prompt),
                )

            connection.executemany(
                """
                INSERT INTO messages (session_id, role, content, metadata, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                [
                    (request.session_id, "user", request.message, None, created_at),
                    (
                        request.session_id,
                        "assistant",
                        reply,
                        json.dumps(metadata),
                        created_at,
                    ),
                ],
            )
    except sqlite3.Error:
        raise HTTPException(503, detail="database unavailable") from None

    return {
        "session_id": request.session_id,
        "reply": reply,
        "metadata": metadata,
    }


@app.get("/sessions/{session_id}/messages")
def session_messages(session_id: str):
    messages = read_history(session_id)
    if not messages:
        raise HTTPException(404, detail="session not found")
    return {"session_id": session_id, "messages": messages}