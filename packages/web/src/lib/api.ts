import { supabase } from "./supabase.ts";

// Normalize: trim trailing slash and force a scheme. A scheme-less value
// (e.g. "smart-trainer-production.up.railway.app") would otherwise be treated
// as a *relative path* by fetch — requests then hit the SPA's own origin, the
// rewrite serves index.html with a 200, and every read silently parses to
// nothing. (This exact misconfig took the app down in v1 testing.)
const rawApiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim().replace(/\/$/, "") ?? "";
const API_URL = rawApiUrl && !/^https?:\/\//i.test(rawApiUrl) ? `https://${rawApiUrl}` : rawApiUrl;

// Guard: if VITE_API_URL is missing at build time, API_URL is "" and every
// request falls back to the SPA's own origin. Reads then return index.html
// (HTML, not JSON) and writes (POST/PUT/PATCH) get a confusing 405 from the
// static host (e.g. Vercel). Surface this loudly instead of as a cryptic 405.
if (!API_URL && import.meta.env.PROD) {
  console.error(
    "[api] VITE_API_URL is empty in this production build. API calls will hit " +
      "the static host; POSTs will return 405. Set VITE_API_URL (the server's " +
      "URL, e.g. https://smart-trainer-production.up.railway.app) in the Vercel " +
      "project's Production environment and redeploy."
  );
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

/**
 * fetch wrapper that attaches the current Supabase session JWT as a Bearer
 * token. The server middleware validates it and derives userId. All domain
 * traffic goes web → server (action layer) → core → Postgres.
 */
async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  if (!API_URL) {
    throw new ApiError(
      0,
      "API base URL is not configured (VITE_API_URL missing in this build). " +
        "Set it in the deployment environment and redeploy."
    );
  }

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j?.error || j?.message) msg = j.error ?? j.message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, msg);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Multipart POST (file uploads). Content-Type is set by the browser. */
async function requestForm<T>(path: string, form: FormData): Promise<T> {
  if (!API_URL) {
    throw new ApiError(
      0,
      "API base URL is not configured (VITE_API_URL missing in this build). " +
        "Set it in the deployment environment and redeploy."
    );
  }

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });

  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j?.error || j?.message) msg = j.error ?? j.message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  postForm: <T>(path: string, form: FormData) => requestForm<T>(path, form),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};
