import React, { useEffect, useMemo, useState } from "react";
import {
  createVideoLink,
  deleteVideo,
  getDatabaseHealth,
  listVideos,
  resolveBackendAssetUrl,
  updateVideo,
  uploadVideo,
  uploadVideoThumbnail,
  type DatabaseHealthResponse,
  type VideoAsset,
} from "./sceneverseApi";
import "./adminVideos.css";

type Props = {
  onOpenVideo: (videoId: string) => void;
};

type VideoDraft = {
  title: string;
  description: string;
  thumbnailUrl: string;
  status: string;
};

type PreviewSource =
  | {
      kind: "video";
      label: string;
      src: string;
      openUrl: string;
    }
  | {
      kind: "youtube";
      label: string;
      embedUrl: string;
      openUrl: string;
    }
  | {
      kind: "external";
      label: string;
      openUrl: string;
    }
  | {
      kind: "none";
      label: string;
    };

const SOURCE_LABELS: Record<VideoAsset["sourceType"], string> = {
  upload: "Upload",
  external_url: "External URL",
  youtube: "YouTube",
};
const STATUS_OPTIONS = ["ready", "draft", "archived"];

const VIDEO_FILE_PATTERN = /\.(mp4|m4v|mov|webm|mkv)(?:[?#].*)?$/i;
const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{6,}$/;
const MIN_PLAYABLE_VIDEO_BYTES = 1024;

function draftFromVideo(video: VideoAsset): VideoDraft {
  return {
    title: video.title ?? "",
    description: video.description ?? "",
    thumbnailUrl: video.thumbnailUrl ?? "",
    status: video.status,
  };
}

function formatBytes(value: number | null) {
  if (!value) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function videoPath(videoId: string) {
  return `/video/${encodeURIComponent(videoId)}`;
}

function getVideoTitle(video: VideoAsset) {
  return video.title?.trim() || video.originalFilename?.trim() || video.videoId;
}

function getSourceLabel(sourceType: VideoAsset["sourceType"]) {
  return SOURCE_LABELS[sourceType];
}

function getSourceLines(video: VideoAsset) {
  const originalUrl = video.originalUrl?.trim();
  const playbackUrl = video.playbackUrl?.trim();
  const lines: Array<{ label: string; value: string; href?: string }> = [];

  if (originalUrl) {
    lines.push({
      label: video.sourceType === "youtube" ? "YouTube URL" : "Source URL",
      value: originalUrl,
      href: originalUrl,
    });
  }

  if (playbackUrl && normalizeVideoReference(playbackUrl) !== normalizeVideoReference(originalUrl)) {
    lines.push({
      label: video.sourceType === "upload" ? "Media URI" : "Playback URI",
      value: playbackUrl,
      href: resolveBackendAssetUrl(playbackUrl) ?? playbackUrl,
    });
  }

  if (!lines.length) {
    lines.push({
      label: "Source",
      value: "No source captured",
    });
  }

  return lines;
}

function getThumbnailPreviewUrl(value: string | null | undefined) {
  return resolveBackendAssetUrl(value?.trim()) ?? null;
}

function getDatabaseContext(dbHealth: DatabaseHealthResponse | null) {
  if (!dbHealth) {
    return {
      label: "Unknown store",
      detail: "DB health endpoint unavailable.",
      warning: null,
    };
  }

  const environment = dbHealth.environment ?? "active backend";
  return {
    label: `${dbHealth.database} · ${environment}${dbHealth.schemaRevision ? ` · ${dbHealth.schemaRevision}` : ""}`,
    detail: dbHealth.databasePath ?? `${dbHealth.engine} backend`,
    warning:
      dbHealth.database === "sqlite"
        ? "SQLite is tied to this backend target. Cloud and local dev will diverge unless DATABASE_URL points at the same managed store."
        : null,
  };
}

function normalizeQuery(searchParams: URLSearchParams) {
  return Array.from(searchParams.entries())
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      `${leftKey}=${leftValue}`.localeCompare(`${rightKey}=${rightValue}`),
    )
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function getYouTubeVideoId(value: string | null | undefined) {
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
      if (url.pathname === "/watch") {
        return url.searchParams.get("v");
      }

      const parts = url.pathname.split("/").filter(Boolean);
      const marker = parts.findIndex((part) => ["embed", "shorts", "live"].includes(part));
      if (marker >= 0) return parts[marker + 1] ?? null;
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeVideoReference(value: string | null | undefined) {
  const text = value?.trim();
  if (!text) return null;

  const youtubeVideoId = getYouTubeVideoId(text);
  if (youtubeVideoId) return `youtube:${youtubeVideoId}`;

  try {
    const url = new URL(text);
    const path = url.pathname.replace(/\/+$/, "") || url.pathname;
    const query = normalizeQuery(url.searchParams);
    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${path}${query ? `?${query}` : ""}`;
  } catch {
    const [withoutHash] = text.split("#");
    const [pathPart, queryPart = ""] = withoutHash.split("?");
    const normalizedPath = pathPart.replace(/\/+$/, "") || pathPart;
    const query = normalizeQuery(new URLSearchParams(queryPart));
    return `${normalizedPath}${query ? `?${query}` : ""}`;
  }
}

function findDuplicateVideoReference(videos: VideoAsset[], reference: string | null | undefined, excludeVideoId?: string) {
  const normalizedReference = normalizeVideoReference(reference);
  if (!normalizedReference) return null;

  return (
    videos.find((video) => {
      if (video.videoId === excludeVideoId) return false;
      return [video.originalUrl, video.playbackUrl, video.storageKey].some(
        (candidate) => normalizeVideoReference(candidate) === normalizedReference,
      );
    }) ?? null
  );
}

function getDuplicateIssue(videos: VideoAsset[], video: VideoAsset) {
  const duplicateOriginalUrl = findDuplicateVideoReference(videos, video.originalUrl, video.videoId);
  if (duplicateOriginalUrl) {
    return {
      label: "duplicate URL",
      detail: `Original URL matches ${duplicateOriginalUrl.videoId}`,
    };
  }

  const duplicatePlaybackUrl = findDuplicateVideoReference(videos, video.playbackUrl, video.videoId);
  if (duplicatePlaybackUrl) {
    return {
      label: "duplicate URI",
      detail: `Playback URI matches ${duplicatePlaybackUrl.videoId}`,
    };
  }

  return null;
}

function isUndersizedUpload(video: VideoAsset) {
  return video.sourceType === "upload" && video.fileSizeBytes !== null && video.fileSizeBytes < MIN_PLAYABLE_VIDEO_BYTES;
}

function getMediaIssue(video: VideoAsset) {
  if (!isUndersizedUpload(video)) return null;
  return "Invalid upload";
}

function getMediaIssueDetail(video: VideoAsset) {
  if (!isUndersizedUpload(video)) return null;
  return `Stored file is only ${formatBytes(video.fileSizeBytes)}. Re-upload a real video file.`;
}

function getYouTubeEmbedUrl(value: string | null | undefined) {
  const videoId = getYouTubeVideoId(value);
  if (!videoId || !YOUTUBE_ID_PATTERN.test(videoId)) return null;
  return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`;
}

function getPreviewSource(video: VideoAsset): PreviewSource {
  if (isUndersizedUpload(video)) {
    return {
      kind: "none",
      label: "Invalid upload",
    };
  }

  const playbackUrl = resolveBackendAssetUrl(video.playbackUrl);
  const originalUrl = video.originalUrl?.trim() || null;
  const youtubeEmbedUrl = getYouTubeEmbedUrl(video.playbackUrl) ?? getYouTubeEmbedUrl(video.originalUrl);

  if (youtubeEmbedUrl) {
    return {
      kind: "youtube",
      label: "YouTube embed",
      embedUrl: youtubeEmbedUrl,
      openUrl: originalUrl ?? playbackUrl ?? youtubeEmbedUrl,
    };
  }

  if (playbackUrl) {
    return {
      kind: "video",
      label: video.sourceType === "upload" ? "Stored media" : "Playback URL",
      src: playbackUrl,
      openUrl: playbackUrl,
    };
  }

  if (originalUrl && (video.sourceType === "upload" || VIDEO_FILE_PATTERN.test(originalUrl))) {
    const resolvedOriginalUrl = resolveBackendAssetUrl(originalUrl);
    if (resolvedOriginalUrl) {
      return {
        kind: "video",
        label: "Original media URL",
        src: resolvedOriginalUrl,
        openUrl: resolvedOriginalUrl,
      };
    }
  }

  if (originalUrl) {
    return {
      kind: "external",
      label: "External source",
      openUrl: originalUrl,
    };
  }

  return {
    kind: "none",
    label: "No preview URL",
  };
}

function canOpenInPlayer(video: VideoAsset) {
  if (video.status !== "ready") return false;
  if (video.sourceType === "upload") {
    return Boolean(video.playbackUrl && (!video.fileSizeBytes || video.fileSizeBytes >= MIN_PLAYABLE_VIDEO_BYTES));
  }
  return Boolean(video.playbackUrl || (video.sourceType === "external_url" && video.originalUrl));
}

function canPreviewVideo(video: VideoAsset) {
  return getPreviewSource(video).kind !== "none";
}

export default function AdminVideosPage({ onOpenVideo }: Props) {
  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [drafts, setDrafts] = useState<Record<string, VideoDraft>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("Loading backend video catalogue...");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkDescription, setLinkDescription] = useState("");
  const [linkThumbnailUrl, setLinkThumbnailUrl] = useState("");
  const [linkThumbnailFile, setLinkThumbnailFile] = useState<File | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkSourceType, setLinkSourceType] = useState<"youtube" | "external_url">("external_url");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadThumbnailUrl, setUploadThumbnailUrl] = useState("");
  const [uploadThumbnailFile, setUploadThumbnailFile] = useState<File | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [thumbnailFiles, setThumbnailFiles] = useState<Record<string, File | null>>({});
  const [previewVideo, setPreviewVideo] = useState<VideoAsset | null>(null);
  const [dbHealth, setDbHealth] = useState<DatabaseHealthResponse | null>(null);

  const stats = useMemo(() => {
    const ready = videos.filter((video) => video.status === "ready").length;
    const uploads = videos.filter((video) => video.sourceType === "upload").length;
    const previewable = videos.filter(canPreviewVideo).length;
    return { ready, uploads, previewable, total: videos.length };
  }, [videos]);

  const activePreview = previewVideo ? getPreviewSource(previewVideo) : null;
  const dbContext = getDatabaseContext(dbHealth);

  function upsertVideo(video: VideoAsset) {
    setVideos((current) => [video, ...current.filter((item) => item.videoId !== video.videoId)]);
    setDrafts((current) => ({ ...current, [video.videoId]: draftFromVideo(video) }));
  }

  async function refreshVideos(
    nextMessage = "Catalogue synced.",
    options: { keepExistingOnFailure?: boolean; failureMessage?: string } = {},
  ) {
    setIsLoading(true);
    const [response, health] = await Promise.all([listVideos(100), getDatabaseHealth()]);
    const nextVideos = response?.items ?? [];
    if (response) {
      setVideos(nextVideos);
      setDrafts(Object.fromEntries(nextVideos.map((video) => [video.videoId, draftFromVideo(video)])));
      setMessage(nextMessage);
    } else if (!options.keepExistingOnFailure) {
      setVideos([]);
      setDrafts({});
      setMessage(options.failureMessage ?? "Backend video catalogue unavailable.");
    } else {
      setMessage(options.failureMessage ?? "Catalogue refresh is still syncing. Latest saved changes remain visible.");
    }
    setDbHealth(health);
    setIsLoading(false);
  }

  useEffect(() => {
    void refreshVideos();
  }, []);

  useEffect(() => {
    if (!previewVideo) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setPreviewVideo(null);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewVideo]);

  function updateDraft(videoId: string, patch: Partial<VideoDraft>) {
    setDrafts((current) => ({
      ...current,
      [videoId]: {
        ...current[videoId],
        ...patch,
      },
    }));
  }

  function updateThumbnailFile(videoId: string, file: File | null) {
    setThumbnailFiles((current) => ({ ...current, [videoId]: file }));
  }

  async function handleCreateLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!linkUrl.trim()) {
      setMessage("Add a URL before creating a linked video.");
      return;
    }

    const duplicate = findDuplicateVideoReference(videos, linkUrl);
    if (duplicate) {
      setMessage(`Duplicate URL blocked. Existing record: ${duplicate.videoId}.`);
      return;
    }

    setBusyId("create-link");
    const created = await createVideoLink({
      url: linkUrl.trim(),
      title: linkTitle.trim() || undefined,
      description: linkDescription.trim() || undefined,
      thumbnailUrl: linkThumbnailUrl.trim() || undefined,
      sourceType: linkSourceType,
    });
    if (!created) {
      setBusyId(null);
      setMessage("Could not create linked video.");
      return;
    }

    const savedVideo = linkThumbnailFile ? await uploadVideoThumbnail(created.videoId, linkThumbnailFile) : created;
    setBusyId(null);
    if (!savedVideo) {
      upsertVideo(created);
      setMessage(`Created ${getVideoTitle(created)}, but thumbnail upload failed.`);
      return;
    }

    setLinkTitle("");
    setLinkDescription("");
    setLinkThumbnailUrl("");
    setLinkThumbnailFile(null);
    setLinkUrl("");
    form.reset();
    upsertVideo(savedVideo);
    const successMessage = `Created ${getVideoTitle(savedVideo)}.`;
    setMessage(successMessage);
    void refreshVideos(successMessage, {
      keepExistingOnFailure: true,
      failureMessage: `${successMessage} Catalogue refresh is still syncing.`,
    });
  }

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!uploadFile) {
      setMessage("Choose a video file before uploading.");
      return;
    }

    if (uploadFile.size < MIN_PLAYABLE_VIDEO_BYTES) {
      setMessage(`${uploadFile.name} is only ${formatBytes(uploadFile.size)}. Choose a real video file before uploading.`);
      return;
    }

    setBusyId("upload");
    setMessage(`Uploading ${uploadFile.name}...`);
    const uploaded = await uploadVideo(uploadFile, uploadTitle, uploadDescription, uploadThumbnailUrl, uploadThumbnailFile);
    setBusyId(null);
    if (!uploaded) {
      setMessage("Could not upload video.");
      return;
    }

    setUploadTitle("");
    setUploadDescription("");
    setUploadThumbnailUrl("");
    setUploadThumbnailFile(null);
    setUploadFile(null);
    form.reset();
    upsertVideo(uploaded);
    const successMessage = `Uploaded ${getVideoTitle(uploaded)}.`;
    setMessage(successMessage);
    void refreshVideos(successMessage, {
      keepExistingOnFailure: true,
      failureMessage: `${successMessage} Catalogue refresh is still syncing.`,
    });
  }

  async function handleSave(video: VideoAsset) {
    const draft = drafts[video.videoId];
    if (!draft) return;

    setBusyId(video.videoId);
    const updated = await updateVideo(video.videoId, {
      title: draft.title,
      description: draft.description,
      thumbnailUrl: draft.thumbnailUrl,
      status: draft.status,
    });
    setBusyId(null);
    if (!updated) {
      setMessage(`Could not update ${video.videoId}.`);
      return;
    }

    setVideos((current) => current.map((item) => (item.videoId === updated.videoId ? updated : item)));
    setDrafts((current) => ({ ...current, [updated.videoId]: draftFromVideo(updated) }));
    setMessage(`Updated ${updated.videoId}.`);
  }

  async function handleThumbnailUpload(video: VideoAsset) {
    const file = thumbnailFiles[video.videoId];
    if (!file) {
      setMessage(`Choose a thumbnail image for ${video.videoId}.`);
      return;
    }

    setBusyId(`thumbnail-${video.videoId}`);
    setMessage(`Uploading thumbnail for ${getVideoTitle(video)}...`);
    const updated = await uploadVideoThumbnail(video.videoId, file);
    setBusyId(null);
    if (!updated) {
      setMessage(`Could not upload thumbnail for ${video.videoId}.`);
      return;
    }

    setVideos((current) => current.map((item) => (item.videoId === updated.videoId ? updated : item)));
    setDrafts((current) => ({ ...current, [updated.videoId]: draftFromVideo(updated) }));
    setThumbnailFiles((current) => ({ ...current, [updated.videoId]: null }));
    setMessage(`Uploaded thumbnail for ${updated.videoId}.`);
  }

  async function handleDelete(video: VideoAsset) {
    const label = video.title || video.originalFilename || video.videoId;
    if (!window.confirm(`Delete ${label} from the catalogue? This removes the DB record, not stored media files.`)) {
      return;
    }

    setBusyId(video.videoId);
    const deleted = await deleteVideo(video.videoId);
    setBusyId(null);
    if (!deleted?.deleted) {
      setMessage(`Could not delete ${video.videoId}.`);
      return;
    }

    setVideos((current) => current.filter((item) => item.videoId !== video.videoId));
    setDrafts((current) => {
      const next = { ...current };
      delete next[video.videoId];
      return next;
    });
    setMessage(`Deleted ${video.videoId} from the catalogue.`);
  }

  return (
    <main className="admin-videos">
      <header className="admin-header">
        <div className="admin-header-copy">
          <div className="admin-navline">
            <a className="admin-back" href="/videos">Public catalogue</a>
            <span className="admin-kicker">Catalogue Ops</span>
            <span className="admin-live-pill">{isLoading ? "Syncing backend" : "Catalogue live"}</span>
          </div>
          <h1>Video Admin</h1>
          <p>
            Add, edit, and remove video catalogue records. This MVP admin surface is operational,
            but it still needs a real auth layer before production exposure.
          </p>
        </div>
        <aside className="admin-command-panel" aria-label="Backend sync status">
          <span>Backend state</span>
          <strong>{isLoading ? "Syncing records" : "Records synced"}</strong>
          <p>{message}</p>
          <div className="admin-db-context">
            <span>Metadata store</span>
            <strong>{dbContext.label}</strong>
            <p>{dbContext.detail}</p>
            {dbContext.warning ? <small>{dbContext.warning}</small> : null}
          </div>
          <button className="admin-refresh" onClick={() => refreshVideos()} disabled={isLoading}>
            {isLoading ? "Syncing..." : "Refresh"}
          </button>
        </aside>
      </header>

      <section className="admin-stats" aria-label="Video catalogue stats">
        <article>
          <span>Total records</span>
          <strong>{stats.total}</strong>
          <small>Catalogue rows</small>
        </article>
        <article>
          <span>Ready</span>
          <strong>{stats.ready}</strong>
          <small>Available records</small>
        </article>
        <article>
          <span>Uploads</span>
          <strong>{stats.uploads}</strong>
          <small>Stored media</small>
        </article>
        <article>
          <span>Previewable</span>
          <strong>{stats.previewable}</strong>
          <small>Has preview source</small>
        </article>
      </section>

      <section className="admin-create-grid" aria-label="Add videos">
        <form className="admin-card" onSubmit={handleCreateLink}>
          <div className="admin-card-heading">
            <span>Link a video</span>
            <strong>External URL</strong>
            <p>Register a hosted video or YouTube source without uploading media.</p>
          </div>
          <div className="admin-field-grid">
            <label>
              Title
              <input value={linkTitle} onChange={(event) => setLinkTitle(event.target.value)} placeholder="Scene title" />
            </label>
            <label>
              Source type
              <select
                value={linkSourceType}
                onChange={(event) => setLinkSourceType(event.target.value as "youtube" | "external_url")}
              >
                <option value="external_url">External URL</option>
                <option value="youtube">YouTube reference</option>
              </select>
            </label>
          </div>
          <label>
            URL
            <input
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
              placeholder="https://..."
              required
            />
          </label>
          <label>
            Thumbnail override URL
            <input
              value={linkThumbnailUrl}
              onChange={(event) => setLinkThumbnailUrl(event.target.value)}
              placeholder="https://.../thumbnail.jpg"
            />
          </label>
          <label className="admin-file-field">
            Thumbnail image file
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => setLinkThumbnailFile(event.currentTarget.files?.[0] ?? null)}
            />
            <small>{linkThumbnailFile ? linkThumbnailFile.name : "JPG, PNG, or WebP. File wins over URL."}</small>
          </label>
          <label className="admin-description-field">
            Description
            <textarea
              value={linkDescription}
              onChange={(event) => setLinkDescription(event.target.value)}
              placeholder="Short catalogue description"
              rows={3}
            />
          </label>
          <button className="admin-primary-button" type="submit" disabled={busyId === "create-link"}>
            {busyId === "create-link" ? "Creating..." : "Create link"}
          </button>
        </form>

        <form className="admin-card" onSubmit={handleUpload}>
          <div className="admin-card-heading">
            <span>Upload video</span>
            <strong>Local/S3 media</strong>
            <p>Send a source file to the configured storage backend and add it to the catalogue.</p>
          </div>
          <div className="admin-field-grid">
            <label>
              Title
              <input value={uploadTitle} onChange={(event) => setUploadTitle(event.target.value)} placeholder="Upload title" />
            </label>
            <label className="admin-file-field">
              File
              <input
                type="file"
                accept="video/*"
                onChange={(event) => setUploadFile(event.currentTarget.files?.[0] ?? null)}
                required
              />
              <small>{uploadFile ? uploadFile.name : "MP4, WebM, MOV, M4V, or MKV"}</small>
            </label>
          </div>
          <label className="admin-description-field">
            Description
            <textarea
              value={uploadDescription}
              onChange={(event) => setUploadDescription(event.target.value)}
              placeholder="Short catalogue description"
              rows={3}
            />
          </label>
          <label>
            Thumbnail override URL
            <input
              value={uploadThumbnailUrl}
              onChange={(event) => setUploadThumbnailUrl(event.target.value)}
              placeholder="https://.../thumbnail.jpg"
            />
          </label>
          <label className="admin-file-field">
            Thumbnail image file
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => setUploadThumbnailFile(event.currentTarget.files?.[0] ?? null)}
            />
            <small>{uploadThumbnailFile ? uploadThumbnailFile.name : "JPG, PNG, or WebP. File wins over URL."}</small>
          </label>
          <button className="admin-primary-button" type="submit" disabled={busyId === "upload"}>
            {busyId === "upload" ? "Uploading..." : "Upload video"}
          </button>
        </form>
      </section>

      <section className="admin-table-card">
        <div className="admin-table-header">
          <div>
            <span>Backend state</span>
            <strong>All video records</strong>
          </div>
          <p>{message}</p>
        </div>

        <div className="admin-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Video</th>
                <th>Catalogue</th>
                <th>Source</th>
                <th>Storage</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {videos.map((video) => {
                const draft = drafts[video.videoId] ?? draftFromVideo(video);
                const rowBusy = busyId === video.videoId;
                const thumbnailBusy = busyId === `thumbnail-${video.videoId}`;
                const previewAvailable = canPreviewVideo(video);
                const mediaIssue = getMediaIssue(video);
                const mediaIssueDetail = getMediaIssueDetail(video);
                const duplicateIssue = getDuplicateIssue(videos, video);
                const sourceLines = getSourceLines(video);
                const thumbnailPreviewUrl = getThumbnailPreviewUrl(draft.thumbnailUrl);
                return (
                  <tr key={video.videoId}>
                    <td>
                      <div className="admin-video-cell">
                        <code>{video.videoId}</code>
                        <span>{video.originalFilename ?? "catalogue record"}</span>
                        <span className={`admin-status-pill ${video.status === "ready" ? "ready" : ""}`}>
                          {video.status}
                        </span>
                        {mediaIssue ? <span className="admin-status-pill invalid">invalid media</span> : null}
                        {duplicateIssue ? (
                          <span className="admin-status-pill duplicate" title={duplicateIssue.detail}>
                            {duplicateIssue.label}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div className="admin-catalogue-cell">
                        <label className="admin-row-field">
                          <span>Title</span>
                          <input
                            className="admin-title-input"
                            aria-label={`Title for ${video.videoId}`}
                            value={draft.title}
                            onChange={(event) => updateDraft(video.videoId, { title: event.target.value })}
                            placeholder="Untitled"
                          />
                        </label>
                        <label className="admin-row-field">
                          <span>Description</span>
                          <textarea
                            aria-label={`Description for ${video.videoId}`}
                            value={draft.description}
                            onChange={(event) => updateDraft(video.videoId, { description: event.target.value })}
                            placeholder="Description"
                            rows={3}
                          />
                        </label>
                        <label className="admin-row-field">
                          <span>Thumbnail URL</span>
                          <input
                            aria-label={`Thumbnail URL for ${video.videoId}`}
                            value={draft.thumbnailUrl}
                            onChange={(event) => updateDraft(video.videoId, { thumbnailUrl: event.target.value })}
                            placeholder="Optional poster image URL"
                          />
                        </label>
                        <label className="admin-row-field admin-thumbnail-file-field">
                          <span>Thumbnail File</span>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            aria-label={`Thumbnail file for ${video.videoId}`}
                            onChange={(event) => updateThumbnailFile(video.videoId, event.currentTarget.files?.[0] ?? null)}
                          />
                          <small>
                            {thumbnailFiles[video.videoId]?.name ?? "Upload a JPG, PNG, or WebP override"}
                          </small>
                        </label>
                        <button
                          className="admin-thumbnail-upload-button"
                          type="button"
                          onClick={() => handleThumbnailUpload(video)}
                          disabled={thumbnailBusy || !thumbnailFiles[video.videoId]}
                        >
                          {thumbnailBusy ? "Uploading thumbnail..." : "Upload thumbnail file"}
                        </button>
                        {thumbnailPreviewUrl ? (
                          <a
                            className="admin-thumbnail-preview"
                            href={thumbnailPreviewUrl}
                            target="_blank"
                            rel="noreferrer"
                            title="Open thumbnail"
                          >
                            <img src={thumbnailPreviewUrl} alt={`Thumbnail for ${getVideoTitle(video)}`} />
                          </a>
                        ) : null}
                        <label className="admin-row-field admin-status-select">
                          <span>Status</span>
                          <select
                            aria-label={`Status for ${video.videoId}`}
                            value={draft.status}
                            onChange={(event) => updateDraft(video.videoId, { status: event.target.value })}
                          >
                            {!STATUS_OPTIONS.includes(draft.status) ? (
                              <option value={draft.status}>{draft.status}</option>
                            ) : null}
                            <option value="ready">Ready</option>
                            <option value="draft">Draft</option>
                            <option value="archived">Archived</option>
                          </select>
                        </label>
                      </div>
                    </td>
                    <td>
                      <div className="admin-source-cell">
                        <span className="admin-source-pill">{getSourceLabel(video.sourceType)}</span>
                        {sourceLines.map((line) => (
                          <div className="admin-source-line" key={`${line.label}-${line.value}`}>
                            <small>{line.label}</small>
                            {line.href ? (
                              <a href={line.href} target="_blank" rel="noreferrer" title={line.value}>
                                {line.value}
                              </a>
                            ) : (
                              <code title={line.value}>{line.value}</code>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td>
                      {video.storageBackend ? (
                        <>
                          <strong className="admin-storage-badge">{video.storageBackend}</strong>
                          <span className={mediaIssue ? "admin-media-warning" : undefined}>
                            {formatBytes(video.fileSizeBytes)}
                          </span>
                          {video.contentType ? <span>{video.contentType}</span> : null}
                        </>
                      ) : (
                        <span className="admin-storage-empty">Not stored</span>
                      )}
                      {mediaIssue ? <span className="admin-media-warning">{mediaIssue}</span> : null}
                    </td>
                    <td>
                      <time dateTime={video.createdAt}>{formatDate(video.createdAt)}</time>
                    </td>
                    <td>
                      <div className="admin-row-actions">
                        <button onClick={() => handleSave(video)} disabled={rowBusy}>
                          {rowBusy ? "Saving..." : "Save"}
                        </button>
                        <button
                          className="preview"
                          onClick={() => setPreviewVideo(video)}
                          disabled={!previewAvailable}
                          aria-label={`Preview ${getVideoTitle(video)}`}
                          title={mediaIssueDetail ?? (previewAvailable ? "Preview video" : "No preview source")}
                        >
                          Preview
                        </button>
                        <button onClick={() => onOpenVideo(video.videoId)} disabled={!canOpenInPlayer(video)}>
                          Open
                        </button>
                        <button className="danger" onClick={() => handleDelete(video)} disabled={rowBusy}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!videos.length && !isLoading ? (
                <tr>
                  <td colSpan={6} className="admin-empty">No video records yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {previewVideo && activePreview ? (
        <div
          className="admin-preview-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreviewVideo(null);
          }}
        >
          <section
            className="admin-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-preview-title"
          >
            <div className="admin-preview-head">
              <div>
                <span>Video preview</span>
                <h2 id="admin-preview-title">{getVideoTitle(previewVideo)}</h2>
                <p>
                  {previewVideo.videoId} · {getSourceLabel(previewVideo.sourceType)}
                </p>
              </div>
              <button className="admin-preview-close" onClick={() => setPreviewVideo(null)}>
                Close
              </button>
            </div>

            <div className="admin-preview-stage">
              {activePreview.kind === "video" ? (
                <video className="admin-preview-video" src={activePreview.src} controls playsInline preload="metadata" />
              ) : null}
              {activePreview.kind === "youtube" ? (
                <iframe
                  className="admin-preview-iframe"
                  title={`Preview for ${getVideoTitle(previewVideo)}`}
                  src={activePreview.embedUrl}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              ) : null}
              {activePreview.kind === "external" ? (
                <div className="admin-preview-fallback">
                  <strong>External preview</strong>
                  <p>This source cannot be embedded reliably in the admin popup.</p>
                  <a href={activePreview.openUrl} target="_blank" rel="noreferrer">
                    Open source tab
                  </a>
                </div>
              ) : null}
              {activePreview.kind === "none" ? (
                <div className="admin-preview-fallback">
                  <strong>No preview source</strong>
                  <p>This record has no playable source captured yet.</p>
                </div>
              ) : null}
            </div>

            <div className="admin-preview-meta">
              <div>
                <span>Preview source</span>
                <strong>{activePreview.label}</strong>
              </div>
              <div>
                <span>Storage</span>
                <strong>{previewVideo.storageBackend ?? "-"}</strong>
              </div>
              <div>
                <span>File size</span>
                <strong>{formatBytes(previewVideo.fileSizeBytes)}</strong>
              </div>
            </div>

            <div className="admin-preview-actions">
              {activePreview.kind !== "none" ? (
                <a className="admin-modal-link primary" href={activePreview.openUrl} target="_blank" rel="noreferrer">
                  Open preview tab
                </a>
              ) : null}
              {canOpenInPlayer(previewVideo) ? (
                <a className="admin-modal-link" href={videoPath(previewVideo.videoId)} target="_blank" rel="noreferrer">
                  Open player tab
                </a>
              ) : null}
              <button className="admin-modal-button" onClick={() => setPreviewVideo(null)}>
                Done
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
