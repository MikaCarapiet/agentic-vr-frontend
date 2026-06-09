import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Agent = {
  name: string;
  role: string;
  state: string;
};

type Trace = {
  step: string;
  agent: string;
  status: "ready" | "active" | "done";
};

const agents: Agent[] = [
  { name: "Maya", role: "Protagonist", state: "guarded, alert" },
  { name: "Riven", role: "Rival", state: "controlled anger" },
  { name: "Director", role: "Story lens", state: "meta analysis" },
];

const trace: Trace[] = [
  { step: "frame captured", agent: "Scene Parser", status: "done" },
  { step: "intent routed", agent: "Orchestrator", status: "active" },
  { step: "memory loaded", agent: "Memory", status: "done" },
  { step: "response drafted", agent: "Maya", status: "ready" },
];

function App() {
  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <h1>SceneVerse</h1>
          <p>Landscape VR scale test</p>
        </div>
        <div className="top-actions">
          <button className="primary generate-button">Generate SceneVerse</button>
          <div className="viewport-chip">VR canvas</div>
        </div>
      </header>

      <section className="landscape-stage" aria-label="SceneVerse landscape prototype">
        <aside className="agent-rail" aria-label="Agents">
          {agents.map((agent) => (
            <button className="agent-card" key={agent.name}>
              <span className="agent-avatar">{agent.name.slice(0, 1)}</span>
              <span>
                <strong>{agent.name}</strong>
              </span>
            </button>
          ))}
        </aside>

        <section className="cinema-zone" aria-label="Cinematic viewport">
          <div className="video-frame">
            <div className="scene-gradient" />
            <div className="pause-marker">
              <span />
              <span />
            </div>
            <div className="scene-caption">
              <strong>Paused scene</strong>
              <span>00:01:42 - corridor confrontation</span>
            </div>
          </div>

          <div className="vr-depth-map" aria-label="VR depth mapping sketch">
            <div>Left panel: agents</div>
            <div>Center plane: cinematic world</div>
            <div>Right panel: chat and context</div>
          </div>
        </section>

        <aside className="context-rail" aria-label="Scene context and chat">
          <section className="panel">
            <div className="section-label">Context</div>
            <h2>Suspense</h2>
          </section>

          <section className="panel chat-panel">
            <div className="section-label">Chat</div>
            <div className="message user">What are you hiding?</div>
            <div className="input-row">
              <span>Ask</span>
              <button>Send</button>
            </div>
          </section>
        </aside>

        <footer className="timeline-band">
          <div className="controls">
            <button>▶</button>
            <button>↺</button>
          </div>
          <div className="timeline">
            <span className="timeline-progress" />
          </div>
          <div className="trace-strip">
            {trace.map((item) => (
              <span className={item.status} key={`${item.agent}-${item.step}`}>
                {item.agent}: {item.step}
              </span>
            ))}
          </div>
        </footer>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
