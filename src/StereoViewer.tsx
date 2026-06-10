import React, { Suspense, useEffect, useRef, useState } from "react";
import type { CatalogVideo } from "./videoCatalog";
import { broadcastStereoEvent, subscribeStereoChannel } from "./stereoSync";
import "./stereoViewer.css";

const VRSceneView = React.lazy(() => import("./VRSceneView"));

type StereoViewerProps = {
  video: CatalogVideo;
  onExit: (time?: number) => void;
};

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type LookState = {
  yaw: number;
  pitch: number;
};

function buildFrameUrl(videoId: string, role: "primary" | "mirror", time: number) {
  const params = new URLSearchParams({
    stereoFrame: role,
  });
  if (time > 0) params.set("t", time.toFixed(2));
  return `/video/${encodeURIComponent(videoId)}?${params.toString()}`;
}

function getInitialTime() {
  const rawTime = new URLSearchParams(window.location.search).get("t");
  const time = rawTime ? Number.parseFloat(rawTime) : 0;
  return Number.isFinite(time) && time > 0 ? time : 0;
}

export default function StereoViewer({ video, onExit }: StereoViewerProps) {
  const viewerRef = useRef<HTMLElement>(null);
  const leftFrameRef = useRef<HTMLIFrameElement>(null);
  const rightFrameRef = useRef<HTMLIFrameElement>(null);
  const lookRef = useRef<LookState | null>({ yaw: 0, pitch: 0 });
  const currentLookRef = useRef<LookState>({ yaw: 0, pitch: 0 });
  const targetLookRef = useRef<LookState>({ yaw: 0, pitch: 0 });
  const dragRef = useRef({ active: false, x: 0, y: 0 });
  const latestTimeRef = useRef(getInitialTime());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [loadedFrameCount, setLoadedFrameCount] = useState(0);

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
    const fullscreenRoot = viewerRef.current as FullscreenElement | null;
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

  async function requestOrientationPermission() {
    try {
      type DOE = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> };
      const requestPermission = (DeviceOrientationEvent as DOE | undefined)?.requestPermission;
      if (typeof requestPermission === "function") {
        return (await requestPermission()) === "granted";
      }
      return true;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    return subscribeStereoChannel(video.id, (event) => {
      if (event.type === "time") latestTimeRef.current = event.t;
    });
  }, [video.id]);

  useEffect(() => {
    let animationFrame = 0;
    const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

    function updateLook() {
      const current = currentLookRef.current;
      const target = targetLookRef.current;
      current.yaw += (target.yaw - current.yaw) * 0.12;
      current.pitch += (target.pitch - current.pitch) * 0.12;
      lookRef.current = { yaw: current.yaw, pitch: current.pitch };

      const panX = clamp(-current.yaw * 220, 80);
      const panY = clamp(current.pitch * 190, 64);
      leftFrameRef.current?.style.setProperty("--stereo-pan-x", `${panX}px`);
      rightFrameRef.current?.style.setProperty("--stereo-pan-x", `${panX}px`);
      leftFrameRef.current?.style.setProperty("--stereo-pan-y", `${panY}px`);
      rightFrameRef.current?.style.setProperty("--stereo-pan-y", `${panY}px`);
      animationFrame = window.requestAnimationFrame(updateLook);
    }

    animationFrame = window.requestAnimationFrame(updateLook);
    return () => window.cancelAnimationFrame(animationFrame);
  }, []);

  useEffect(() => {
    if (!isStarted) return;

    const baseline = { alpha: null as number | null, beta: null as number | null };
    function onDeviceOrientation(event: DeviceOrientationEvent) {
      if (event.alpha == null || event.beta == null) return;
      baseline.alpha ??= event.alpha;
      baseline.beta ??= event.beta;
      const deltaYaw = event.alpha - baseline.alpha;
      const normalizedYaw = ((deltaYaw + 540) % 360) - 180;
      targetLookRef.current.yaw = Math.max(-0.9, Math.min(0.9, normalizedYaw * Math.PI / 180));
      targetLookRef.current.pitch = Math.max(-0.55, Math.min(0.55, (event.beta - baseline.beta) * Math.PI / 180));
    }

    window.addEventListener("deviceorientation", onDeviceOrientation);
    return () => window.removeEventListener("deviceorientation", onDeviceOrientation);
  }, [isStarted]);

  function handlePointerDown(event: React.PointerEvent<HTMLElement>) {
    dragRef.current = { active: true, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag.active) return;
    targetLookRef.current.yaw -= (event.clientX - drag.x) * 0.004;
    targetLookRef.current.pitch -= (event.clientY - drag.y) * 0.004;
    targetLookRef.current.yaw = Math.max(-0.9, Math.min(0.9, targetLookRef.current.yaw));
    targetLookRef.current.pitch = Math.max(-0.55, Math.min(0.55, targetLookRef.current.pitch));
    drag.x = event.clientX;
    drag.y = event.clientY;
  }

  function handlePointerUp(event: React.PointerEvent<HTMLElement>) {
    dragRef.current.active = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  async function startStereo() {
    if (loadedFrameCount < 2) return;
    targetLookRef.current = { yaw: 0, pitch: 0 };
    currentLookRef.current = { yaw: 0, pitch: 0 };
    lookRef.current = { yaw: 0, pitch: 0 };
    await requestOrientationPermission();
    if (!isFullscreen) await toggleFullscreen();
    setIsStarted(true);
    broadcastStereoEvent(video.id, { type: "video-control", action: "play" });
  }

  return (
    <main
      ref={viewerRef}
      className="stereo-viewer"
      aria-label="Stereo app viewer"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <Suspense fallback={null}>
        <VRSceneView videoRef={{ current: null }} title={video.title} onExit={() => onExit(latestTimeRef.current)} lookRef={lookRef} />
      </Suspense>
      <div className="stereo-controls" aria-label="Stereo viewer controls">
        <button type="button" onClick={() => onExit(latestTimeRef.current)}>
          Back
        </button>
        <button type="button" onClick={toggleFullscreen} aria-pressed={isFullscreen}>
          {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
        </button>
      </div>

      <div className="stereo-stage">
        <section className="stereo-eye stereo-eye-left" aria-label="Left eye app view">
          <iframe
            ref={leftFrameRef}
            className="stereo-app-frame"
            src={buildFrameUrl(video.id, "primary", latestTimeRef.current)}
            title={`${video.title} left eye app view`}
            allow="microphone; autoplay"
            onLoad={() => setLoadedFrameCount((count) => Math.min(2, count + 1))}
          />
        </section>
        <section className="stereo-eye stereo-eye-right" aria-label="Right eye app view">
          <iframe
            ref={rightFrameRef}
            className="stereo-app-frame"
            src={buildFrameUrl(video.id, "mirror", latestTimeRef.current)}
            title={`${video.title} right eye app view`}
            allow="autoplay"
            onLoad={() => setLoadedFrameCount((count) => Math.min(2, count + 1))}
          />
        </section>
      </div>

      {!isStarted ? (
        <button className="stereo-start" type="button" onClick={startStereo} disabled={loadedFrameCount < 2}>
          <span>{loadedFrameCount < 2 ? "Loading VR" : "Tap to start VR"}</span>
          <strong>{video.title}</strong>
        </button>
      ) : null}

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
