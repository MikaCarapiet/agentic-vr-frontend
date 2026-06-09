import { resolveBackendAssetUrl, type VideoAsset } from "./sceneverseApi";

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
};

function getPlayableCandidate(asset: VideoAsset) {
  if (asset.status !== "ready") return null;

  if (asset.playbackUrl) return asset.playbackUrl;
  if (asset.sourceType === "external_url") return asset.originalUrl;

  return null;
}

export function catalogVideoFromAsset(asset: VideoAsset): CatalogVideo | null {
  const playbackCandidate = getPlayableCandidate(asset);
  if (!playbackCandidate) return null;

  if (asset.sourceType === "upload" && asset.fileSizeBytes !== null && asset.fileSizeBytes < 1024) {
    return null;
  }

  const playbackUrl = resolveBackendAssetUrl(playbackCandidate);
  if (!playbackUrl) return null;

  const createdYear = asset.createdAt ? new Date(asset.createdAt).getFullYear() : new Date().getFullYear();
  const title = asset.title?.trim() || asset.originalFilename?.trim() || "Untitled Scene";
  const sourceLabel =
    asset.sourceType === "upload"
      ? asset.storageBackend === "s3"
        ? "S3 upload"
        : "Uploaded video"
      : "External video";

  return {
    id: asset.videoId,
    title,
    tagline: "Open the scene, talk to Vera, and branch the story from the current frame.",
    genre: asset.sourceType === "upload" ? "Uploaded · Interactive Scene" : "Linked · Interactive Scene",
    badge: `${sourceLabel} · Ready`,
    duration: asset.fileSizeBytes ? `${Math.max(1, Math.round(asset.fileSizeBytes / 1024 / 1024))} MB` : "Ready",
    year: Number.isFinite(createdYear) ? String(createdYear) : "2026",
    agents: ["Vera", "Director", "Scene agent"],
    playbackUrl,
    sourceLabel,
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

  return [FALLBACK_CATALOG_VIDEO, ...backendVideos].slice(0, 8);
}

