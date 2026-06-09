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
  { id: "cs-1", title: "The Last Heist", genre: "Crime · Thriller", badge: "COMING SOON" },
  { id: "cs-2", title: "Stellar Drift", genre: "Sci-Fi · Drama", badge: "COMING SOON" },
  { id: "cs-3", title: "Midnight Protocol", genre: "Spy · Action", badge: "COMING SOON" },
  { id: "cs-4", title: "The Garden Hour", genre: "Mystery · Slow Cinema", badge: "COMING SOON" },
];

export default function Landing({ onEnter }: Props) {
  const heroVideoRef = useRef<HTMLVideoElement>(null);
  const [heroReady, setHeroReady] = useState(false);
  const [heroMuted, setHeroMuted] = useState(true);

  useEffect(() => {
    const v = heroVideoRef.current;
    if (!v) return;
    v.muted = true;
    v.play().catch(() => {});
  }, []);

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
          <video
            ref={heroVideoRef}
            className={`lnd-hero-video${heroReady ? " ready" : ""}`}
            src="/demo-duel.mp4"
            playsInline
            muted
            loop
            preload="auto"
            onCanPlay={() => setHeroReady(true)}
          />
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
            <button
              className="lnd-btn-ghost"
              onClick={() => {
                const v = heroVideoRef.current;
                if (!v) return;
                setHeroMuted((m) => {
                  v.muted = !m;
                  return !m;
                });
              }}
              aria-label={heroMuted ? "Unmute trailer" : "Mute trailer"}
            >
              {heroMuted ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <polygon points="11,5 6,9 2,9 2,15 6,15 11,19" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <polygon points="11,5 6,9 2,9 2,15 6,15 11,19" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              )}
              {heroMuted ? "Unmute" : "Mute"}
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
                <video
                  src="/demo-duel.mp4"
                  muted
                  playsInline
                  preload="metadata"
                  className="lnd-card-video"
                  onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
                  onMouseLeave={(e) => {
                    const v = e.currentTarget as HTMLVideoElement;
                    v.pause();
                    v.currentTime = 0;
                  }}
                />
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
                <div className="lnd-card-thumb lnd-card-thumb-empty">
                  <div className="lnd-card-soon-inner">
                    <span className="lnd-badge">{c.badge}</span>
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
