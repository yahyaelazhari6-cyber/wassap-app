/** Client API helpers + app-passcode lock storage (client-only). */
import { sha256Hex, randomHex } from "@/lib/e2ee";

// ------------------------------------------------------------------ auth token
// We authenticate with BOTH an httpOnly session cookie AND an Authorization
// Bearer token. Multipart uploads (status stories, profile pictures, media) can
// have their cookies stripped by a proxy/CDN, so the token header guarantees
// authentication. Stored in sessionStorage so it survives soft reloads.
const TOKEN_KEY = "wa_session_token";
let authToken: string | null = null;

/** Persist to localStorage (primary) + sessionStorage (fallback) + memory. */
export function setAuthToken(t: string | null): void {
  authToken = t;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked (private mode / partitioned iframe) */
  }
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function getAuthToken(): string | null {
  if (authToken) return authToken;
  try {
    authToken = localStorage.getItem(TOKEN_KEY);
  } catch {
    authToken = null;
  }
  if (!authToken) {
    try {
      authToken = sessionStorage.getItem(TOKEN_KEY);
    } catch {
      authToken = null;
    }
  }
  return authToken;
}

export function clearAuthToken(): void {
  setAuthToken(null);
}

/**
 * Append ?token= to a same-origin URL. Required for <img>, <video> and
 * download links, which cannot send an Authorization header — and whose
 * cookies are blocked when the app is embedded cross-site.
 */
export function withToken(url: string | null | undefined): string {
  if (!url) return "";
  const token = getAuthToken();
  if (!token || !url.startsWith("/api/")) return url || "";
  return url + (url.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
}

/** Build auth headers explicitly (used by JSON *and* multipart requests). */
export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getAuthToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}`, "x-session-token": token } : {}),
    ...(extra || {}),
  };
}

/** Refresh the bearer token from the server session (cookie-based recovery). */
async function refreshAuthToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    if (!res.ok) return null;
    const j = (await res.json()) as { token?: string | null };
    if (j?.token) {
      setAuthToken(j.token);
      return j.token;
    }
  } catch {
    /* offline */
  }
  return null;
}

async function doFetch(url: string, opts: RequestInit, token: string | null): Promise<Response> {
  const isForm = opts.body instanceof FormData;
  const headers: Record<string, string> = {
    // Bearer token is attached to EVERY request, including multipart uploads.
    // NOTE: never set Content-Type for FormData — the browser must add the
    // multipart boundary itself, otherwise the body cannot be parsed.
    ...(token ? { Authorization: `Bearer ${token}`, "x-session-token": token } : {}),
    ...(opts.body && !isForm ? { "Content-Type": "application/json" } : {}),
    ...(opts.headers as Record<string, string> | undefined),
  };
  // Belt-and-braces: also pass the token in the query string for uploads so
  // auth succeeds even if a proxy strips headers on multipart requests.
  const finalUrl = token && isForm ? withToken(url) : url;
  return fetch(finalUrl, { ...opts, headers, credentials: "include" });
}

export async function api<T>(url: string, opts: RequestInit = {}): Promise<T> {
  let token = getAuthToken();
  let res = await doFetch(url, opts, token);

  // Self-healing: a 401 usually means the in-memory/localStorage token was lost
  // (new tab, cleared storage, blocked cookie) while a valid session still
  // exists. Pull a fresh token from /api/auth/me and retry exactly once.
  // FormData and string bodies are safely re-sendable; streams are not.
  const retryable = !(opts.body instanceof ReadableStream);
  if (res.status === 401 && retryable) {
    const fresh = await refreshAuthToken();
    if (fresh) {
      token = fresh;
      res = await doFetch(url, opts, token);
    }
  }

  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = j.error || msg;
    } catch {
      /* noop */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const post = <T>(url: string, body?: unknown) =>
  api<T>(url, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const patch = <T>(url: string, body?: unknown) =>
  api<T>(url, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) });

export const del = <T>(url: string) => api<T>(url, { method: "DELETE" });

// ---------------------------------------------------------------- app lock
const LOCK_KEY = "wa_passcode_v1";

export async function setAppPasscode(code: string): Promise<void> {
  const salt = randomHex(16);
  const hash = await sha256Hex(salt + code);
  localStorage.setItem(LOCK_KEY, JSON.stringify({ salt, hash }));
}

export async function verifyAppPasscode(code: string): Promise<boolean> {
  const raw = localStorage.getItem(LOCK_KEY);
  if (!raw) return true;
  try {
    const { salt, hash } = JSON.parse(raw) as { salt: string; hash: string };
    return (await sha256Hex(salt + code)) === hash;
  } catch {
    return false;
  }
}

export function hasAppPasscode(): boolean {
  if (typeof window === "undefined") return false;
  return !!localStorage.getItem(LOCK_KEY);
}

export function clearAppPasscode(): void {
  localStorage.removeItem(LOCK_KEY);
}

// ---------------------------------------------------------------- local prefs
const THEME_KEY = "wa_theme";
export function getLocalTheme(): string {
  if (typeof window === "undefined") return "dark";
  return localStorage.getItem(THEME_KEY) || "dark";
}
export function setLocalTheme(t: string) {
  localStorage.setItem(THEME_KEY, t);
  document.documentElement.setAttribute("data-theme", t);
}

// ---------------------------------------------------------------- recents helpers
export { trackRecent, getRecents } from "@/lib/data";
