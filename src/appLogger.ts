export type AppLogCategory =
  | "agent"
  | "api"
  | "commerce"
  | "memory"
  | "playback"
  | "router"
  | "scene"
  | "system"
  | "voice";

export type AppLogStatus = "active" | "done" | "error" | "fallback" | "queued";

export type AppLogEntry = {
  id: string;
  timestamp: string;
  category: AppLogCategory;
  label: string;
  detail?: string;
  status?: AppLogStatus;
  metadata?: Record<string, unknown>;
};

export const appLogEventName = "sceneverse:log";

const storageKey = "sceneverse-agent-logs";
const maxLogs = 240;

function canUseStorage() {
  return typeof window !== "undefined" && "localStorage" in window;
}

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function readAppLogs(): AppLogEntry[] {
  if (!canUseStorage()) return [];

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as AppLogEntry[] : [];
  } catch {
    return [];
  }
}

function writeAppLogs(logs: AppLogEntry[]) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(storageKey, JSON.stringify(logs.slice(-maxLogs)));
}

export function logAppEvent(event: Omit<AppLogEntry, "id" | "timestamp">) {
  if (typeof window === "undefined") return;

  const entry: AppLogEntry = {
    id: createId(),
    timestamp: new Date().toISOString(),
    ...event,
  };
  const logs = [...readAppLogs(), entry].slice(-maxLogs);
  writeAppLogs(logs);
  window.dispatchEvent(new CustomEvent<AppLogEntry>(appLogEventName, { detail: entry }));
}

export function clearAppLogs() {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(storageKey);
  window.dispatchEvent(new CustomEvent(appLogEventName));
}

