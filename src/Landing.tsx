import React, { useEffect, useMemo, useState } from "react";
import { FALLBACK_CATALOG_VIDEO, type CatalogVideo } from "./videoCatalog";
import "./landing.css";

type Props = {
  videos: CatalogVideo[];
  isLoading?: boolean;
  onOpenVideo: (videoId: string) => void;
};

const CAROUSEL_INTERVAL_MS = 4000;

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function randomVideoIndex(_total: number) {
  return 0;
}

function nextVideoIndex(total: number, currentIndex: number) {
  if (total <= 1) return 0;
  return (currentIndex + 1) % total;
}

function rotateVideos(videos: CatalogVideo[], startIndex: number) {
  if (videos.length <= 1) return videos;
  return [...videos.slice(startIndex), ...videos.slice(0, startIndex)];
}

function getHeroTitleFitClass(title: string) {
  const length = title.trim().length;
  if (length >= 56) return "is-condensed";
  if (length >= 40) return "is-compact";
  return "";
}

function useVideoThumbnail(src: string, seekTime = 1.5) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    setDataUrl(null);
    if (!src) return;

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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const featuredVideo = carouselVideos[featuredIndex] ?? carouselVideos[0];
  const visibleCarouselVideos = useMemo(
    () => rotateVideos(carouselVideos, featuredIndex).slice(0, Math.min(4, carouselVideos.length)),
    [carouselVideos, featuredIndex],
  );
  const secondaryVideos = visibleCarouselVideos.filter((video) => video.id !== featuredVideo.id).slice(0, 3);
  const heroTitleFitClass = getHeroTitleFitClass(featuredVideo.title);
  const videoThumbnail = useVideoThumbnail(featuredVideo.thumbnailUrl ? "" : featuredVideo.playbackUrl, 2);
  const thumbnail = featuredVideo.thumbnailUrl ?? videoThumbnail;

  useEffect(() => {
    setFeaturedIndex(randomVideoIndex(carouselVideos.length));
  }, [carouselVideos.length]);

  useEffect(() => {
    if (carouselVideos.length <= 1) return;

    const timeoutId = window.setTimeout(() => {
      setFeaturedIndex(nextVideoIndex(carouselVideos.length, featuredIndex));
    }, CAROUSEL_INTERVAL_MS);

    return () => window.clearTimeout(timeoutId);
  }, [carouselVideos.length, featuredIndex]);

  useEffect(() => {
    function syncFullscreenState() {
      const fullscreenDocument = document as FullscreenDocument;
      setIsFullscreen(Boolean(document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement));
    }

    syncFullscreenState();
    document.addEventListener("fullscreenchange", syncFullscreenState);
    document.addEventListener("webkitfullscreenchange", syncFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
      document.removeEventListener("webkitfullscreenchange", syncFullscreenState);
    };
  }, []);

  function openFeaturedVideo() {
    openCatalogVideo(featuredVideo);
  }

  function featureVideo(videoId: string) {
    const nextIndex = carouselVideos.findIndex((video) => video.id === videoId);
    if (nextIndex >= 0) setFeaturedIndex(nextIndex);
  }

  function scrollToCatalog() {
    document.getElementById("scene-catalog")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function previewCardFromKeyboard(event: React.KeyboardEvent<HTMLElement>, videoId: string) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    featureVideo(videoId);
  }

  function previewVideoFromCard(event: React.MouseEvent<HTMLButtonElement>, videoId: string) {
    event.stopPropagation();
    featureVideo(videoId);
  }

  function openCatalogVideo(video: CatalogVideo) {
    if (video.playerPlayable) {
      onOpenVideo(video.id);
      return;
    }

    if (video.externalUrl) {
      window.open(video.externalUrl, "_blank", "noopener,noreferrer");
    }
  }

  function openCatalogVideoFromCard(event: React.MouseEvent<HTMLButtonElement>, video: CatalogVideo) {
    event.stopPropagation();
    openCatalogVideo(video);
  }

  async function toggleFullscreen() {
    const fullscreenDocument = document as FullscreenDocument;
    const root = document.documentElement as FullscreenElement;

    try {
      if (document.fullscreenElement || fullscreenDocument.webkitFullscreenElement) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else {
          await fullscreenDocument.webkitExitFullscreen?.();
        }
        return;
      }

      if (root.requestFullscreen) {
        await root.requestFullscreen({ navigationUI: "hide" });
      } else {
        await root.webkitRequestFullscreen?.();
      }
    } catch {
      setIsFullscreen(Boolean(document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement));
    }
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
          <button
            className={`lnd-fullscreen-button${isFullscreen ? " active" : ""}`}
            type="button"
            onClick={toggleFullscreen}
            aria-pressed={isFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            <span className="lnd-fullscreen-icon" aria-hidden="true" />
            <span>{isFullscreen ? "Exit" : "Fullscreen"}</span>
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
            <h1 id="landing-title" className={["lnd-hero-title", heroTitleFitClass].filter(Boolean).join(" ")}>
              {featuredVideo.title}
            </h1>
            <p className="lnd-hero-tagline">{featuredVideo.tagline}</p>

            <div className="lnd-hero-cta">
              <button className="lnd-btn-primary" onClick={openFeaturedVideo}>
                {featuredVideo.playerPlayable ? "Watch now" : "Open source"}
              </button>
              <button className="lnd-btn-secondary" onClick={scrollToCatalog}>
                View all scenes
              </button>
            </div>

            <div
              className="lnd-carousel-controls"
              aria-label="Featured video carousel"
              style={{ "--lnd-carousel-interval": `${CAROUSEL_INTERVAL_MS}ms` } as React.CSSProperties}
            >
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
            <article
              className="lnd-premiere-card active"
              data-video-id={featuredVideo.id}
            >
              <div className="lnd-premiere-media">
                {thumbnail ? (
                  <img src={thumbnail} alt={featuredVideo.title} draggable={false} />
                ) : (
                  <div className="lnd-premiere-loading" />
                )}
              </div>
              <div className="lnd-premiere-copy lnd-card-copy">
                <span>{featuredVideo.year} · {featuredVideo.duration}</span>
                <strong>{featuredVideo.title}</strong>
                <p>{featuredVideo.tagline}</p>
                <div className="lnd-card-actions lnd-card-actions-left">
                  <button
                    className="lnd-card-watch"
                    onClick={openFeaturedVideo}
                    aria-label={`${featuredVideo.playerPlayable ? "Watch" : "Open"} ${featuredVideo.title}`}
                  >
                    {featuredVideo.playerPlayable ? "Watch" : "Open"}
                  </button>
                </div>
              </div>
            </article>

            {secondaryVideos.map((item) => (
              <article
                className="lnd-universe-card is-clickable"
                key={item.id}
                data-video-id={item.id}
                role="button"
                tabIndex={0}
                onClick={() => featureVideo(item.id)}
                onKeyDown={(event) => previewCardFromKeyboard(event, item.id)}
              >
                <div className="lnd-card-copy">
                  <span>{item.genre}</span>
                  <strong>{item.title}</strong>
                  <p>{item.tagline}</p>
                </div>
                <div className="lnd-card-footer">
                  <div className="lnd-universe-metric">
                    <strong>{item.year}</strong>
                    <span>{item.sourceLabel}</span>
                  </div>
                  <div className="lnd-card-actions">
                    <button
                      className="lnd-card-preview"
                      onClick={(event) => previewVideoFromCard(event, item.id)}
                      aria-label={`Preview ${item.title}`}
                    >
                      Preview
                    </button>
                    <button
                      className="lnd-card-watch"
                      onClick={(event) => openCatalogVideoFromCard(event, item)}
                      aria-label={`${item.playerPlayable ? "Watch" : "Open"} ${item.title}`}
                    >
                      {item.playerPlayable ? "Watch" : "Open"}
                    </button>
                  </div>
                </div>
              </article>
            ))}

            {carouselVideos.length === 1 ? (
              <article className="lnd-universe-card muted">
                <div>
                  <span>Catalogue</span>
                  <strong>More videos appear here after upload.</strong>
                </div>
                <div className="lnd-universe-metric">
                  <strong>+</strong>
                  <span>add from admin</span>
                </div>
              </article>
            ) : null}
          </div>
        </section>

      </main>
    </div>
  );
}
