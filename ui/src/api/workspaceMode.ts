// Workspace mode (LOCAL vs CLOUD, M2.7 SPEC sections B, J): a runtime
// choice within the SAME real-mode build, not a separate build like
// DEMO_MODE. Persisted in localStorage so reloading/reopening the app
// doesn't force the user to choose again or re-enter an access code.
export type WorkspaceModeValue = "local" | "cloud";

const MODE_KEY = "impulsor-hub-workspace-mode";
const CLOUD_TOKEN_KEY = "impulsor-hub-cloud-token";
const CLOUD_URL_KEY = "impulsor-hub-cloud-url";

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private browsing / quota exceeded: mode selection just won't
    // survive a reload, which is a degraded-but-safe fallback.
  }
}

export function getMode(): WorkspaceModeValue | null {
  const v = safeGet(MODE_KEY);
  return v === "local" || v === "cloud" ? v : null;
}

export function setLocalMode() {
  safeSet(MODE_KEY, "local");
}

export function setCloudSession(url: string, token: string) {
  safeSet(MODE_KEY, "cloud");
  safeSet(CLOUD_URL_KEY, url);
  safeSet(CLOUD_TOKEN_KEY, token);
}

export function hasCloudSession(): boolean {
  return !!(safeGet(CLOUD_URL_KEY) && safeGet(CLOUD_TOKEN_KEY));
}

export function isCloudMode(): boolean {
  return getMode() === "cloud";
}

function safeRemove(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* private browsing etc */
  }
}

/** Forgets the chosen mode and any cloud session, returning to the "¿Dónde quieres trabajar?" screen. */
export function clearMode() {
  safeRemove(MODE_KEY);
  safeRemove(CLOUD_URL_KEY);
  safeRemove(CLOUD_TOKEN_KEY);
}

export function configuredCloudAgentUrl(): string | undefined {
  return import.meta.env.VITE_CLOUD_AGENT_URL;
}

/** Base URL to prefix every API call with -- "" for local (same-origin, unchanged since M2.6) or the stored cloud agent origin. */
export function apiBaseUrl(): string {
  return getMode() === "cloud" ? safeGet(CLOUD_URL_KEY) ?? "" : "";
}

export function activeToken(): string | undefined {
  if (getMode() === "cloud") return safeGet(CLOUD_TOKEN_KEY) ?? undefined;
  return typeof window !== "undefined" && window.__IMPULSOR_AGENT_TOKEN__
    ? window.__IMPULSOR_AGENT_TOKEN__
    : import.meta.env.VITE_AGENT_TOKEN;
}
