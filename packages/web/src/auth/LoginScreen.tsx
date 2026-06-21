import { useState } from "react";
import { useAuth } from "./AuthProvider.tsx";

export function LoginScreen() {
  const { signInWithEmail } = useAuth();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("sending");
    setError(null);
    const { error } = await signInWithEmail(email.trim());
    if (error) {
      setError(error);
      setStatus("error");
    } else {
      setStatus("sent");
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
      <p className="text-5xl mb-3">🏔️</p>
      <h1 className="text-2xl font-bold mb-1">Smart Trainer</h1>
      <p className="text-muted text-sm mb-8">Running &amp; climbing, coached by Claude.</p>

      {status === "sent" ? (
        <div className="bg-surface rounded-2xl p-5 max-w-sm w-full space-y-2">
          <p className="text-3xl">📬</p>
          <p className="font-semibold">Check your email</p>
          <p className="text-muted text-sm">
            We sent a magic sign-in link to <span className="text-text">{email}</span>. Open it on
            this device to finish signing in.
          </p>
          <button
            onClick={() => setStatus("idle")}
            className="text-accent text-sm mt-2"
          >
            Use a different email
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="max-w-sm w-full space-y-3">
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full bg-surface2 rounded-xl px-4 py-3 text-sm outline-none placeholder:text-muted text-center"
          />
          <button
            type="submit"
            disabled={status === "sending" || !email.trim()}
            className="w-full py-3 rounded-xl bg-accent text-white font-semibold disabled:opacity-40"
          >
            {status === "sending" ? "Sending…" : "Send magic link"}
          </button>
          {error && <p className="text-danger text-sm">{error}</p>}
        </form>
      )}
    </div>
  );
}
