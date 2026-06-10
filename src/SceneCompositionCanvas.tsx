import React, { useEffect, useRef } from "react";
import { analyzeVideoFrame, type SceneSubject, type SubjectColor } from "./sceneVision";
import type { SceneComposition } from "./sceneComposition";
import type { AppMode } from "./sceneverseApi";

type SceneCompositionCanvasProps = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  mode: AppMode;
  fallback: SceneComposition;
};

type SubjectRuntime = SceneSubject & {
  igniteAt: number;
  packetPhase: number;
  flashPeriod: number;
  flashOffset: number;
  streakPeriod: number;
  streakOffset: number;
};

type OverlayState = {
  subjects: SubjectRuntime[];
  entryStart: number;
  analyzedAt: number;
  usingFallback: boolean;
};

const SCAN_DURATION = 1500;
const BURST_DURATION = 680;
const BRACKET_DURATION = 460;
const REANALYZE_INTERVAL = 1800;

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function rgba(color: SubjectColor, alpha: number) {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

function mixToWhite(color: SubjectColor, amount: number): SubjectColor {
  return {
    r: Math.round(color.r + (255 - color.r) * amount),
    g: Math.round(color.g + (255 - color.g) * amount),
    b: Math.round(color.b + (255 - color.b) * amount),
  };
}

function pseudoRandom(seed: number) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function fallbackSubjects(composition: SceneComposition): SceneSubject[] {
  return composition.characters.map((character, index) => {
    const cx = character.x / 100;
    const cy = character.y / 100;
    const halfWidth = character.width / 200;
    const halfHeight = character.height / 200;
    const contour = Array.from({ length: 48 }, (_, i) => {
      const theta = (i / 48) * Math.PI * 2;
      const wobble = 1 + 0.07 * Math.sin(theta * 3 + index);
      return {
        x: cx + Math.cos(theta) * halfWidth * wobble,
        y: cy + Math.sin(theta) * halfHeight * wobble,
        w: 0.55 + 0.45 * Math.abs(Math.sin(theta * 2 + index)),
      };
    });
    return {
      id: `fallback-${character.id}`,
      cx,
      cy,
      x0: cx - halfWidth,
      y0: cy - halfHeight,
      x1: cx + halfWidth,
      y1: cy + halfHeight,
      color: { r: 110, g: 195, b: 255 },
      axisAngle: Math.PI / 2,
      energy: Math.max(0.45, 1 - index * 0.18),
      contour,
    };
  });
}

function toRuntime(subject: SceneSubject, index: number, igniteAt: number): SubjectRuntime {
  return {
    ...subject,
    igniteAt,
    packetPhase: pseudoRandom(index * 7 + 1),
    flashPeriod: 2500 + pseudoRandom(index * 13 + 2) * 1300,
    flashOffset: pseudoRandom(index * 17 + 3) * 2200,
    streakPeriod: 3100 + pseudoRandom(index * 19 + 4) * 1500,
    streakOffset: pseudoRandom(index * 23 + 5) * 2600,
  };
}

export default function SceneCompositionCanvas({
  videoRef,
  mode,
  fallback,
}: SceneCompositionCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<OverlayState>({
    subjects: [],
    entryStart: 0,
    analyzedAt: 0,
    usingFallback: false,
  });
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const active = mode === "generating" || mode === "in-scene";
    if (!active) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      stateRef.current.subjects = [];
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const state = stateRef.current;
    const isEntry = mode === "generating";

    if (import.meta.env.DEV) {
      (window as typeof window & { __sceneVisionAnalyze?: unknown }).__sceneVisionAnalyze = () =>
        analyzeVideoFrame(video);
    }

    function runAnalysis(staggerIgnite: boolean) {
      if (!video) return;
      const now = performance.now();
      const result = video.readyState >= 2 ? analyzeVideoFrame(video) : null;
      const rawSubjects =
        result && result.subjects.length > 0 ? result.subjects : fallbackSubjects(fallbackRef.current);
      state.usingFallback = !result || result.subjects.length === 0;
      const previous = state.subjects;
      if (import.meta.env.DEV) {
        (window as typeof window & { __sceneVisionDebug?: unknown }).__sceneVisionDebug = {
          usingFallback: state.usingFallback,
          subjects: rawSubjects.map((subject) => ({
            id: subject.id,
            cx: subject.cx,
            cy: subject.cy,
            box: [subject.x0, subject.y0, subject.x1, subject.y1],
            color: subject.color,
            energy: subject.energy,
            contourPoints: subject.contour.length,
          })),
        };
      }
      state.subjects = rawSubjects.map((subject, index) => {
        const nearest = previous.find(
          (candidate) => Math.hypot(candidate.cx - subject.cx, candidate.cy - subject.cy) < 0.14,
        );
        if (nearest) {
          return { ...nearest, ...subject, igniteAt: nearest.igniteAt };
        }
        const igniteAt = staggerIgnite ? now + index * 200 : Number.POSITIVE_INFINITY;
        return toRuntime(subject, index, igniteAt);
      });
      state.analyzedAt = now;
    }

    if (isEntry) {
      state.entryStart = performance.now();
      // Subjects ignite as the scan beam reaches them, not on a timer.
      state.subjects = [];
      runAnalysis(false);
    } else if (state.subjects.length === 0) {
      state.entryStart = performance.now() - SCAN_DURATION;
      runAnalysis(true);
    }

    const reanalyzeTimer =
      mode === "in-scene"
        ? window.setInterval(() => {
            if ((!video.paused && !video.ended) || state.usingFallback) runAnalysis(true);
          }, REANALYZE_INTERVAL)
        : null;

    // Seeks and frame decode can race the mode switch and yield an empty frame,
    // so retry briefly until the real composition is available.
    const retryStartedAt = performance.now();
    const retryTimer = window.setInterval(() => {
      if (!state.usingFallback || performance.now() - retryStartedAt > 2600) {
        window.clearInterval(retryTimer);
        return;
      }
      runAnalysis(!isEntry);
    }, 260);

    let frameHandle = 0;
    let disposed = false;

    function resizeCanvas() {
      if (!canvas) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;
      const targetWidth = Math.round(width * ratio);
      const targetHeight = Math.round(height * ratio);
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }
    }

    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(canvas);
    resizeCanvas();

    function coverRect() {
      if (!canvas || !video || video.videoWidth === 0) {
        return { x: 0, y: 0, w: canvas?.width ?? 0, h: canvas?.height ?? 0 };
      }
      const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
      const w = video.videoWidth * scale;
      const h = video.videoHeight * scale;
      return { x: (canvas.width - w) / 2, y: (canvas.height - h) / 2, w, h };
    }

    function draw(now: number) {
      if (disposed || !canvas || !context) return;
      frameHandle = requestAnimationFrame(draw);
      if (canvas.width === 0 || canvas.height === 0) return;

      context.clearRect(0, 0, canvas.width, canvas.height);
      const rect = coverRect();
      if (rect.w === 0) return;
      const px = (nx: number) => rect.x + nx * rect.w;
      const py = (ny: number) => rect.y + ny * rect.h;
      const elapsed = now - state.entryStart;
      const scanProgress = clamp01(elapsed / SCAN_DURATION);
      const masterAlpha = isEntry ? 1 : 0.96;

      context.globalCompositeOperation = "lighter";

      // Scan beam: a vertical sheet of light reading the frame left to right.
      let beamX = Number.POSITIVE_INFINITY;
      if (isEntry && scanProgress < 1 && !reducedMotion) {
        const eased = easeInOutCubic(scanProgress);
        beamX = rect.x + (-0.06 + 1.12 * eased) * rect.w;
        const envelope = Math.sin(scanProgress * Math.PI);
        const beamWidth = rect.w * 0.07;
        const gradientFill = context.createLinearGradient(beamX - beamWidth, 0, beamX + beamWidth, 0);
        gradientFill.addColorStop(0, "rgba(80, 190, 255, 0)");
        gradientFill.addColorStop(0.4, `rgba(80, 190, 255, ${0.42 * envelope})`);
        gradientFill.addColorStop(0.5, `rgba(255, 255, 255, ${0.98 * envelope})`);
        gradientFill.addColorStop(0.6, `rgba(120, 120, 255, ${0.42 * envelope})`);
        gradientFill.addColorStop(1, "rgba(120, 120, 255, 0)");
        context.save();
        context.translate(beamX, canvas.height / 2);
        context.rotate(-0.06);
        context.translate(-beamX, -canvas.height / 2);
        context.fillStyle = gradientFill;
        context.fillRect(beamX - beamWidth, rect.y, beamWidth * 2, rect.h);
        context.restore();

        // Sparkles riding the beam edge.
        for (let i = 0; i < 12; i += 1) {
          const seed = Math.floor(now / 90) * 9 + i;
          const sparkY = rect.y + pseudoRandom(seed) * rect.h;
          const sparkAlpha = 0.72 * envelope * pseudoRandom(seed + 0.5);
          context.fillStyle = `rgba(255, 255, 255, ${sparkAlpha})`;
          context.beginPath();
          context.arc(beamX + (pseudoRandom(seed + 0.2) - 0.5) * 18, sparkY, 1.9, 0, Math.PI * 2);
          context.fill();
        }
      } else if (isEntry && scanProgress >= 1) {
        beamX = Number.POSITIVE_INFINITY;
      }

      for (const subject of state.subjects) {
        // During entry the beam ignites each subject as it crosses its centroid.
        if (isEntry && subject.igniteAt === Number.POSITIVE_INFINITY) {
          if (reducedMotion || scanProgress >= 1 || beamX >= px(subject.cx)) {
            subject.igniteAt = now;
          } else {
            continue;
          }
        }
        const sinceIgnite = now - subject.igniteAt;
        if (sinceIgnite < 0) continue;

        const igniteRamp = clamp01(sinceIgnite / 420);
        const baseAlpha = masterAlpha * subject.energy * igniteRamp;
        const bboxW = (subject.x1 - subject.x0) * rect.w;
        const bboxH = (subject.y1 - subject.y0) * rect.h;
        // Oversized detections are scenery (fog banks, foreground masses):
        // trace their silhouette but skip the targeting treatment.
        const isEnvironment = (subject.x1 - subject.x0) * (subject.y1 - subject.y0) > 0.42;
        const centerX = px(subject.cx);
        const centerY = py(subject.cy);
        const halo = mixToWhite(subject.color, 0.2);

        // Aura — breathing glow matched to the subject's dominant color.
        const breath = 1 + 0.05 * Math.sin(now / 860 + subject.packetPhase * 7);
        const auraRadius = Math.max(bboxW, bboxH) * 0.55 * breath;
        if (auraRadius > 4 && !isEnvironment) {
          const aura = context.createRadialGradient(centerX, centerY, auraRadius * 0.12, centerX, centerY, auraRadius);
          aura.addColorStop(0, rgba(halo, (isEntry ? 0.42 : 0.3) * baseAlpha));
          aura.addColorStop(0.62, rgba(subject.color, (isEntry ? 0.28 : 0.19) * baseAlpha));
          aura.addColorStop(1, rgba(subject.color, 0));
          context.save();
          context.translate(centerX, centerY);
          context.scale(Math.max(0.35, bboxW / (auraRadius * 2)), Math.max(0.35, bboxH / (auraRadius * 2)));
          context.translate(-centerX, -centerY);
          context.fillStyle = aura;
          context.beginPath();
          context.arc(centerX, centerY, auraRadius, 0, Math.PI * 2);
          context.fill();
          context.restore();
        }

        // Ignition burst — sparks ejected along the silhouette.
        if (sinceIgnite < BURST_DURATION && !reducedMotion && !isEnvironment && subject.contour.length > 0) {
          const burstProgress = sinceIgnite / BURST_DURATION;
          const reach = easeOutCubic(burstProgress);
          const fade = Math.pow(1 - burstProgress, 1.7);
          context.lineCap = "round";
          for (let i = 0; i < 20; i += 1) {
            const pick = subject.contour[Math.floor(pseudoRandom(i * 3.7 + 1) * subject.contour.length)];
            const startX = px(pick.x);
            const startY = py(pick.y);
            const angle = Math.atan2(startY - centerY, startX - centerX) + (pseudoRandom(i + 9) - 0.5) * 0.7;
            const length = (24 + pseudoRandom(i + 4) * 60) * reach;
            context.strokeStyle = rgba(mixToWhite(subject.color, 0.28), Math.min(1, fade * masterAlpha * 1.18));
            context.lineWidth = 3.5;
            context.beginPath();
            context.moveTo(startX + Math.cos(angle) * length * 0.45, startY + Math.sin(angle) * length * 0.45);
            context.lineTo(startX + Math.cos(angle) * length, startY + Math.sin(angle) * length);
            context.stroke();
          }
        }

        if (subject.contour.length > 2 && !reducedMotion) {
          // Light packets racing along the detected silhouette.
          const count = subject.contour.length;
          const packetLength = Math.max(7, Math.floor(count * 0.22));
          const speed = isEntry ? 0.34 : 0.24;
          for (let packet = 0; packet < 3; packet += 1) {
            const headFloat =
              ((now / 1000) * speed + subject.packetPhase + packet / 3) % 1;
            const head = Math.floor(headFloat * count);
            for (let j = 0; j < packetLength; j += 1) {
              const point = subject.contour[(head - j + count * 4) % count];
              const fade = Math.pow(1 - j / packetLength, 1.6);
              const x = px(point.x);
              const y = py(point.y);
              context.fillStyle = rgba(subject.color, 0.34 * fade * baseAlpha);
              context.beginPath();
              context.arc(x, y, 5 + 9 * fade * point.w, 0, Math.PI * 2);
              context.fill();
              context.fillStyle = rgba(subject.color, 0.95 * fade * baseAlpha);
              context.beginPath();
              context.arc(x, y, 2.6 + 4.2 * fade * point.w, 0, Math.PI * 2);
              context.fill();
              context.fillStyle = `rgba(255, 255, 255, ${Math.min(1, 1.15 * fade * fade * baseAlpha)})`;
              context.beginPath();
              context.arc(x, y, 1.4 + 1.9 * fade, 0, Math.PI * 2);
              context.fill();
            }
          }

          // Full-silhouette lightning flash.
          const flashCycle = ((now + subject.flashOffset) % subject.flashPeriod) / subject.flashPeriod;
          if (flashCycle < 0.15) {
            const flashEnvelope = Math.sin((flashCycle / 0.15) * Math.PI);
            for (const point of subject.contour) {
              const x = px(point.x);
              const y = py(point.y);
              context.fillStyle = rgba(subject.color, 0.52 * flashEnvelope * point.w * baseAlpha);
              context.beginPath();
              context.arc(x, y, 4 + 6.4 * point.w, 0, Math.PI * 2);
              context.fill();
              context.fillStyle = rgba(halo, 0.95 * flashEnvelope * point.w * baseAlpha);
              context.beginPath();
              context.arc(x, y, 1.8 + 3.2 * point.w, 0, Math.PI * 2);
              context.fill();
            }
          }

        }
      }

      context.globalCompositeOperation = "source-over";
    }

    frameHandle = requestAnimationFrame(draw);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameHandle);
      resizeObserver.disconnect();
      window.clearInterval(retryTimer);
      if (reanalyzeTimer) window.clearInterval(reanalyzeTimer);
      context.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [mode, videoRef]);

  return <canvas ref={canvasRef} className="scene-composition-canvas" />;
}
