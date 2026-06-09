import React, { useRef, useState, useEffect } from "react";
import "./landing.css";

type Props = {
  onEnter: () => void;
};

const DEMO_VIDEO = {
  id: "yoda-vader-duel",
  title: "Yoda vs Vader: The Duel That Never Was",
  tagline: "An AI-generated battle across timelines — enter the scene and reshape the outcome.",
  genre: "Action · Fantasy · AI Demo",
  badge: "LIVE DEMO",
  duration: "3 min",
  year: "2025",
  agents: ["Yoda", "Vader", "Director"],
};

const COMING_SOON = [
  {
    id: "cs-1",
    title: "The Last Heist",
    genre: "Crime · Thriller",
    gradient: "linear-gradient(135deg, #1a0a00 0%, #3d1800 40%, #1a0500 100%)",
    accent: "#f59e0b",
    icon: "◆",
  },
  {
    id: "cs-2",
    title: "Stellar Drift",
    genre: "Sci-Fi · Drama",
    gradient: "linear-gradient(135deg, #00071a 0%, #001840 40%, #060018 100%)",
    accent: "#7fc6ff",
    icon: "✦",
  },
  {
    id: "cs-3",
    title: "Midnight Protocol",
    genre: "Spy · Action",
    gradient: "linear-gradient(135deg, #001a0a 0%, #00331a 40%, #001008 100%)",
    accent: "#9ee78e",
    icon: "⬡",
  },
  {
    id: "cs-4",
    title: "The Garden Hour",
    genre: "Mystery · Slow Cinema",
    gradient: "linear-gradient(135deg, #0d0a00 0%, #2a2000 40%, #0a0800 100%)",
    accent: "#d4b896",
    icon: "❋",
  },
];

function useVideoThumbnail(src: string, seekTime = 1.5) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";

    video.addEventListener("loadedmetadata", () => {
      video.currentTime = Math.min(seekTime, video.duration * 0.1);
    });

    video.addEventListener("seeked", () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        setDataUrl(canvas.toDataURL("image/jpeg", 0.85));
      }
    });

    video.src = src;
  }, [src, seekTime]);

  return dataUrl;
}

function PlaceholderThumb({
  gradient,
  accent,
  icon,
  title,
}: {
  gradient: string;
  accent: string;
  icon: string;
  title: string;
}) {
  return (
    <div className="lnd-placeholder-thumb" style={{ background: gradient }}>
      <span className="lnd-placeholder-icon" style={{ color: accent }}>{icon}</span>
      <span className="lnd-placeholder-title" style={{ color: accent }}>{title}</span>
      <div className="lnd-placeholder-noise" aria-hidden="true" />
    </div>
  );
}

export default function Landing({ onEnter }: Props) {
  const thumbnail = useVideoThumbnail("/demo-duel.mp4", 2);

  return (
    <div className="landing">
      {/* NAV */}
      <nav className="lnd-nav">
        <div className="lnd-nav-brand">
          <span className="lnd-logo-mark" aria-hidden="true" />
          <strong>CineVerse</strong>
        </div>
        <div className="lnd-nav-actions">
          <span className="lnd-nav-tag">AI · Immersive</span>
          <button className="lnd-btn-ghost lnd-btn-sm" onClick={onEnter}>
            Enter Experience
          </button>
        </div>
      </nav>

      {/* HERO */}
      <section className="lnd-hero">
        <div className="lnd-hero-bg">
          {thumbnail ? (
            <img
              src={thumbnail}
              className="lnd-hero-img ready"
              alt="Yoda vs Vader scene"
              draggable={false}
            />
          ) : (
            <div className="lnd-hero-fallback" />
          )}
          <div className="lnd-hero-vignette" />
        </div>

        <div className="lnd-hero-content">
          <span className="lnd-badge lnd-badge-live">{DEMO_VIDEO.badge}</span>
          <h1 className="lnd-hero-title">{DEMO_VIDEO.title}</h1>
          <p className="lnd-hero-meta">
            {DEMO_VIDEO.year} &middot; {DEMO_VIDEO.duration} &middot; {DEMO_VIDEO.genre}
          </p>
          <p className="lnd-hero-tagline">{DEMO_VIDEO.tagline}</p>

          <div className="lnd-hero-agents">
            {DEMO_VIDEO.agents.map((a) => (
              <span key={a} className="lnd-agent-pill">{a}</span>
            ))}
          </div>

          <div className="lnd-hero-cta">
            <button className="lnd-btn-primary" onClick={onEnter}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <polygon points="5,3 19,12 5,21" />
              </svg>
              Watch Now
            </button>
            <button className="lnd-btn-ghost" onClick={onEnter}>
              More Info
            </button>
          </div>
        </div>

        <div className="lnd-hero-scroll-hint" aria-hidden="true">
          <span />
        </div>
      </section>

      {/* ROWS */}
      <div className="lnd-rows">

        {/* How it works */}
        <section className="lnd-how">
          <h2 className="lnd-row-label">How CineVerse Works</h2>
          <div className="lnd-how-steps">
            {[
              { n: "01", title: "Watch", desc: "Stream any scene in our catalog." },
              { n: "02", title: "Step In", desc: 'Say "Hey Vera, step into this scene" — AI agents generate an interactive world around the frame.' },
              { n: "03", title: "Interact", desc: "Ask characters questions, collect moments, or buy what you see." },
            ].map((s) => (
              <div key={s.n} className="lnd-how-step">
                <span className="lnd-how-num">{s.n}</span>
                <strong>{s.title}</strong>
                <p>{s.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Featured row */}
        <section className="lnd-row">
          <h2 className="lnd-row-label">Featured Demos</h2>
          <div className="lnd-cards-track">

            {/* Real demo card */}
            <button className="lnd-card lnd-card-active" onClick={onEnter} aria-label={`Watch ${DEMO_VIDEO.title}`}>
              <div className="lnd-card-thumb">
                {thumbnail ? (
                  <img src={thumbnail} alt={DEMO_VIDEO.title} className="lnd-card-thumb-img" draggable={false} />
                ) : (
                  <div className="lnd-card-thumb-loading" />
                )}
                <div className="lnd-card-overlay">
                  <span className="lnd-badge lnd-badge-live">LIVE</span>
                  <div className="lnd-card-play">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <polygon points="5,3 19,12 5,21" />
                    </svg>
                  </div>
                </div>
              </div>
              <div className="lnd-card-info">
                <strong>{DEMO_VIDEO.title}</strong>
                <span>{DEMO_VIDEO.genre}</span>
              </div>
            </button>

            {/* Coming soon cards */}
            {COMING_SOON.map((c) => (
              <div key={c.id} className="lnd-card lnd-card-soon">
                <div className="lnd-card-thumb">
                  <PlaceholderThumb
                    gradient={c.gradient}
                    accent={c.accent}
                    icon={c.icon}
                    title={c.title}
                  />
                  <div className="lnd-card-overlay-soon">
                    <span className="lnd-badge">COMING SOON</span>
                  </div>
                </div>
                <div className="lnd-card-info">
                  <strong>{c.title}</strong>
                  <span>{c.genre}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Stats row */}
        <section className="lnd-stats">
          <div className="lnd-stat">
            <strong>1</strong>
            <span>Live Demo</span>
          </div>
          <div className="lnd-stat-divider" aria-hidden="true" />
          <div className="lnd-stat">
            <strong>3</strong>
            <span>AI Agents per Scene</span>
          </div>
          <div className="lnd-stat-divider" aria-hidden="true" />
          <div className="lnd-stat">
            <strong>∞</strong>
            <span>Branching Possibilities</span>
          </div>
        </section>

      </div>

      {/* FOOTER */}
      <footer className="lnd-footer">
        <span className="lnd-footer-brand">CineVerse</span>
        <span className="lnd-footer-copy">Built at Hackathon 2025 · AI-Powered Cinema</span>
      </footer>
    </div>
  );
}
