import React, { useEffect, useState } from "react";
import "./landing.css";

type Props = {
  onEnter: () => void;
};

const DEMO_VIDEO = {
  id: "yoda-vader-duel",
  title: "Yoda vs Vader: The Duel That Never Was",
  tagline:
    "A forbidden duel opens inside a misted timeline. Step into the frame, question the characters, and bend the next branch.",
  genre: "Action · Fantasy · AI Demo",
  badge: "Featured premiere · AI scene generated",
  duration: "3 min",
  year: "2025",
  agents: ["Yoda", "Vader", "Director"],
};

const COMING_SOON = [
  {
    id: "cs-1",
    title: "The Last Heist",
    genre: "Crime · Thriller",
    metric: "42",
    state: "queued branches",
  },
  {
    id: "cs-2",
    title: "Stellar Drift",
    genre: "Sci-Fi · Drama",
    metric: "18",
    state: "new endings",
  },
  {
    id: "cs-3",
    title: "Midnight Protocol",
    genre: "Spy · Action",
    metric: "07",
    state: "locked scenes",
  },
];

const SCENE_PATHS = [
  "Ask Vader why he refuses to yield.",
  "Ask Yoda what the green blade means.",
  "Collect the saber replica from the frame.",
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
        setDataUrl(canvas.toDataURL("image/jpeg", 0.86));
      }
    });

    video.src = src;
  }, [src, seekTime]);

  return dataUrl;
}

export default function Landing({ onEnter }: Props) {
  const thumbnail = useVideoThumbnail("/demo-duel.mp4", 2);

  function scrollToCatalog() {
    document.getElementById("scene-catalog")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="landing">
      <nav className="lnd-nav" aria-label="CineVerse navigation">
        <div className="lnd-nav-brand">
          <span className="lnd-logo-mark" aria-hidden="true" />
          <strong>CineVerse</strong>
        </div>
        <div className="lnd-nav-actions">
          <span className="lnd-token">100 scene credits</span>
          <button className="lnd-nav-link" onClick={onEnter}>
            Enter
          </button>
        </div>
      </nav>

      <main>
        <section className="lnd-hero" aria-labelledby="landing-title">
          <div className="lnd-hero-bg">
            {thumbnail ? (
              <img
                src={thumbnail}
                className="lnd-hero-img ready"
                alt="CineVerse duel scene"
                draggable={false}
              />
            ) : (
              <div className="lnd-hero-fallback" />
            )}
            <div className="lnd-hero-vignette" />
            <div className="lnd-hero-script" aria-hidden="true">
              <span>ENTER</span>
              <span>THE FRAME</span>
              <span>REWRITE</span>
            </div>
          </div>

          <div className="lnd-hero-content">
            <span className="lnd-badge">{DEMO_VIDEO.badge}</span>
            <h1 id="landing-title" className="lnd-hero-title">
              {DEMO_VIDEO.title}
            </h1>
            <p className="lnd-hero-tagline">{DEMO_VIDEO.tagline}</p>

            <div className="lnd-hero-cta">
              <button className="lnd-btn-primary" onClick={onEnter}>
                Enter experience
              </button>
              <button className="lnd-btn-secondary" onClick={scrollToCatalog}>
                View all scenes
              </button>
            </div>
          </div>

          <aside className="lnd-hero-meta" aria-label="Scene stats">
            <div className="lnd-hero-stat">
              <strong>3</strong>
              <span>Active agents</span>
            </div>
            <div className="lnd-hero-stat">
              <strong>∞</strong>
              <span>Branch paths</span>
            </div>
          </aside>
        </section>

        <section className="lnd-section lnd-catalog" id="scene-catalog" aria-labelledby="catalog-title">
          <div className="lnd-section-header">
            <h2 id="catalog-title">Growing Universes</h2>
            <button onClick={onEnter}>View all</button>
          </div>

          <div className="lnd-universe-row">
            <button className="lnd-premiere-card" onClick={onEnter} aria-label={`Watch ${DEMO_VIDEO.title}`}>
              <div className="lnd-premiere-media">
                {thumbnail ? (
                  <img src={thumbnail} alt={DEMO_VIDEO.title} draggable={false} />
                ) : (
                  <div className="lnd-premiere-loading" />
                )}
              </div>
              <div className="lnd-premiere-copy">
                <span>{DEMO_VIDEO.year} · {DEMO_VIDEO.duration}</span>
                <strong>{DEMO_VIDEO.title}</strong>
                <em>{DEMO_VIDEO.genre}</em>
              </div>
            </button>

            {COMING_SOON.map((item) => (
              <article className="lnd-universe-card" key={item.id}>
                <div>
                  <span>{item.genre}</span>
                  <strong>{item.title}</strong>
                </div>
                <div className="lnd-universe-metric">
                  <strong>{item.metric}</strong>
                  <span>{item.state}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="lnd-section lnd-paths" aria-labelledby="paths-title">
          <div className="lnd-section-header">
            <h2 id="paths-title">Hot Branches</h2>
            <button onClick={onEnter}>More</button>
          </div>

          <div className="lnd-path-list">
            {SCENE_PATHS.map((path, index) => (
              <button className="lnd-path-item" key={path} onClick={onEnter}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{path}</strong>
                <em>{DEMO_VIDEO.agents[index] ?? "Director"}</em>
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
