import React, { useMemo, useState } from "react";
import TopNavActions from "./TopNavActions";
import { type CatalogVideo, type CatalogVideoSourceKind } from "./videoCatalog";
import { useVideoThumbnail } from "./useVideoThumbnail";
import "./movieCatalog.css";

type Props = {
  videos: CatalogVideo[];
  isLoading?: boolean;
  onOpenVideo: (videoId: string) => void;
  onGoHome: () => void;
  onOpenAdmin: () => void;
};

type SourceFilter = "all" | CatalogVideoSourceKind;
type SortOption = "newest" | "oldest" | "title";

function CatalogCard({
  video,
  onOpenVideo,
}: {
  video: CatalogVideo;
  onOpenVideo: (videoId: string) => void;
}) {
  const generatedThumbnail = useVideoThumbnail(video.thumbnailUrl ? "" : video.playbackUrl, 2);
  const thumbnail = video.thumbnailUrl ?? generatedThumbnail;

  function handleWatch() {
    onOpenVideo(video.id);
  }

  return (
    <article className="cat-card" data-video-id={video.id}>
      <div className="cat-card-media">
        {thumbnail ? (
          <img src={thumbnail} alt={video.title} draggable={false} loading="lazy" />
        ) : (
          <div className="cat-card-fallback" aria-hidden="true" />
        )}
      </div>
      <div className="cat-card-body">
        <span className="cat-card-meta">
          {video.year} · {video.sourceLabel}
        </span>
        <strong className="cat-card-title">{video.title}</strong>
        <p className="cat-card-tagline">{video.tagline}</p>
        <div className="cat-card-footer">
          <span className="cat-card-genre">{video.genre}</span>
          <button className="cat-card-watch" type="button" onClick={handleWatch}>
            Watch
          </button>
        </div>
      </div>
    </article>
  );
}

export default function MovieCatalogPage({ videos, isLoading = false, onOpenVideo, onGoHome, onOpenAdmin }: Props) {
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [sortBy, setSortBy] = useState<SortOption>("newest");

  const yearOptions = useMemo(() => {
    const years = new Set(videos.map((video) => video.year).filter(Boolean));
    return [...years].sort((a, b) => Number(b) - Number(a));
  }, [videos]);

  const filteredVideos = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    const matches = videos.filter((video) => {
      if (sourceFilter !== "all" && video.sourceKind !== sourceFilter) return false;
      if (yearFilter !== "all" && video.year !== yearFilter) return false;
      if (!normalizedQuery) return true;

      const haystack = [video.title, video.tagline, video.genre, video.sourceLabel, video.badge]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });

    return [...matches].sort((left, right) => {
      if (sortBy === "title") {
        return left.title.localeCompare(right.title);
      }

      const leftYear = Number(left.year) || 0;
      const rightYear = Number(right.year) || 0;
      return sortBy === "newest" ? rightYear - leftYear : leftYear - rightYear;
    });
  }, [videos, query, sourceFilter, yearFilter, sortBy]);

  return (
    <div className="movie-catalog">
      <nav className="cat-nav" aria-label="Vera navigation">
        <button className="cat-nav-brand" type="button" onClick={onGoHome}>
          <img className="cat-brand-logo" src="/readme-assets/brand/vera-logo.png" alt="Vera" />
        </button>
        <TopNavActions onBrowseAll={onGoHome} onOpenAdmin={onOpenAdmin} activePage="browse" />
      </nav>

      <main className="cat-main">
        <header className="cat-header">
          <div>
            <button className="cat-back" type="button" onClick={onGoHome}>
              Back to home
            </button>
            <h1>Browse all titles</h1>
            <p>Every scene in the public catalogue. Filter by source, year, or search by title.</p>
          </div>
          <div className="cat-count" aria-live="polite">
            <strong>{filteredVideos.length}</strong>
            <span>{filteredVideos.length === 1 ? "title" : "titles"}</span>
          </div>
        </header>

        <section className="cat-filters" aria-label="Catalog filters">
          <label className="cat-search">
            <span className="sr-only">Search catalog</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search titles, genres, sources..."
            />
          </label>

          <div className="cat-filter-row">
            <label className="cat-filter">
              <span>Source</span>
              <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as SourceFilter)}>
                <option value="all">All sources</option>
                <option value="interactive">Interactive scenes</option>
                <option value="linked">Linked references</option>
                <option value="demo">Featured demos</option>
              </select>
            </label>

            <label className="cat-filter">
              <span>Year</span>
              <select value={yearFilter} onChange={(event) => setYearFilter(event.target.value)}>
                <option value="all">All years</option>
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>

            <label className="cat-filter">
              <span>Sort</span>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortOption)}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="title">Title A–Z</option>
              </select>
            </label>
          </div>
        </section>

        {isLoading ? (
          <div className="cat-status" aria-live="polite">
            <span className="cat-loading-pill">Syncing catalogue</span>
          </div>
        ) : null}

        {filteredVideos.length ? (
          <section className="cat-grid" aria-label="Catalog results">
            {filteredVideos.map((video) => (
              <CatalogCard key={video.id} video={video} onOpenVideo={onOpenVideo} />
            ))}
          </section>
        ) : (
          <div className="cat-empty" aria-live="polite">
            <strong>No matches found</strong>
            <p>Try clearing filters or searching with a broader keyword.</p>
          </div>
        )}
      </main>
    </div>
  );
}
