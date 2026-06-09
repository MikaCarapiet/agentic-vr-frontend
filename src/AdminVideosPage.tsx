import React, { useEffect, useMemo, useState } from "react";
import {
  createVideoLink,
  deleteVideo,
  listVideos,
  updateVideo,
  uploadVideo,
  type VideoAsset,
} from "./sceneverseApi";
import "./adminVideos.css";

type Props = {
  onOpenVideo: (videoId: string) => void;
};

type VideoDraft = {
  title: string;
  sourceType: VideoAsset["sourceType"];
  originalUrl: string;
  playbackUrl: string;
  status: string;
};

function draftFromVideo(video: VideoAsset): VideoDraft {
  return {
    title: video.title ?? "",
    sourceType: video.sourceType,
    originalUrl: video.originalUrl ?? "",
    playbackUrl: video.playbackUrl ?? "",
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

function canOpenInPlayer(video: VideoAsset) {
  if (video.status !== "ready") return false;
  if (video.sourceType === "upload") {
    return Boolean(video.playbackUrl && (!video.fileSizeBytes || video.fileSizeBytes >= 1024));
  }
  return Boolean(video.playbackUrl || (video.sourceType === "external_url" && video.originalUrl));
}

export default function AdminVideosPage({ onOpenVideo }: Props) {
  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [drafts, setDrafts] = useState<Record<string, VideoDraft>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("Loading backend video catalogue...");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkSourceType, setLinkSourceType] = useState<"youtube" | "external_url">("external_url");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const stats = useMemo(() => {
    const ready = videos.filter((video) => video.status === "ready").length;
    const uploads = videos.filter((video) => video.sourceType === "upload").length;
    const playable = videos.filter(canOpenInPlayer).length;
    return { ready, uploads, playable, total: videos.length };
  }, [videos]);

  async function refreshVideos(nextMessage = "Catalogue synced.") {
    setIsLoading(true);
    const response = await listVideos(100);
    const nextVideos = response?.items ?? [];
    setVideos(nextVideos);
    setDrafts(Object.fromEntries(nextVideos.map((video) => [video.videoId, draftFromVideo(video)])));
    setMessage(response ? nextMessage : "Backend video catalogue unavailable.");
    setIsLoading(false);
  }

  useEffect(() => {
    void refreshVideos();
  }, []);

  function updateDraft(videoId: string, patch: Partial<VideoDraft>) {
    setDrafts((current) => ({
      ...current,
      [videoId]: {
        ...current[videoId],
        ...patch,
      },
    }));
  }

  async function handleCreateLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!linkUrl.trim()) {
      setMessage("Add a URL before creating a linked video.");
      return;
    }

    setBusyId("create-link");
    const created = await createVideoLink({
      url: linkUrl.trim(),
      title: linkTitle.trim() || undefined,
      sourceType: linkSourceType,
    });
    setBusyId(null);
    if (!created) {
      setMessage("Could not create linked video.");
      return;
    }

    setLinkTitle("");
    setLinkUrl("");
    await refreshVideos(`Created linked video ${created.videoId}.`);
  }

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!uploadFile) {
      setMessage("Choose a video file before uploading.");
      return;
    }

    setBusyId("upload");
    const uploaded = await uploadVideo(uploadFile, uploadTitle);
    setBusyId(null);
    if (!uploaded) {
      setMessage("Could not upload video.");
      return;
    }

    setUploadTitle("");
    setUploadFile(null);
    event.currentTarget.reset();
    await refreshVideos(`Uploaded video ${uploaded.videoId}.`);
  }

  async function handleSave(video: VideoAsset) {
    const draft = drafts[video.videoId];
    if (!draft) return;

    setBusyId(video.videoId);
    const updated = await updateVideo(video.videoId, {
      title: draft.title,
      sourceType: draft.sourceType,
      originalUrl: draft.originalUrl,
      playbackUrl: draft.playbackUrl,
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
        <div>
          <a className="admin-back" href="/videos">Public catalogue</a>
          <span className="admin-kicker">Catalogue Ops</span>
          <h1>Video Admin</h1>
          <p>
            Add, edit, and remove video catalogue records. This MVP admin surface is operational,
            but it still needs a real auth layer before production exposure.
          </p>
        </div>
        <button className="admin-refresh" onClick={() => refreshVideos()} disabled={isLoading}>
          {isLoading ? "Syncing..." : "Refresh"}
        </button>
      </header>

      <section className="admin-stats" aria-label="Video catalogue stats">
        <article>
          <span>Total records</span>
          <strong>{stats.total}</strong>
        </article>
        <article>
          <span>Ready</span>
          <strong>{stats.ready}</strong>
        </article>
        <article>
          <span>Uploads</span>
          <strong>{stats.uploads}</strong>
        </article>
        <article>
          <span>Playable</span>
          <strong>{stats.playable}</strong>
        </article>
      </section>

      <section className="admin-create-grid" aria-label="Add videos">
        <form className="admin-card" onSubmit={handleCreateLink}>
          <div>
            <span>Link a video</span>
            <strong>External URL</strong>
          </div>
          <label>
            Title
            <input value={linkTitle} onChange={(event) => setLinkTitle(event.target.value)} placeholder="Scene title" />
          </label>
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
            Source type
            <select
              value={linkSourceType}
              onChange={(event) => setLinkSourceType(event.target.value as "youtube" | "external_url")}
            >
              <option value="external_url">External URL</option>
              <option value="youtube">YouTube reference</option>
            </select>
          </label>
          <button type="submit" disabled={busyId === "create-link"}>
            {busyId === "create-link" ? "Creating..." : "Create link"}
          </button>
        </form>

        <form className="admin-card" onSubmit={handleUpload}>
          <div>
            <span>Upload video</span>
            <strong>Local/S3 media</strong>
          </div>
          <label>
            Title
            <input value={uploadTitle} onChange={(event) => setUploadTitle(event.target.value)} placeholder="Upload title" />
          </label>
          <label>
            File
            <input
              type="file"
              accept="video/*"
              onChange={(event) => setUploadFile(event.currentTarget.files?.[0] ?? null)}
              required
            />
          </label>
          <button type="submit" disabled={busyId === "upload"}>
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
                <th>Metadata</th>
                <th>URLs</th>
                <th>Storage</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {videos.map((video) => {
                const draft = drafts[video.videoId] ?? draftFromVideo(video);
                const rowBusy = busyId === video.videoId;
                return (
                  <tr key={video.videoId}>
                    <td>
                      <code>{video.videoId}</code>
                      <span>{video.originalFilename ?? "catalogue record"}</span>
                    </td>
                    <td>
                      <input
                        aria-label={`Title for ${video.videoId}`}
                        value={draft.title}
                        onChange={(event) => updateDraft(video.videoId, { title: event.target.value })}
                        placeholder="Untitled"
                      />
                      <div className="admin-inline">
                        <select
                          aria-label={`Source type for ${video.videoId}`}
                          value={draft.sourceType}
                          onChange={(event) =>
                            updateDraft(video.videoId, { sourceType: event.target.value as VideoAsset["sourceType"] })
                          }
                        >
                          <option value="upload">Upload</option>
                          <option value="external_url">External URL</option>
                          <option value="youtube">YouTube</option>
                        </select>
                        <input
                          aria-label={`Status for ${video.videoId}`}
                          value={draft.status}
                          onChange={(event) => updateDraft(video.videoId, { status: event.target.value })}
                          placeholder="ready"
                        />
                      </div>
                    </td>
                    <td>
                      <input
                        aria-label={`Original URL for ${video.videoId}`}
                        value={draft.originalUrl}
                        onChange={(event) => updateDraft(video.videoId, { originalUrl: event.target.value })}
                        placeholder="Original URL"
                      />
                      <input
                        aria-label={`Playback URL for ${video.videoId}`}
                        value={draft.playbackUrl}
                        onChange={(event) => updateDraft(video.videoId, { playbackUrl: event.target.value })}
                        placeholder="Playback URL"
                      />
                    </td>
                    <td>
                      <strong>{video.storageBackend ?? "-"}</strong>
                      <span>{formatBytes(video.fileSizeBytes)}</span>
                    </td>
                    <td>{formatDate(video.createdAt)}</td>
                    <td>
                      <div className="admin-row-actions">
                        <button onClick={() => handleSave(video)} disabled={rowBusy}>
                          {rowBusy ? "Saving..." : "Save"}
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
    </main>
  );
}

