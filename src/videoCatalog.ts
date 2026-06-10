import { resolveBackendAssetUrl, type VideoAsset } from "./sceneverseApi";

export type CatalogVideoSourceKind = "interactive" | "linked" | "demo";
export type CatalogVideoMediaKind = "html-video" | "youtube" | "reference";

export type CatalogVideo = {
  id: string;
  title: string;
  tagline: string;
  genre: string;
  badge: string;
  duration: string;
  year: string;
  agents: string[];
  playbackUrl: string;
  sourceLabel: string;
  sourceKind: CatalogVideoSourceKind;
  mediaKind: CatalogVideoMediaKind;
  embedUrl?: string;
  thumbnailUrl?: string;
  externalUrl?: string;
  playerPlayable: boolean;
};

export const FALLBACK_CATALOG_VIDEO: CatalogVideo = {
  id: "yoda-vader-duel",
  title: "Yoda vs Vader: The Duel That Never Was",
  tagline:
    "A forbidden duel opens inside a misted timeline. Step into the frame, question the characters, and bend the next branch.",
  genre: "Action · Fantasy · AI Demo",
  badge: "Featured premiere · AI scene generated",
  duration: "3 min",
  year: "2025",
  agents: ["Yoda", "Vader", "Director"],
  playbackUrl: "/demo-duel.mp4",
  sourceLabel: "Bundled demo",
  sourceKind: "demo",
  mediaKind: "html-video",
  playerPlayable: true,
};

const VIDEO_FILE_PATTERN = /\.(mp4|m4v|mov|webm|mkv)(?:[?#].*)?$/i;

export function getYouTubeVideoId(value: string | null | undefined) {
  const text = value?.trim();
  if (!text) return null;

  try {
    const url = new URL(text);
    const hostname = url.hostname.replace(/^www\./, "").toLowerCase();

    if (hostname === "youtu.be") {
      return url.pathname.split("/").filter(Boolean)[0] ?? null;
    }

    if (
      hostname === "youtube.com" ||
      hostname.endsWith(".youtube.com") ||
      hostname === "youtube-nocookie.com" ||
      hostname.endsWith(".youtube-nocookie.com")
    ) {
      if (url.pathname === "/watch") return url.searchParams.get("v");

      const parts = url.pathname.split("/").filter(Boolean);
      const marker = parts.findIndex((part) => ["embed", "shorts", "live"].includes(part));
      if (marker >= 0) return parts[marker + 1] ?? null;
    }
  } catch {
    return null;
  }

  return null;
}

function getYouTubeThumbnailUrl(value: string | null | undefined) {
  const videoId = getYouTubeVideoId(value);
  return videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : undefined;
}

export function getYouTubeEmbedUrl(value: string | null | undefined) {
  const videoId = getYouTubeVideoId(value);
  if (!videoId) return undefined;

  const params = new URLSearchParams({
    enablejsapi: "1",
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
  });
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
}

function getSourceCandidate(asset: VideoAsset) {
  if (asset.status !== "ready") return null;

  if (asset.playbackUrl) return asset.playbackUrl;
  if (asset.sourceType === "external_url" || asset.sourceType === "youtube") return asset.originalUrl;

  return null;
}

export function catalogVideoFromAsset(asset: VideoAsset): CatalogVideo | null {
  const sourceCandidate = getSourceCandidate(asset);
  if (!sourceCandidate) return null;

  if (asset.sourceType === "upload" && asset.fileSizeBytes !== null && asset.fileSizeBytes < 1024) {
    return null;
  }

  const resolvedSourceUrl = resolveBackendAssetUrl(sourceCandidate);
  if (!resolvedSourceUrl) return null;

  const playerPlayable =
    asset.sourceType === "upload" ||
    Boolean(asset.playbackUrl) ||
    (asset.sourceType === "external_url" && VIDEO_FILE_PATTERN.test(sourceCandidate));

  const createdYear = asset.createdAt ? new Date(asset.createdAt).getFullYear() : new Date().getFullYear();
  const title = asset.title?.trim() || asset.originalFilename?.trim() || "Untitled Scene";
  const sourceLabel =
    asset.sourceType === "upload"
      ? asset.storageBackend === "s3"
        ? "S3 upload"
        : "Uploaded video"
      : asset.sourceType === "youtube"
        ? "YouTube"
        : "External video";

  const thumbnailOverride = resolveBackendAssetUrl(asset.thumbnailUrl) ?? undefined;
  const youtubeEmbedUrl = getYouTubeEmbedUrl(asset.playbackUrl) ?? getYouTubeEmbedUrl(asset.originalUrl);
  const mediaKind: CatalogVideoMediaKind = playerPlayable
    ? "html-video"
    : youtubeEmbedUrl
      ? "youtube"
      : "reference";

  return {
    id: asset.videoId,
    title,
    tagline:
      asset.description?.trim() ||
      (playerPlayable
        ? "Open the scene, talk to Vera, and branch the story from the current frame."
        : "Open the source reference from the catalogue and keep it available for review."),
    genre: asset.sourceType === "upload" ? "Uploaded · Interactive Scene" : "Linked · Reference Scene",
    badge: `${sourceLabel} · Ready`,
    duration: asset.fileSizeBytes ? `${Math.max(1, Math.round(asset.fileSizeBytes / 1024 / 1024))} MB` : "Ready",
    year: Number.isFinite(createdYear) ? String(createdYear) : "2026",
    agents: ["Vera", "Director", "Scene agent"],
    playbackUrl: playerPlayable ? resolvedSourceUrl : FALLBACK_CATALOG_VIDEO.playbackUrl,
    sourceLabel,
    mediaKind,
    embedUrl: youtubeEmbedUrl,
    thumbnailUrl: thumbnailOverride ?? getYouTubeThumbnailUrl(asset.originalUrl) ?? getYouTubeThumbnailUrl(asset.playbackUrl),
    externalUrl: playerPlayable ? undefined : resolvedSourceUrl,
    sourceKind: playerPlayable ? "interactive" : "linked",
    playerPlayable: playerPlayable || Boolean(youtubeEmbedUrl),
  };
}

export function buildCatalogVideos(assets: VideoAsset[]): CatalogVideo[] {
  const seen = new Set([FALLBACK_CATALOG_VIDEO.id]);
  const backendVideos = assets.flatMap((asset) => {
    const video = catalogVideoFromAsset(asset);
    if (!video || seen.has(video.id)) return [];

    seen.add(video.id);
    return [video];
  });

  return [FALLBACK_CATALOG_VIDEO, ...backendVideos];
}
