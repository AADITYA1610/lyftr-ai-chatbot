import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

const apiBase = (
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8001"
).replace(/\/+$/, "");

function ReplyMetadata({ metadata }) {
  return (
    <dl className="metadata">
      <div>
        <dt>Source</dt>
        <dd
          className={`source ${metadata.resolution_source === "LLM_CACHE" ? "cached" : ""}`}
          data-testid="meta-source"
        >
          {metadata.resolution_source}
        </dd>
      </div>
      <div>
        <dt>Model</dt>
        <dd data-testid="meta-model">{metadata.model}</dd>
      </div>
      <div>
        <dt>Latency</dt>
        <dd data-testid="meta-latency">{metadata.latency_ms} ms</dd>
      </div>
      <div>
        <dt>Input tokens</dt>
        <dd data-testid="meta-input-tokens">{metadata.input_tokens}</dd>
      </div>
      <div>
        <dt>Output tokens</dt>
        <dd data-testid="meta-output-tokens">{metadata.output_tokens}</dd>
      </div>
    </dl>
  );
}

function App() {
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const inputRef = useRef(null);
  const conversationRef = useRef(null);

  useEffect(() => {
    const conversation = conversationRef.current;
    conversation.scrollTop = conversation.scrollHeight;
  }, [messages, pending]);

  function appendMessage(message) {
    const item = { ...message, id: crypto.randomUUID() };
    setMessages((previous) => [...previous, item]);
  }

  function startNewChat() {
    if (submitting.current) return;
    setSessionId(crypto.randomUUID());
    setMessages([]);
    setDraft("");
    inputRef.current?.focus();
  }

  async function sendMessage(event) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || submitting.current) return;

    submitting.current = true;
    setPending(true);
    setDraft("");
    appendMessage({ role: "user", text: message });

    try {
      const response = await fetch(`${apiBase}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, message }),
      });
      const data = await response.json().catch(() => null);

      if (response.status === 422) {
        appendMessage({ role: "error", text: "Enter a message between 1 and 4,000 characters." });
      } else if (response.status === 503) {
        appendMessage({ role: "error", text: "The chat service is temporarily unavailable. Try again." });
      } else if (!response.ok || !data?.reply || !data?.metadata) {
        appendMessage({ role: "error", text: "The server couldn’t return a reply." });
      } else {
        appendMessage({ role: "assistant", text: data.reply, metadata: data.metadata });
      }
    } catch {
      appendMessage({ role: "error", text: "Couldn’t reach the chat server. Try again." });
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <main className="shell">
      <header className="header">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">L</span>
          <h1>Lyftr Chatbot</h1>
        </div>
        <button className="new-chat" type="button" onClick={startNewChat} disabled={pending}>
          + New chat
        </button>
      </header>

      <section
        ref={conversationRef}
        className="conversation"
        role="log"
        aria-label="Conversation"
      >
        {messages.length === 0 && (
          <div className="empty">
            <h2>What’s on your mind?</h2>
            <p>Ask a question or start a conversation.</p>
          </div>
        )}

        {messages.map(({ id, role, text, metadata }) => (
          <article
            key={id}
            className={`message ${role}`}
            data-testid={role === "assistant" ? "assistant-message" : undefined}
          >
            <strong className="speaker">
              {role === "user" ? "You" : role === "assistant" ? "Assistant" : "Error"}
            </strong>
            <p>{text}</p>
            {role === "assistant" && <ReplyMetadata metadata={metadata} />}
          </article>
        ))}

        {pending && <p className="pending">Waiting for a reply…</p>}
      </section>

      <form className="composer" onSubmit={sendMessage}>
        <input
          ref={inputRef}
          data-testid="chat-input"
          aria-label="Message"
          placeholder="Type a message"
          maxLength={4000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button className="send" data-testid="send-button" type="submit" disabled={pending || !draft.trim()}>
          Send
        </button>
      </form>
    </main>
  );
}

const styles = document.createElement("style");
styles.textContent = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    color: #182822;
    background: radial-gradient(ellipse at top, #dbeee4 0%, #f2f5f1 62%);
    font: 16px/1.55 system-ui, sans-serif;
  }
  .shell {
    width: min(920px, calc(100% - 32px));
    height: min(820px, calc(100dvh - 48px));
    min-height: 320px;
    margin: 24px auto;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: #fff;
    border: 1px solid #d5e2d9;
    border-radius: 24px;
    box-shadow: 0 16px 48px #19443112;
  }
  .header, .composer {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 22px;
  }
  .header { justify-content: space-between; border-bottom: 1px solid #e3ebe5; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand-icon {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 12px;
    background: #174b36;
    color: #fff;
    font-weight: 800;
  }
  h1 { margin: 0; font-size: 22px; letter-spacing: -.04em; }
  button, input { font: inherit; border-radius: 12px; }
  button { padding: 9px 14px; font-weight: 650; cursor: pointer; }
  button:disabled { opacity: .55; cursor: default; }
  .new-chat { background: #edf5ef; color: #174b36; border: 1px solid #d4e6da; }
  .conversation {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 22px;
    background: #fafcf9;
  }
  .empty { margin: auto; text-align: center; padding: 20px; }
  .empty h2 { margin: 0; font-size: clamp(24px, 5vw, 36px); letter-spacing: -.045em; }
  .empty p, .pending { color: #52685c; }
  .message {
    align-self: flex-start;
    max-width: 92%;
    padding: 12px 16px;
    border-radius: 4px 16px 16px 16px;
    background: #fff;
    border: 1px solid #e0e9e2;
  }
  .message.user {
    align-self: flex-end;
    border-radius: 16px 4px 16px 16px;
    background: #174b36;
    color: #fff;
    border-color: #174b36;
  }
  .message.error { background: #fff1ee; color: #812c20; border-color: #f0d5ce; }
  .speaker { font-size: 13px; }
  .message p { margin: 4px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .metadata {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    padding-top: 10px;
    margin: 10px 0 0;
    border-top: 1px solid #e3ebe5;
    font-size: 12px;
  }
  .metadata dt { color: #52685c; }
  .metadata dd { margin: 2px 0 0; font-weight: 700; overflow-wrap: anywhere; }
  .source { padding: 1px 6px; border-radius: 6px; background: #eaf0f9; color: #254f83; }
  .source.cached { background: #deefe4; color: #205b3d; }
  .pending { margin: 0; font-size: 14px; }
  .composer { border-top: 1px solid #e3ebe5; }
  input { flex: 1; min-width: 0; padding: 10px 12px; border: 1px solid #adbfaf; }
  .send { color: #fff; background: #174b36; border: 1px solid #174b36; }
  :focus-visible { outline: 2px solid #28754f; outline-offset: 3px; }
  @media (max-width: 600px) {
    .shell { width: 100%; height: 100dvh; margin: 0; border: 0; border-radius: 0; }
    .header, .conversation, .composer { padding: 12px; }
    .message { max-width: 100%; }
  }
`;
document.head.appendChild(styles);

createRoot(document.getElementById("root")).render(<App />);