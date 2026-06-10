import React, { useEffect, useMemo, useState } from "react";
import TopNavActions from "./TopNavActions";
import { FALLBACK_CATALOG_VIDEO, type CatalogVideo } from "./videoCatalog";
import { useVideoThumbnail } from "./useVideoThumbnail";
import "./landing.css";

type Props = {
  videos: CatalogVideo[];
  isLoading?: boolean;
  onOpenVideo: (videoId: string) => void;
  onOpenCatalog: () => void;
  onOpenAdmin: () => void;
};

const CAROUSEL_INTERVAL_MS = 4000;

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

export default function Landing({ videos, isLoading = false, onOpenVideo, onOpenCatalog, onOpenAdmin }: Props) {
  const playableVideos = videos.filter((v) => v.playerPlayable);
  const carouselVideos = playableVideos.length ? playableVideos : [FALLBACK_CATALOG_VIDEO];
  const allVideos = videos.length > 1 ? videos : [FALLBACK_CATALOG_VIDEO];
  const [featuredIndex, setFeaturedIndex] = useState(() => randomVideoIndex(carouselVideos.length));
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

  function openFeaturedVideo() {
    openCatalogVideo(featuredVideo);
  }

  function featureVideo(videoId: string) {
    const nextIndex = carouselVideos.findIndex((video) => video.id === videoId);
    if (nextIndex >= 0) setFeaturedIndex(nextIndex);
  }

  function previewCardFromKeyboard(event: React.KeyboardEvent<HTMLElement>, videoId: string) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    featureVideo(videoId);
  }

  function openCatalogVideo(video: CatalogVideo) {
    onOpenVideo(video.id);
  }

  function openCatalogVideoFromCard(event: React.MouseEvent<HTMLButtonElement>, video: CatalogVideo) {
    event.stopPropagation();
    openCatalogVideo(video);
  }

  return (
    <div className="landing">
      <nav className="lnd-nav" aria-label="Vera navigation">
        <div className="lnd-nav-brand">
          <span className="lnd-logo-mark" aria-hidden="true" />
          <strong>Vera</strong>
        </div>
        <TopNavActions onBrowseAll={onOpenCatalog} onOpenAdmin={onOpenAdmin} />
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
                Watch
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
              <button className="lnd-view-all" type="button" onClick={onOpenCatalog}>
                View all
              </button>
            </div>
          </div>

          <div className="lnd-universe-row" key={`row-${featuredVideo.id}`}>
            {allVideos.filter((v) => v.id !== featuredVideo.id).slice(0, 3).map((item) => (
              <article
                className="lnd-universe-card is-clickable"
                key={item.id}
                data-video-id={item.id}
                role="button"
                tabIndex={0}
                onClick={() => openCatalogVideo(item)}
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
                      className="lnd-card-watch"
                      onClick={(event) => { event.stopPropagation(); openCatalogVideo(item); }}
                      aria-label={`Watch ${item.title}`}
                    >
                      Watch
                    </button>
                  </div>
                </div>
              </article>
            ))}

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
                    aria-label={`Watch ${featuredVideo.title}`}
                  >
                    Watch
                  </button>
                </div>
              </div>
            </article>

            {videos.length <= 1 ? (
              <article className="lnd-universe-card muted">
                <div>
                  <span>Catalogue</span>
                  <strong>More videos appear here after upload.</strong>
                </div>
                <div className="lnd-universe-metric">
                  <strong>+</strong>
                  <span>add from settings</span>
                </div>
              </article>
            ) : null}
          </div>
        </section>

      </main>
    </div>
  );
}
