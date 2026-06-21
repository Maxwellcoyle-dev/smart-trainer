import { useState } from "react";
import { useAuth } from "./AuthProvider.tsx";

/** Parse auth errors from the URL hash or query string (e.g. after a bad magic link). */
function getUrlAuthError(): string | null {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  const desc =
    hash.get("error_description") ??
    query.get("error_description") ??
    hash.get("error") ??
    query.get("error");
  if (!desc) return null;
  // Clear the error fragment so it doesn't persist on refresh
  history.replaceState(null, "", window.location.pathname);
  return decodeURIComponent(desc.replace(/\+/g, " "));
}

export function LoginScreen() {
  const { signInWithEmail, verifyCode } = useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "verifying" | "error">("idle");
  const [error, setError] = useState<string | null>(() => getUrlAuthError());

  async function submitEmail(e: React.FormEvent) {
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

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setStatus("verifying");
    setError(null);
    const { error } = await verifyCode(email.trim(), code.trim());
    if (error) {
      setError(error);
      setStatus("sent"); // stay on code step
    }
    // on success, onAuthStateChange fires and App re-renders
  }

  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
      <p className="text-5xl mb-3">🏔️</p>
      <h1 className="text-2xl font-bold mb-1">Smart Trainer</h1>
      <p className="text-muted text-sm mb-8">Running &amp; climbing, coached by Claude.</p>

      {status === "idle" || status === "sending" || status === "error" ? (
        <form onSubmit={submitEmail} className="max-w-sm w-full space-y-3">
          {error && (
            <p className="text-danger text-sm bg-surface rounded-xl px-4 py-3">
              {error.includes("invalid") || error.includes("expired")
                ? "That sign-in link didn't work — request a new code below."
                : error}
            </p>
          )}
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
            {status === "sending" ? "Sending…" : "Send sign-in code"}
          </button>
        </form>
      ) : (
        <div className="max-w-sm w-full space-y-3">
          <div className="bg-surface rounded-2xl p-5 space-y-2">
            <p className="text-3xl">📬</p>
            <p className="font-semibold">Enter the 6-digit code</p>
            <p className="text-muted text-sm">
              We emailed a code to <span className="text-text">{email}</span>. Enter it below — or
              tap the magic link in the email on this device.
            </p>
          </div>
          <form onSubmit={submitCode} className="space-y-3">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              className="w-full bg-surface2 rounded-xl px-4 py-3 text-sm outline-none placeholder:text-muted text-center tracking-widest text-lg"
            />
            <button
              type="submit"
              disabled={status === "verifying" || code.length < 6}
              className="w-full py-3 rounded-xl bg-accent text-white font-semibold disabled:opacity-40"
            >
              {status === "verifying" ? "Verifying…" : "Sign in"}
            </button>
            {error && <p className="text-danger text-sm">{error}</p>}
          </form>
          <button
            onClick={() => { setStatus("idle"); setError(null); setCode(""); }}
            className="text-accent text-sm"
          >
            Use a different email
          </button>
        </div>
      )}
    </div>
  );
}
