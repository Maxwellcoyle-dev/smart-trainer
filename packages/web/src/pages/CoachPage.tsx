import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function CoachPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setLoading(true);
    try {
      // TODO: wire to /coach/chat endpoint once backend is connected
      await new Promise((r) => setTimeout(r, 800));
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: "Backend not connected yet. Once you set up Supabase + Railway, coach chat will be live here with full training context.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <h1 className="text-xl font-bold">Coach</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-muted text-sm pt-8">
            <p className="text-4xl mb-3">🤖</p>
            <p>Your AI coach is ready.</p>
            <p>Ask about your training, request a week fill, or get a morning brief.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
              msg.role === "user"
                ? "bg-accent text-white ml-auto rounded-br-sm"
                : "bg-surface text-text rounded-bl-sm"
            }`}
          >
            {msg.content}
          </div>
        ))}
        {loading && (
          <div className="bg-surface rounded-2xl rounded-bl-sm px-4 py-3 max-w-[85%]">
            <span className="text-muted text-sm animate-pulse">Thinking…</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick prompts */}
      {messages.length === 0 && (
        <div className="px-4 pb-2 flex gap-2 overflow-x-auto">
          {["Fill my week", "Morning brief", "Review last week"].map((prompt) => (
            <button
              key={prompt}
              onClick={() => { setInput(prompt); }}
              className="whitespace-nowrap px-3 py-1.5 rounded-full bg-surface text-sm text-muted border border-border flex-shrink-0"
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2 p-3 border-t border-border bg-surface">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Message your coach…"
          className="flex-1 bg-surface2 rounded-xl px-4 py-3 text-sm outline-none placeholder:text-muted"
        />
        <button
          onClick={send}
          disabled={!input.trim() || loading}
          className="px-4 py-3 rounded-xl bg-accent text-white text-sm font-semibold disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
