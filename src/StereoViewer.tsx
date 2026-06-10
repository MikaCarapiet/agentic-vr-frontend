import React, { useEffect, useState } from "react";
import type { CatalogVideo } from "./videoCatalog";
import "./stereoViewer.css";

type StereoViewerProps = {
  video: CatalogVideo;
  onExit: () => void;
};

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function buildFrameUrl(videoId: string, eye: "left" | "right") {
  const params = new URLSearchParams({
    stereoFrame: eye,
  });
  return `/video/${encodeURIComponent(videoId)}?${params.toString()}`;
}

export default function StereoViewer({ video, onExit }: StereoViewerProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);

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

  async function toggleFullscreen() {
    const fullscreenDocument = document as FullscreenDocument;
    const fullscreenRoot = document.querySelector(".stereo-viewer") as FullscreenElement | null;
    if (!fullscreenRoot) return;

    try {
      if (document.fullscreenElement || fullscreenDocument.webkitFullscreenElement) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else {
          await fullscreenDocument.webkitExitFullscreen?.();
        }
        return;
      }

      if (fullscreenRoot.requestFullscreen) {
        await fullscreenRoot.requestFullscreen({ navigationUI: "hide" });
      } else {
        await fullscreenRoot.webkitRequestFullscreen?.();
      }
    } catch {
      setIsFullscreen(Boolean(document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement));
    }
  }

  return (
    <main className="stereo-viewer" aria-label="Stereo app viewer">
      <div className="stereo-controls" aria-label="Stereo viewer controls">
        <button type="button" onClick={onExit}>
          Back
        </button>
        <button type="button" onClick={toggleFullscreen} aria-pressed={isFullscreen}>
          {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
        </button>
      </div>

      <div className="stereo-stage">
        <section className="stereo-eye stereo-eye-left" aria-label="Left eye app view">
          <iframe
            className="stereo-app-frame"
            src={buildFrameUrl(video.id, "left")}
            title={`${video.title} left eye app view`}
          />
        </section>
        <section className="stereo-eye stereo-eye-right" aria-label="Right eye app view">
          <iframe
            className="stereo-app-frame"
            src={buildFrameUrl(video.id, "right")}
            title={`${video.title} right eye app view`}
          />
        </section>
      </div>

      <section className="stereo-orientation-lock" aria-live="polite" aria-label="Rotate device prompt">
        <div>
          <span>Landscape required</span>
          <strong>Rotate your phone</strong>
          <p>Stereo display mode needs horizontal viewing.</p>
        </div>
      </section>
    </main>
  );
}
