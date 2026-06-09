import { useEffect, useMemo, useState } from "react";
import {
  appLogEventName,
  clearAppLogs,
  readAppLogs,
  type AppLogCategory,
  type AppLogEntry,
} from "./appLogger";
import "./logs.css";

const categoryLabels: Record<AppLogCategory, string> = {
  agent: "Agent",
  api: "API",
  commerce: "Commerce",
  memory: "Memory",
  playback: "Playback",
  router: "Router",
  scene: "Scene",
  system: "System",
  voice: "Voice",
};

function formatTime(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

function metadataPreview(metadata?: Record<string, unknown>) {
  if (!metadata) return null;
  const entries = Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null);
  if (entries.length === 0) return null;

  return (
    <dl className="logs-meta">
      {entries.slice(0, 8).map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function LogsPage() {
  const [logs, setLogs] = useState<AppLogEntry[]>(() => readAppLogs());
  const [category, setCategory] = useState<AppLogCategory | "all">("all");

  useEffect(() => {
    const update = () => setLogs(readAppLogs());
    window.addEventListener(appLogEventName, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(appLogEventName, update);
      window.removeEventListener("storage", update);
    };
  }, []);

  const newestFirst = useMemo(() => {
    const filtered = category === "all" ? logs : logs.filter((log) => log.category === category);
    return [...filtered].reverse();
  }, [category, logs]);
  const fallbackCount = logs.filter((log) => log.status === "fallback").length;
  const errorCount = logs.filter((log) => log.status === "error").length;
  const latestLog = logs.length > 0 ? logs[logs.length - 1] : null;
  const categories = Array.from(new Set(logs.map((log) => log.category)));

  return (
    <main className="logs-page">
      <header className="logs-header">
        <div>
          <a className="logs-back" href="/">CineVerse</a>
          <h1>Agent behavior logs</h1>
          <p>Router decisions, agent traces, API fallbacks, voice state, and commerce enrichment.</p>
        </div>
        <div className="logs-actions">
          <a href="/" className="logs-button">Open app</a>
          <button
            className="logs-button danger"
            onClick={() => {
              clearAppLogs();
              setLogs([]);
            }}
          >
            Clear logs
          </button>
        </div>
      </header>

      <section className="logs-stats" aria-label="Log summary">
        <article>
          <span>Total events</span>
          <strong>{logs.length}</strong>
        </article>
        <article>
          <span>Fallbacks</span>
          <strong>{fallbackCount}</strong>
        </article>
        <article>
          <span>Errors</span>
          <strong>{errorCount}</strong>
        </article>
        <article>
          <span>Latest</span>
          <strong>{latestLog ? formatTime(latestLog.timestamp) : "none"}</strong>
        </article>
      </section>

      <nav className="logs-filters" aria-label="Log filters">
        <button className={category === "all" ? "active" : ""} onClick={() => setCategory("all")}>
          All
        </button>
        {categories.map((item) => (
          <button
            className={category === item ? "active" : ""}
            key={item}
            onClick={() => setCategory(item)}
          >
            {categoryLabels[item]}
          </button>
        ))}
      </nav>

      <section className="logs-timeline" aria-label="Application event timeline">
        {newestFirst.length === 0 ? (
          <div className="logs-empty">
            <strong>No events yet</strong>
            <span>Open the app, trigger Vera, step into a scene, or ask a character a question.</span>
          </div>
        ) : (
          newestFirst.map((log) => (
            <article className={`log-row status-${log.status ?? "done"}`} key={log.id}>
              <time>{formatTime(log.timestamp)}</time>
              <div className="log-body">
                <div className="log-title">
                  <span>{categoryLabels[log.category]}</span>
                  <strong>{log.label}</strong>
                  {log.status ? <em>{log.status}</em> : null}
                </div>
                {log.detail ? <p>{log.detail}</p> : null}
                {metadataPreview(log.metadata)}
              </div>
            </article>
          ))
        )}
      </section>
    </main>
  );
}
