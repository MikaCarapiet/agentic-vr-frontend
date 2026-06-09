import React, { useEffect, useMemo, useState } from "react";
import { FALLBACK_CATALOG_VIDEO, type CatalogVideo } from "./videoCatalog";
import "./landing.css";

type Props = {
  videos: CatalogVideo[];
  isLoading?: boolean;
  onOpenVideo: (videoId: string) => void;
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

const CAROUSEL_INTERVAL_MS = 5200;

function randomVideoIndex(total: number) {
  if (total <= 1) return 0;
  return Math.floor(Math.random() * total);
}

function randomNextVideoIndex(total: number, currentIndex: number) {
  if (total <= 1) return 0;
  const offset = 1 + Math.floor(Math.random() * (total - 1));
  return (currentIndex + offset) % total;
}

function rotateVideos(videos: CatalogVideo[], startIndex: number) {
  if (videos.length <= 1) return videos;
  return [...videos.slice(startIndex), ...videos.slice(0, startIndex)];
}

function useVideoThumbnail(src: string, seekTime = 1.5) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    setDataUrl(null);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";

    video.addEventListener("loadedmetadata", () => {
      video.currentTime = Math.min(seekTime, video.duration * 0.1);
    });

    video.addEventListener("seeked", () => {
      if (disposed) return;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          setDataUrl(canvas.toDataURL("image/jpeg", 0.86));
        } catch {
          setDataUrl(null);
        }
      }
    });

    video.addEventListener("error", () => {
      if (!disposed) setDataUrl(null);
    });

    video.src = src;
    return () => {
      disposed = true;
      video.removeAttribute("src");
      video.load();
    };
  }, [src, seekTime]);

  return dataUrl;
}

export default function Landing({ videos, isLoading = false, onOpenVideo }: Props) {
  const carouselVideos = videos.length ? videos : [FALLBACK_CATALOG_VIDEO];
  const [featuredIndex, setFeaturedIndex] = useState(() => randomVideoIndex(carouselVideos.length));
  const featuredVideo = carouselVideos[featuredIndex] ?? carouselVideos[0];
  const visibleCarouselVideos = useMemo(
    () => rotateVideos(carouselVideos, featuredIndex).slice(0, Math.min(4, carouselVideos.length)),
    [carouselVideos, featuredIndex],
  );
  const secondaryVideos = visibleCarouselVideos.filter((video) => video.id !== featuredVideo.id).slice(0, 3);
  const placeholderCards = COMING_SOON.slice(0, Math.max(0, 3 - secondaryVideos.length));
  const thumbnail = useVideoThumbnail(featuredVideo.playbackUrl, 2);

  useEffect(() => {
    setFeaturedIndex(randomVideoIndex(carouselVideos.length));
  }, [carouselVideos.length]);

  useEffect(() => {
    if (carouselVideos.length <= 1) return;

    const intervalId = window.setInterval(() => {
      setFeaturedIndex((currentIndex) => randomNextVideoIndex(carouselVideos.length, currentIndex));
    }, CAROUSEL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [carouselVideos.length]);

  function openFeaturedVideo() {
    onOpenVideo(featuredVideo.id);
  }

  function featureVideo(videoId: string) {
    const nextIndex = carouselVideos.findIndex((video) => video.id === videoId);
    if (nextIndex >= 0) setFeaturedIndex(nextIndex);
  }

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
          <button className="lnd-nav-link" onClick={openFeaturedVideo}>
            Enter
          </button>
        </div>
      </nav>

      <main>
        <section className="lnd-hero" aria-labelledby="landing-title" data-featured-video-id={featuredVideo.id}>
          <div className="lnd-hero-bg" key={`bg-${featuredVideo.id}`}>
            {thumbnail ? (
              <img
                src={thumbnail}
                className="lnd-hero-img ready"
                alt={`${featuredVideo.title} preview`}
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

          <div className="lnd-hero-content" key={`copy-${featuredVideo.id}`}>
            <span className="lnd-badge">{featuredVideo.badge}</span>
            <h1 id="landing-title" className="lnd-hero-title">
              {featuredVideo.title}
            </h1>
            <p className="lnd-hero-tagline">{featuredVideo.tagline}</p>

            <div className="lnd-hero-cta">
              <button className="lnd-btn-primary" onClick={openFeaturedVideo}>
                Enter experience
              </button>
              <button className="lnd-btn-secondary" onClick={scrollToCatalog}>
                View all scenes
              </button>
            </div>

            <div className="lnd-carousel-controls" aria-label="Featured video carousel">
              <span>Auto preview</span>
              <div className="lnd-carousel-dots">
                {carouselVideos.map((video, index) => (
                  <button
                    className={index === featuredIndex ? "active" : ""}
                    key={video.id}
                    onClick={() => setFeaturedIndex(index)}
                    aria-label={`Feature ${video.title}`}
                    aria-current={index === featuredIndex ? "true" : undefined}
                  />
                ))}
              </div>
            </div>
          </div>

        </section>

        <section className="lnd-section lnd-catalog" id="scene-catalog" aria-labelledby="catalog-title">
          <div className="lnd-section-header">
            <h2 id="catalog-title">Growing Universes</h2>
            <div className="lnd-section-actions">
              {isLoading ? <span className="lnd-loading-pill">Syncing backend</span> : null}
              <button onClick={scrollToCatalog}>View all</button>
            </div>
          </div>

          <div className="lnd-universe-row" key={`row-${featuredVideo.id}`}>
            <button
              className="lnd-premiere-card active"
              onClick={openFeaturedVideo}
              aria-label={`Watch ${featuredVideo.title}`}
            >
              <div className="lnd-premiere-media">
                {thumbnail ? (
                  <img src={thumbnail} alt={featuredVideo.title} draggable={false} />
                ) : (
                  <div className="lnd-premiere-loading" />
                )}
              </div>
              <div className="lnd-premiere-copy">
                <span>{featuredVideo.year} · {featuredVideo.duration}</span>
                <strong>{featuredVideo.title}</strong>
                <em>{featuredVideo.genre}</em>
              </div>
            </button>

            {secondaryVideos.map((item) => (
              <button
                className="lnd-universe-card"
                key={item.id}
                onClick={() => featureVideo(item.id)}
                aria-label={`Feature ${item.title}`}
              >
                <div>
                  <span>{item.genre}</span>
                  <strong>{item.title}</strong>
                </div>
                <div className="lnd-universe-metric">
                  <strong>{item.year}</strong>
                  <span>{item.sourceLabel}</span>
                </div>
              </button>
            ))}

            {placeholderCards.map((item) => (
              <article className="lnd-universe-card muted" key={item.id}>
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

      </main>
    </div>
  );
}
