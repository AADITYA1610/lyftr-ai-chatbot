import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";

const apiBase = (
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8001"
).replace(/\/+$/, "");

const sessionId = crypto.randomUUID();

function ReplyMetadata({ metadata }) {
  return (
    <dl className="metadata">
      <div>
        <dt>Source</dt>
        <dd data-testid="meta-source">{metadata.resolution_source}</dd>
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
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const inputRef = useRef(null);

  function appendMessage(message) {
    setMessages((previous) => [...previous, { ...message, id: crypto.randomUUID() }]);
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
        appendMessage({
          role: "error",
          text: "Enter a message between 1 and 4,000 characters.",
        });
      } else if (response.status === 503) {
        appendMessage({
          role: "error",
          text: "The chat service is temporarily unavailable. Please try again.",
        });
      } else if (!response.ok || !data?.reply || !data?.metadata) {
        appendMessage({ role: "error", text: "The server couldn’t return a reply." });
      } else {
        appendMessage({
          role: "assistant",
          text: data.reply,
          metadata: data.metadata,
        });
      }
    } catch {
      appendMessage({
        role: "error",
        text: "Couldn’t reach the chat server. Check that it’s running and try again.",
      });
    } finally {
      submitting.current = false;
      setPending(false);
      inputRef.current?.focus();
    }
  }

  return (
    <main className="shell">
      <h1>Lyftr Chatbot</h1>

      <section className="conversation" role="log" aria-label="Conversation">
        {messages.length === 0 && (
          <p className="empty">Ask a question to start the conversation.</p>
        )}
        {messages.map(({ id, role, text, metadata }) => (
          <article
            key={id}
            className={`message ${role}`}
            data-testid={role === "assistant" ? "assistant-message" : undefined}
          >
            <strong>{role === "user" ? "You" : role === "assistant" ? "Assistant" : "Error"}</strong>
            <p>{text}</p>
            {role === "assistant" && <ReplyMetadata metadata={metadata} />}
          </article>
        ))}
        {pending && <p className="empty">Waiting for a reply…</p>}
      </section>

      <form onSubmit={sendMessage}>
        <input
          ref={inputRef}
          data-testid="chat-input"
          aria-label="Message"
          placeholder="Type a message"
          maxLength={4000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button data-testid="send-button" type="submit" disabled={pending || !draft.trim()}>
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
    margin: 0; background: #f2f4ef; color: #182822;
    font: 16px/1.5 system-ui, sans-serif;
  }
  .shell { max-width: 820px; margin: 0 auto; padding: 32px 16px; }
  h1 { margin: 0 0 18px; font-size: 30px; letter-spacing: -.04em; }
  .conversation {
    min-height: 240px; display: grid; align-content: start; gap: 12px;
    padding: 16px; background: #fff; border: 1px solid #dce4de;
    border-radius: 16px;
  }
  .empty { color: #485d51; margin: 6px; }
  .message { padding: 12px 14px; border-radius: 12px; background: #eef3ef; }
  .message.user { background: #daede2; }
  .message.error { background: #fbe9e6; color: #741f16; }
  .message p { margin: 4px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .metadata {
    display: flex; flex-wrap: wrap; gap: 8px 18px;
    margin: 12px 0 0; font-size: 13px;
  }
  .metadata dt { color: #485d51; }
  .metadata dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
  form { display: flex; gap: 8px; margin-top: 12px; }
  input, button { border-radius: 10px; padding: 12px; font: inherit; }
  input { flex: 1; min-width: 0; border: 1px solid #aab9af; }
  button { border: 0; background: #174b36; color: #fff; font-weight: 600; }
  button:disabled { opacity: .55; }
`;
document.head.appendChild(styles);

createRoot(document.getElementById("root")).render(<App />);