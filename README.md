# Lyftr AI Chatbot

A React and FastAPI chatbot with per-session SQLite history, ordered API key failover, and response caching through LiteLLM.

## Live URLs

- Frontend: https://lyftr-ai-chatbot-web.onrender.com
- Backend: https://lyftr-ai-chatbot-production-efffbba9.up.railway.app
- Backend health: https://lyftr-ai-chatbot-production-efffbba9.up.railway.app/health

## Run locally: with Docker and without

Copy `.env.example` to `.env` and set `LLM_API_KEYS` to two valid Groq keys separated by a comma. Set `LLM_MODEL=groq/openai/gpt-oss-20b`. Keep the real keys in `.env`.

### With Docker

Run `make up` from the repository root. If Make is unavailable, run `docker compose up --build -d`.

Open http://localhost:3000. The API is at http://localhost:8000. Run `make down` or `docker compose down` to stop both services.

### Without Docker

Set `DATABASE_URL=sqlite:///./app.db` and `ALLOWED_ORIGINS=http://localhost:3000` in `.env`.

From the repository root:

```sh
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --port 8001
```

In a second terminal:

```sh
cd frontend
npm ci
npm run dev
```

Open http://localhost:3000.

### Backend tests

From the repository root:

```sh
python -m pip install -r backend/requirements.txt pytest httpx
python -m pytest backend/test_chat.py -q
```

The tests use a temporary SQLite database and a mocked provider call.

## Design decisions: key fallback, caching, SQLite session storage

- **Key fallback.** The gateway tries configured keys in order through LiteLLM. HTTP 429 and provider 5xx responses advance to the next key. `key_id` is an identifier such as `key_1`. Both deployed Groq keys share an organization quota, so an organization-wide quota limit can affect both.
- **Caching.** The cache key includes the model and the full model input, including the system prompt and conversation history. LiteLLM's in-memory cache stores the reply and original token counts. Cache hits have `key_id: null`. Failure simulation bypasses the cache. The cache starts empty when the process restarts.
- **SQLite session storage.** The backend loads history by session ID and saves both messages from a successful turn in one transaction. A supplied `system_prompt` is saved with that turn and reused for the session. Docker mounts a named volume at `/data` for the database.

## Verification: how to see failover, cache hits and per-message token usage

- **Cache and token usage.** Send a new prompt in the frontend, click **New chat**, and send the exact same prompt again. Compare `LIVE_INFERENCE` with `LLM_CACHE`, the reply text, latency, and input/output token counts.
- **Memory.** Tell the bot your name and ask it to recall it in the same chat. Use **New chat** to start an independent session.
- **Failover.** With `ENABLE_FAILURE_SIMULATION=true`, send `POST /chat` with `X-Simulate-Failure: key_1=429`. The response should show `key_id: key_2` and `fallback_attempts: 1`. Use `X-Simulate-Failure: *=429` to verify a `503`.
- **History.** Call `GET /sessions/{session_id}/messages` using the session ID returned by `/chat`. Successful turns appear in chronological order.
- **Readiness.** Call `GET /health` to verify database access, the configured key count, and cache availability.

## Setup Used: your editor and AI tools

VS Code, PowerShell, Git, Docker Desktop, and ChatGPT for implementation guidance and debugging. The frontend is hosted on Render and the backend on Railway.

## Bonus features (if any): what you added beyond the requirements and why

The **New chat** button starts an independent session without a page refresh, making it easy to verify session isolation and cache behavior.